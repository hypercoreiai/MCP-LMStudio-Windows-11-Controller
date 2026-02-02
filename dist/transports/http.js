"use strict";
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createHttpTransport = createHttpTransport;
const express_1 = __importDefault(require("express"));
const types_1 = require("../core/types");
const errors_1 = require("../core/errors");
const logger_1 = require("../core/logger");
const log = (0, logger_1.scopedLogger)('transports/http');
// Normalize tool name: accept both underscore and dot notation
function normalizeToolName(name) {
    return name.replace(/_/g, '.');
}
function createHttpTransport(registry, parser, sessionConfig) {
    const app = (0, express_1.default)();
    app.use(express_1.default.json());
    // Set request timeout to 110 seconds (slightly less than socket timeout of 120s)
    app.use((req, res, next) => {
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
    app.get('/tools/list', (_req, res) => {
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
    app.post('/tools/call', async (req, res) => {
        const { model_output, tool, name, arguments: toolArgs } = req.body;
        const correlationId = req.headers['x-correlation-id'] || (0, types_1.generateCorrelationId)();
        // Error boundary: catch all errors to prevent server crash
        try {
            let invocations;
            if (model_output) {
                // The client sent raw model output — parse it
                invocations = parser.parse(model_output);
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
            }
            else if (tool || name) {
                // The client already extracted the tool call for us (pre-parsed)
                // Accept both "tool" and "name" fields, normalize underscore to dot notation
                const toolName = normalizeToolName((tool || name));
                invocations = [{
                        tool: toolName,
                        args: toolArgs ?? {},
                        meta: {
                            rawOutput: '',
                            parserUsed: 'text',
                            timestamp: Date.now(),
                            correlationId
                        }
                    }];
            }
            else {
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
        }
        catch (e) {
            const isMcpError = e instanceof errors_1.McpBaseError;
            log.error({ correlationId, error: e.message }, 'Tool call failed');
            res.status(isMcpError ? 400 : 500).json({
                object: 'tool_call_result',
                type: 'error',
                error: {
                    code: isMcpError ? e.code : 'INTERNAL_ERROR',
                    message: e.message
                }
            });
        }
    });
    // -----------------------------------------------------------------------
    // GET /health
    // -----------------------------------------------------------------------
    app.get('/health', (_req, res) => {
        res.json({ status: 'ok', tools: registry.list().length });
    });
    // -----------------------------------------------------------------------
    // Error handler (Error boundary for unhandled errors)
    // -----------------------------------------------------------------------
    app.use((err, req, res, _next) => {
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
//# sourceMappingURL=http.js.map