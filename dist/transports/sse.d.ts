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
import express from 'express';
import { ToolRegistry } from '../core/registry';
import { ParserRouter } from '../core/parser/router';
import { SessionConfig } from '../core/types';
export declare function createSseTransport(registry: ToolRegistry, parser: ParserRouter, _sessionConfig: SessionConfig): express.Application;
//# sourceMappingURL=sse.d.ts.map