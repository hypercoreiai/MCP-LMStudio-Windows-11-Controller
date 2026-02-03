/**
 * transports/http.ts
 * 
 * Standard HTTP transport. Each request is synchronous: receive → dispatch → respond.
 * 
 * Routes:
 *   GET  /tools/list    → Returns all registered tool schemas
 *   POST /tools/call    → Executes a single tool invocation
 *   GET  /health        → Liveness check
 */

import express, { Request, Response, NextFunction } from 'express';
import { ToolRegistry } from '../core/registry';
import { ParserRouter } from '../core/parser/router';
import { SessionConfig, generateCorrelationId } from '../core/types';
import { McpBaseError } from '../core/errors';
import { scopedLogger } from '../core/logger';

const log = scopedLogger('transports/http');

// Normalize tool name: accept both underscore and dot notation
function normalizeToolName(name: string): string {
  return name.replace(/_/g, '.');
}

export function createHttpTransport(
  registry: ToolRegistry,
  parser: ParserRouter,
  sessionConfig: SessionConfig
): express.Application {
  const app = express();
  app.use(express.json());

  // Set request timeout to 110 seconds (slightly less than socket timeout of 120s)
  app.use((req: Request, res: Response, next: NextFunction) => {
    req.setTimeout(110000);
    res.setTimeout(110000, () => {
      log.warn({ path: req.path }, 'Request timeout');
      if (!res.headersSent) {
        res.status(503).json({ 
          error: 'Request timeout',
          message: 'The request took too long to complete'
        });
      }
    });
    next();
  });

  // -----------------------------------------------------------------------
  // GET /tools/list
  // -----------------------------------------------------------------------
  app.get('/tools/list', (_req: Request, res: Response) => {
    const tools = registry.list();
    res.json({
      object: 'list',
      data: tools.map(t => ({
        type: 'function',
        function: t
      }))
    });
  });

  // -----------------------------------------------------------------------
  // POST /tools/call
  // -----------------------------------------------------------------------
  app.post('/tools/call', async (req: Request, res: Response) => {
    const { model_output, tool, name, arguments: toolArgs } = req.body;
    const correlationId = req.headers['x-correlation-id'] as string || generateCorrelationId();

    // Error boundary: catch all errors to prevent server crash
    try {
      let invocations;

      if (model_output) {
        // The client sent raw model output — parse it
        invocations = parser.parse(model_output as string);
        // Add correlation ID to all invocations
        invocations = invocations.map(inv => ({
          ...inv,
          meta: { ...inv.meta, correlationId }
        }));

        if (invocations.length === 0) {
          return res.json({
            object: 'tool_call_result',
            type: 'no_tool_call',
            message: model_output // echo back the plain text
          });
        }
      } else if (tool || name) {
        // The client already extracted the tool call for us (pre-parsed)
        // Accept both "tool" and "name" fields, normalize underscore to dot notation
        const toolName = normalizeToolName((tool || name) as string);
        invocations = [{
          tool: toolName,
          args: (toolArgs as Record<string, unknown>) ?? {},
          meta: {
            rawOutput: '',
            parserUsed: 'text' as const,
            timestamp: Date.now(),
            correlationId
          }
        }];
      } else {
        return res.status(400).json({ error: 'Provide either "model_output" or ("tool"/"name" + "arguments")' });
      }

      // Execute all invocations (usually just one, but embedding models can emit multiple)
      const results = [];
      for (const inv of invocations) {
        const result = await registry.invoke(inv);
        results.push({ tool: inv.tool, result });
      }

      res.json({
        object: 'tool_call_result',
        type: 'success',
        results,
        correlationId
      });
    } catch (e) {
      const isMcpError = e instanceof McpBaseError;
      log.error({ correlationId, error: (e as Error).message }, 'Tool call failed');

      res.status(isMcpError ? 400 : 500).json({
        object: 'tool_call_result',
        type: 'error',
        error: {
          code: isMcpError ? (e as McpBaseError).code : 'INTERNAL_ERROR',
          message: (e as Error).message
        }
      });
    }
  });

  // -----------------------------------------------------------------------
  // GET /health
  // -----------------------------------------------------------------------
  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', tools: registry.list().length });
  });

  // -----------------------------------------------------------------------
  // Error handler (Error boundary for unhandled errors)
  // -----------------------------------------------------------------------
  app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
    log.error({ 
      error: err.message, 
      stack: err.stack,
      path: req.path,
      method: req.method 
    }, 'Unhandled error in HTTP transport');
    
    // Prevent sending response if already sent
    if (!res.headersSent) {
      res.status(500).json({ 
        error: 'Internal server error',
        message: err.message 
      });
    }
  });

  return app;
}
