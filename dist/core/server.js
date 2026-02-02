"use strict";
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const dotenv = __importStar(require("dotenv"));
// Load .env file from multiple possible locations
// Try: 1) project root relative to compiled dist/, 2) CWD, 3) hardcoded path
const possibleEnvPaths = [
    path.resolve(__dirname, '..', '.env'), // Relative to dist/core/
    path.resolve(process.cwd(), '.env'), // CWD
    'F:\\win_11\\.env', // Hardcoded fallback
    'C:\\MCP\\mcp-win11-desktop\\.env', // Alternative MCP path
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
const logger_1 = require("./logger");
const registry_1 = require("./registry");
const loader_1 = require("./tsd/loader");
const router_1 = require("./parser/router");
// ---------------------------------------------------------------------------
// 1. CLI argument parsing
// ---------------------------------------------------------------------------
function parseCli() {
    const args = process.argv.slice(2);
    let transport;
    let port;
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--transport' && args[i + 1]) {
            transport = args[i + 1];
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
function loadSessionConfig(cliOverrides) {
    const configPath = path.resolve(process.cwd(), 'config', 'session.json');
    let fileConfig = {};
    if (fs.existsSync(configPath)) {
        try {
            fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        }
        catch {
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
let serverInstance = null;
const activeOperations = new Set();
function trackOperation(promise) {
    activeOperations.add(promise);
    promise.finally(() => activeOperations.delete(promise));
    return promise;
}
async function gracefulShutdown(signal) {
    const log = (0, logger_1.scopedLogger)('core/server');
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
            new Promise((_, reject) => setTimeout(() => reject(new Error('Shutdown timeout')), shutdownTimeout))
        ]);
        log.info('All active operations completed');
    }
    catch (e) {
        log.warn({ activeCount: activeOperations.size }, 'Shutdown timeout reached, forcing exit');
    }
    log.info('Graceful shutdown complete');
    process.exit(0);
}
// Register shutdown handlers
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
async function main() {
    const cli = parseCli();
    const sessionConfig = loadSessionConfig(cli);
    // 3. Logger
    (0, logger_1.initLogger)(sessionConfig);
    const log = (0, logger_1.scopedLogger)('core/server');
    log.info({ transport: sessionConfig.transportMode, port: sessionConfig.port }, 'MCP Win11 Desktop Controller starting');
    // 4. TSD loader
    const tsdLoader = new loader_1.TsdLoader();
    tsdLoader.load();
    // 5. Import all tools (triggers registration)
    // This must happen AFTER the logger is initialised so tool modules can log.
    require('../tools/index');
    // 6. Initialise registry
    registry_1.registry.init(sessionConfig, tsdLoader);
    log.info({ toolCount: registry_1.registry.list().length }, 'Tool registry initialised');
    // 7. Parser router
    const parserRouter = new router_1.ParserRouter(sessionConfig);
    parserRouter.setKnownToolNames(registry_1.registry.listToolNames());
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
            startStdioTransport(registry_1.registry, parserRouter, sessionConfig);
            break;
        }
        case 'http': {
            const modulePath = '../transports/http';
            if (!allowedTransports.includes(modulePath)) {
                log.error({ module: modulePath }, 'Transport module not in whitelist');
                process.exit(1);
            }
            const { createHttpTransport } = require(modulePath);
            const app = createHttpTransport(registry_1.registry, parserRouter, sessionConfig);
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
            const app = createSseTransport(registry_1.registry, parserRouter, sessionConfig);
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
main().catch((e) => {
    console.error('Fatal error during startup:', e.message);
    console.error(e.stack);
    process.exit(1);
});
//# sourceMappingURL=server.js.map