"use strict";
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
exports.startStdioTransport = startStdioTransport;
const readline = __importStar(require("readline"));
const types_1 = require("../core/types");
const errors_1 = require("../core/errors");
const logger_1 = require("../core/logger");
const log = (0, logger_1.scopedLogger)('transports/stdio');
// Normalize tool name: accept both underscore and dot notation
function normalizeToolName(name) {
    return name; // No normalization needed
}
function sendResponse(response) {
    process.stdout.write(JSON.stringify(response) + '\n');
}
function startStdioTransport(registry, parser, _sessionConfig) {
    log.info('Stdio transport started — listening on stdin');
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: false
    });
    rl.on('line', async (line) => {
        // Error boundary for entire line processing
        try {
            const trimmed = line.trim();
            if (!trimmed)
                return;
            let request;
            try {
                request = JSON.parse(trimmed);
            }
            catch (parseError) {
                log.warn({ raw: trimmed, error: parseError.message }, 'Failed to parse JSON-RPC request');
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
                        const modelOutput = params?.model_output;
                        const tool = params?.tool;
                        const name = params?.name;
                        const toolArgs = params?.arguments;
                        const correlationId = params?.correlationId || (0, types_1.generateCorrelationId)();
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
                        }
                        else if (tool || name) {
                            // Accept both "tool" and "name" fields, normalize underscore to dot notation
                            const toolName = normalizeToolName((tool || name));
                            invocations = [{
                                    tool: toolName,
                                    args: toolArgs ?? {},
                                    meta: { rawOutput: '', parserUsed: 'text', timestamp: Date.now(), correlationId }
                                }];
                        }
                        else {
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
            }
            catch (e) {
                const isMcpError = e instanceof errors_1.McpBaseError;
                log.error({ method, error: e.message, stack: e.stack }, 'Stdio handler error');
                sendResponse({
                    jsonrpc: '2.0',
                    id,
                    error: {
                        code: isMcpError ? -32000 : -32603,
                        message: e.message,
                        data: isMcpError ? { errorCode: e.code } : undefined
                    }
                });
            }
        }
        catch (outerError) {
            // Final safety net for errors outside request processing
            log.error({ error: outerError.message, stack: outerError.stack }, 'Critical error in stdio line handler');
            // Can't send response if we don't have an ID, just log
        }
    });
    rl.on('close', () => {
        log.info('Stdin closed — shutting down stdio transport');
        process.exit(0);
    });
}
//# sourceMappingURL=stdio.js.map