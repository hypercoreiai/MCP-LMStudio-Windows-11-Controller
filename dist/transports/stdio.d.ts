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
import { ToolRegistry } from '../core/registry';
import { ParserRouter } from '../core/parser/router';
import { SessionConfig } from '../core/types';
export declare function startStdioTransport(registry: ToolRegistry, parser: ParserRouter, _sessionConfig: SessionConfig): void;
//# sourceMappingURL=stdio.d.ts.map