/**
 * core/errors.ts
 *
 * Typed error hierarchy. Every throw site uses one of these.
 * The `code` property is what shows up in ToolError.code and what
 * TSD retryPolicy.retryableErrors matches against.
 */
export declare class McpBaseError extends Error {
    readonly code: string;
    readonly details?: Record<string, unknown>;
    constructor(message: string, code: string, details?: Record<string, unknown>);
}
/** Model output could not be interpreted as a tool call at all. */
export declare class ParseError extends McpBaseError {
    constructor(message: string, details?: Record<string, unknown>);
}
/** A <tool_call> tag was found but its JSON payload is malformed. */
export declare class MalformedToolCallError extends McpBaseError {
    constructor(rawTag: string);
}
/** Arguments failed the tool's OpenAI schema or the TSD's stricter schema. */
export declare class ValidationError extends McpBaseError {
    constructor(toolName: string, violations: unknown[]);
}
/** A required argument is missing entirely. */
export declare class MissingArgumentError extends McpBaseError {
    constructor(toolName: string, argName: string);
}
/** The LLM requested a tool name that doesn't exist in the registry. */
export declare class UnknownToolError extends McpBaseError {
    constructor(toolName: string);
}
/** The underlying Windows API call failed. */
export declare class ExecutionError extends McpBaseError {
    constructor(toolName: string, message: string, details?: Record<string, unknown>);
}
/** A file or directory path does not exist. */
export declare class PathNotFoundError extends McpBaseError {
    constructor(path: string);
}
/** The target file / key is locked or in use by another process. */
export declare class ResourceInUseError extends McpBaseError {
    constructor(resource: string);
}
/** Access denied by the OS — usually a permissions issue. */
export declare class AccessDeniedError extends McpBaseError {
    constructor(resource: string);
}
/** The requested path is outside the configured sandbox. */
export declare class SandboxViolationError extends McpBaseError {
    constructor(requestedPath: string, allowedPrefixes: string[]);
}
/** The tool requires elevation and UAC was denied or not available. */
export declare class ElevationError extends McpBaseError {
    constructor(toolName: string);
}
/** TSD timeout was exceeded. */
export declare class TimeoutError extends McpBaseError {
    constructor(toolName: string, timeoutMs: number);
}
/** Tool was called more frequently than its TSD allows. */
export declare class RateLimitError extends McpBaseError {
    constructor(toolName: string);
}
/** A pre- or post-hook threw an error. */
export declare class HookError extends McpBaseError {
    constructor(hookName: string, phase: 'pre' | 'post', cause: Error);
}
/** A hook name referenced in a TSD could not be found in the hook registry. */
export declare class HookNotFoundError extends McpBaseError {
    constructor(hookRef: string);
}
//# sourceMappingURL=errors.d.ts.map