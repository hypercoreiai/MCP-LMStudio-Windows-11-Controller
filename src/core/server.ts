/**
 * core/server.ts
 * 
 * The single entry point. Orchestrates startup in order:
 *   1. Load environment variables from .env
 *   2. Parse CLI args → determine transport mode
 *   3. Load session config (from config/session.json + CLI overrides)
 *   4. Initialise the logger
 *   5. Load TSDs from config/tsds/
 *   6. Import all tool modules (triggers self-registration)
 *   7. Initialise the registry with the TSD loader
 *   8. Create the parser router, feed it known tool names
 *   9. Start the selected transport
 */

import * as path from 'path';
import * as fs from 'fs';
import * as dotenv from 'dotenv';

// Load .env file from multiple possible locations
// Try: 1) project root relative to compiled dist/, 2) CWD, 3) hardcoded path
const possibleEnvPaths = [
  path.resolve(__dirname, '..', '.env'),           // Relative to dist/core/
  path.resolve(process.cwd(), '.env'),              // CWD
  'F:\\win_11\\.env',                               // Hardcoded fallback
  'C:\\MCP\\mcp-win11-desktop\\.env',               // Alternative MCP path
];

let envLoaded = false;
for (const envPath of possibleEnvPaths) {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
    envLoaded = true;
    break;
  }
}

// If still not loaded, try the basic config without path (will use CWD)
if (!envLoaded) {
  dotenv.config();
}

import { initLogger, scopedLogger } from './logger';
import { registry } from './registry';
import { TsdLoader } from './tsd/loader';
import { ParserRouter } from './parser/router';
import { SessionConfig, TransportMode } from './types';

// ---------------------------------------------------------------------------
// 1. CLI argument parsing
// ---------------------------------------------------------------------------

function parseCli(): { transport?: TransportMode; port?: number } {
  const args = process.argv.slice(2);
  let transport: TransportMode | undefined;
  let port: number | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--transport' && args[i + 1]) {
      transport = args[i + 1] as TransportMode;
      i++;
    }
    if (args[i] === '--port' && args[i + 1]) {
      port = parseInt(args[i + 1], 10);
      i++;
    }
  }

  return { transport, port };
}

// ---------------------------------------------------------------------------
// 2. Load session config
// ---------------------------------------------------------------------------

function loadSessionConfig(cliOverrides: { transport?: TransportMode; port?: number }): SessionConfig {
  const configPath = path.resolve(process.cwd(), 'config', 'session.json');
  let fileConfig: Partial<SessionConfig> = {};

  if (fs.existsSync(configPath)) {
    try {
      fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    } catch {
      // Malformed config — start with defaults
    }
  }

  return {
    transportMode: cliOverrides.transport ?? fileConfig.transportMode ?? 'stdio',
    port: cliOverrides.port ?? fileConfig.port ?? 3000,
    modelSupportsToolCallTags: fileConfig.modelSupportsToolCallTags,
    elevationPreApproved: fileConfig.elevationPreApproved ?? false,
    elevationWhitelist: fileConfig.elevationWhitelist ?? [],
    logLevel: fileConfig.logLevel ?? 'info',
    auditLogPath: fileConfig.auditLogPath ?? 'audit.log'
  };
}

// ---------------------------------------------------------------------------
// Main boot sequence
// ---------------------------------------------------------------------------

// Track active connections and operations for graceful shutdown
let serverInstance: any = null;
const activeOperations = new Set<Promise<any>>();

function trackOperation<T>(promise: Promise<T>): Promise<T> {
  activeOperations.add(promise);
  promise.finally(() => activeOperations.delete(promise));
  return promise;
}

async function gracefulShutdown(signal: string): Promise<void> {
  const log = scopedLogger('core/server');
  log.info({ signal }, 'Received shutdown signal, starting graceful shutdown');
  
  // Stop accepting new connections
  if (serverInstance && typeof serverInstance.close === 'function') {
    serverInstance.close(() => {
      log.info('Server stopped accepting new connections');
    });
  }
  
  // Wait for active operations with timeout
  const shutdownTimeout = 5000; // 5 seconds default
  const shutdownPromise = Promise.all(Array.from(activeOperations));
  
  try {
    await Promise.race([
      shutdownPromise,
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Shutdown timeout')), shutdownTimeout)
      )
    ]);
    log.info('All active operations completed');
  } catch (e) {
    log.warn({ activeCount: activeOperations.size }, 'Shutdown timeout reached, forcing exit');
  }
  
  log.info('Graceful shutdown complete');
  process.exit(0);
}

// Register shutdown handlers
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

async function main(): Promise<void> {
  const cli = parseCli();
  const sessionConfig = loadSessionConfig(cli);

  // 3. Logger
  initLogger(sessionConfig);
  const log = scopedLogger('core/server');
  log.info({ transport: sessionConfig.transportMode, port: sessionConfig.port }, 'MCP Win11 Desktop Controller starting');

  // 4. TSD loader
  const tsdLoader = new TsdLoader();
  tsdLoader.load();

  // 5. Import all tools (triggers registration)
  // This must happen AFTER the logger is initialised so tool modules can log.
  require('../tools/index');

  // 6. Initialise registry
  registry.init(sessionConfig, tsdLoader);
  log.info({ toolCount: registry.list().length }, 'Tool registry initialised');

  // 7. Parser router
  const parserRouter = new ParserRouter(sessionConfig);
  parserRouter.setKnownToolNames(registry.listToolNames());

  // 8. Start transport
  // Whitelist of allowed transport modules for security
  const allowedTransports = ['../transports/stdio', '../transports/http', '../transports/sse'];
  
  switch (sessionConfig.transportMode) {
    case 'stdio': {
      const modulePath = '../transports/stdio';
      if (!allowedTransports.includes(modulePath)) {
        log.error({ module: modulePath }, 'Transport module not in whitelist');
        process.exit(1);
      }
      const { startStdioTransport } = require(modulePath);
      startStdioTransport(registry, parserRouter, sessionConfig);
      break;
    }

    case 'http': {
      const modulePath = '../transports/http';
      if (!allowedTransports.includes(modulePath)) {
        log.error({ module: modulePath }, 'Transport module not in whitelist');
        process.exit(1);
      }
      const { createHttpTransport } = require(modulePath);
      const app = createHttpTransport(registry, parserRouter, sessionConfig);
      const port = sessionConfig.port ?? 3000;
      serverInstance = app.listen(port, () => {
        log.info({ port }, `HTTP server listening`);
      });
      // Set socket timeout to 120 seconds to allow long-running operations (LLM API calls)
      serverInstance.setTimeout(120000);
      // Set keep-alive timeout
      serverInstance.keepAliveTimeout = 65000;
      break;
    }

    case 'sse': {
      const modulePath = '../transports/sse';
      if (!allowedTransports.includes(modulePath)) {
        log.error({ module: modulePath }, 'Transport module not in whitelist');
        process.exit(1);
      }
      const { createSseTransport } = require(modulePath);
      const app = createSseTransport(registry, parserRouter, sessionConfig);
      const port = sessionConfig.port ?? 3000;
      serverInstance = app.listen(port, () => {
        log.info({ port }, `SSE server listening`);
      });
      // Set socket timeout to 120 seconds to allow long-running operations
      serverInstance.setTimeout(120000);
      serverInstance.keepAliveTimeout = 65000;
      break;
    }

    default:
      log.error({ transport: sessionConfig.transportMode }, 'Unknown transport mode');
      process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

main().catch((e: Error) => {
  console.error('Fatal error during startup:', e.message);
  console.error(e.stack);
  process.exit(1);
});
