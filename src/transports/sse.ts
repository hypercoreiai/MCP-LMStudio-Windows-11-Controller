/**
 * transports/sse.ts
 * 
 * Server-Sent Events transport. Useful when:
 *   - Tool results contain large payloads (screenshots as base64)
 *   - The server needs to push progress updates back to the client
 *   - Long-running tools need to stream partial results
 * 
 * Routes:
 *   GET  /sse/connect       → Establishes the SSE stream
 *   POST /sse/tools/call    → Submits a tool call; result is pushed via SSE
 *   GET  /tools/list        → Same as HTTP transport (synchronous, no SSE needed)
 */

import express, { Request, Response } from 'express';
import { ToolRegistry } from '../core/registry';
import { ParserRouter } from '../core/parser/router';
import { SessionConfig, generateCorrelationId } from '../core/types';
import { McpBaseError } from '../core/errors';
import { scopedLogger } from '../core/logger';

const log = scopedLogger('transports/sse');

// Normalize tool name: accept both underscore and dot notation
function normalizeToolName(name: string): string {
  return name.replace(/_/g, '.');
}

// Active SSE connections: sessionId → Response object
const activeConnections = new Map<string, Response>();

function generateSessionId(): string {
  return `sse_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

function pushEvent(res: Response, event: string, data: unknown): void {
  // SSE format: each message is "event: …\ndata: …\n\n"
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

export function createSseTransport(
  registry: ToolRegistry,
  parser: ParserRouter,
  _sessionConfig: SessionConfig
): express.Application {
  const app = express();
  app.use(express.json());

  // -----------------------------------------------------------------------
  // GET /sse/connect — establish SSE stream
  // -----------------------------------------------------------------------
  app.get('/sse/connect', (req: Request, res: Response) => {
    try {
      const sessionId = generateSessionId();

      // SSE headers
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no'); // nginx passthrough

      // Send the session ID as the first event so the client knows its ID
      pushEvent(res, 'connect', { sessionId });

      activeConnections.set(sessionId, res);
      log.info({ sessionId }, 'SSE client connected');

      // Cleanup on disconnect
      req.on('close', () => {
        activeConnections.delete(sessionId);
        log.info({ sessionId }, 'SSE client disconnected');
      });
      
      // Error handling for connection errors
      req.on('error', (err: Error) => {
        log.error({ sessionId, error: err.message }, 'SSE connection error');
        activeConnections.delete(sessionId);
      });
    } catch (e) {
      log.error({ error: (e as Error).message }, 'Error establishing SSE connection');
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to establish SSE connection' });
      }
    }
  });

  // -----------------------------------------------------------------------
  // POST /sse/tools/call — submit a tool call, result pushed via SSE
  // -----------------------------------------------------------------------
  app.post('/sse/tools/call', async (req: Request, res: Response) => {
    // Error boundary: catch all synchronous errors
    try {
      const sessionId  = req.body.sessionId as string;
      const modelOutput = req.body.model_output as string | undefined;
      const tool        = req.body.tool as string | undefined;
      const name        = req.body.name as string | undefined;
      const toolArgs    = req.body.arguments as Record<string, unknown> | undefined;
      const callId      = req.body.call_id as string ?? `call_${Date.now()}`;
      const correlationId = req.headers['x-correlation-id'] as string || generateCorrelationId();

      const sseRes = activeConnections.get(sessionId);
      if (!sseRes) {
        return res.status(404).json({ error: `No active SSE connection for session "${sessionId}"` });
      }

      // Acknowledge receipt immediately
      res.json({ status: 'accepted', callId, sessionId, correlationId });

      // Process asynchronously and push result via SSE
      // Wrapped in try-catch to prevent unhandled promise rejections
      (async () => {
        try {
        // Push a "processing" status
        pushEvent(sseRes, 'status', { callId, status: 'processing' });

        let invocations;

        if (modelOutput) {
          invocations = parser.parse(modelOutput);
          // Add correlation ID to all invocations
          invocations = invocations.map(inv => ({
            ...inv,
            meta: { ...inv.meta, correlationId }
          }));
          if (invocations.length === 0) {
            pushEvent(sseRes, 'result', {
              callId,
              type: 'no_tool_call',
              message: modelOutput,
              correlationId
            });
            return;
          }
        } else if (tool || name) {
          // Accept both "tool" and "name" fields, normalize underscore to dot notation
          const toolName = normalizeToolName((tool || name) as string);
          invocations = [{
            tool: toolName,
            args: toolArgs ?? {},
            meta: { rawOutput: '', parserUsed: 'text' as const, timestamp: Date.now(), correlationId }
          }];
        } else {
          pushEvent(sseRes, 'error', { callId, code: 'INVALID_REQUEST', message: 'Provide model_output or (tool/name + arguments)', correlationId });
          return;
        }

        const results = [];
        for (const inv of invocations) {
          // Push per-tool status
          pushEvent(sseRes, 'status', { callId, status: 'executing', tool: inv.tool });

          const result = await registry.invoke(inv);
          results.push({ tool: inv.tool, result });

          // Push each result as it completes (streaming)
          pushEvent(sseRes, 'tool_result', { callId, tool: inv.tool, result });
        }

        // Final combined result
        pushEvent(sseRes, 'result', { callId, type: 'success', results });

      } catch (e) {
        const isMcpError = e instanceof McpBaseError;
        log.error({ callId, error: (e as Error).message }, 'SSE tool call failed');

        pushEvent(sseRes, 'error', {
          callId,
          code: isMcpError ? (e as McpBaseError).code : 'INTERNAL_ERROR',
          message: (e as Error).message
        });
      }
    })().catch((e: Error) => {
      // Final safety net for unhandled promise rejections
      log.error({ callId: req.body.call_id, error: e.message, stack: e.stack }, 
        'Unhandled error in SSE async processing');
    });
    } catch (e) {
      // Synchronous error boundary
      log.error({ error: (e as Error).message, stack: (e as Error).stack }, 
        'Synchronous error in SSE tools/call handler');
      if (!res.headersSent) {
        res.status(500).json({ error: 'Internal server error', message: (e as Error).message });
      }
    }
  });

  // -----------------------------------------------------------------------
  // GET /tools/list — same as HTTP (synchronous)
  // -----------------------------------------------------------------------
  app.get('/tools/list', (_req: Request, res: Response) => {
    const tools = registry.list();
    res.json({
      object: 'list',
      data: tools.map(t => ({ type: 'function', function: t }))
    });
  });

  // -----------------------------------------------------------------------
  // GET /health
  // -----------------------------------------------------------------------
  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', activeConnections: activeConnections.size, tools: registry.list().length });
  });

  return app;
}
