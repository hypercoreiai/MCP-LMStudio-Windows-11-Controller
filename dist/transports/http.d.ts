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
import express from 'express';
import { ToolRegistry } from '../core/registry';
import { ParserRouter } from '../core/parser/router';
import { SessionConfig } from '../core/types';
export declare function createHttpTransport(registry: ToolRegistry, parser: ParserRouter, sessionConfig: SessionConfig): express.Application;
//# sourceMappingURL=http.d.ts.map