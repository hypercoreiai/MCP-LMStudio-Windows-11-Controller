/**
 * transports/stdio.ts
 * 
 * JSON-RPC 2.0 over stdin/stdout. This is the transport used by MCP
 * clients like Claude Desktop or VS Code that spawn the server as a
 * child process and communicate via pipes.
 * 
 * Protocol:
 *   Client sends:  { "jsonrpc": "2.0", "id": N, "method": "tools/list" | "tools/call", "params": {...} }
 *   Server sends:  { "jsonrpc": "2.0", "id": N, "result": {...} }
 *                  or { "jsonrpc": "2.0", "id": N, "error": { "code": N, "message": "..." } }
 * 
 * Input is newline-delimited JSON (one complete JSON object per line).
 */

import * as readline from 'readline';
import { ToolRegistry } from '../core/registry';
import { ParserRouter } from '../core/parser/router';
import { SessionConfig, generateCorrelationId } from '../core/types';
import { McpBaseError } from '../core/errors';
import { scopedLogger } from '../core/logger';

const log = scopedLogger('transports/stdio');

// Normalize tool name: accept both underscore and dot notation
function normalizeToolName(name: string): string {
  return name; // No normalization needed
}

interface JsonRpcRequest {
  jsonrpc: string;
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

function sendResponse(response: JsonRpcResponse): void {
  process.stdout.write(JSON.stringify(response) + '\n');
}

export function startStdioTransport(
  registry: ToolRegistry,
  parser: ParserRouter,
  _sessionConfig: SessionConfig
): void {
  log.info('Stdio transport started — listening on stdin');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false
  });

  rl.on('line', async (line: string) => {
    // Error boundary for entire line processing
    try {
      const trimmed = line.trim();
      if (!trimmed) return;

      let request: JsonRpcRequest;
      try {
        request = JSON.parse(trimmed);
      } catch (parseError) {
        log.warn({ raw: trimmed, error: (parseError as Error).message }, 'Failed to parse JSON-RPC request');
        // Can't respond without an ID — just log and skip
        return;
      }

      const { id, method, params } = request;

      try {
      switch (method) {
        // ---------------------------------------------------------------
        // initialize - MCP protocol handshake
        // ---------------------------------------------------------------
        case 'initialize': {
          sendResponse({
            jsonrpc: '2.0',
            id,
            result: {
              protocolVersion: '2024-11-05',
              capabilities: {
                tools: {}
              },
              serverInfo: {
                name: 'mcp-win11-desktop',
                version: '1.0.0'
              }
            }
          });
          break;
        }

        // ---------------------------------------------------------------
        // tools/list
        // ---------------------------------------------------------------
        case 'tools/list': {
          const tools = registry.list();
          sendResponse({
            jsonrpc: '2.0',
            id,
            result: {
              tools: tools.map(t => ({
                name: t.name,
                description: t.description,
                inputSchema: t.parameters
              }))
            }
          });
          break;
        }

        // ---------------------------------------------------------------
        // tools/call
        // ---------------------------------------------------------------
        case 'tools/call': {
          const modelOutput = params?.model_output as string | undefined;
          const tool        = params?.tool as string | undefined;
          const name        = params?.name as string | undefined;
          const toolArgs    = params?.arguments as Record<string, unknown> | undefined;
          const correlationId = params?.correlationId as string || generateCorrelationId();

          let invocations;

          if (modelOutput) {
            invocations = parser.parse(modelOutput);
            // Add correlation ID
            invocations = invocations.map(inv => ({
              ...inv,
              meta: { ...inv.meta, correlationId }
            }));

            if (invocations.length === 0) {
              sendResponse({
                jsonrpc: '2.0',
                id,
                result: { type: 'no_tool_call', message: modelOutput, correlationId }
              });
              break;
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
            sendResponse({
              jsonrpc: '2.0',
              id,
              error: { code: -32600, message: 'Provide either "model_output" or ("tool"/"name" + "arguments")' }
            });
            break;
          }

          const results = [];
          for (const inv of invocations) {
            const result = await registry.invoke(inv);
            results.push({
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(result, null, 2)
                }
              ]
            });
          }

          sendResponse({
            jsonrpc: '2.0',
            id,
            result: {
              content: results.length === 1 ? results[0].content : results.flatMap(r => r.content)
            }
          });
          break;
        }

        // ---------------------------------------------------------------
        // ping (simple health check)
        // ---------------------------------------------------------------
        case 'ping': {
          sendResponse({
            jsonrpc: '2.0',
            id,
            result: { pong: true, tools: registry.list().length }
          });
          break;
        }

        // ---------------------------------------------------------------
        // Unknown method
        // ---------------------------------------------------------------
        default: {
          sendResponse({
            jsonrpc: '2.0',
            id,
            error: { code: -32601, message: `Unknown method: "${method}"` }
          });
        }
      }
    } catch (e) {
      const isMcpError = e instanceof McpBaseError;
      log.error({ method, error: (e as Error).message, stack: (e as Error).stack }, 'Stdio handler error');

      sendResponse({
        jsonrpc: '2.0',
        id,
        error: {
          code: isMcpError ? -32000 : -32603,
          message: (e as Error).message,
          data: isMcpError ? { errorCode: (e as McpBaseError).code } : undefined
        }
      });
    }
    } catch (outerError) {
      // Final safety net for errors outside request processing
      log.error({ error: (outerError as Error).message, stack: (outerError as Error).stack }, 
        'Critical error in stdio line handler');
      // Can't send response if we don't have an ID, just log
    }
  });

  rl.on('close', () => {
    log.info('Stdin closed — shutting down stdio transport');
    process.exit(0);
  });
}
