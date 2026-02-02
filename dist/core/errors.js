"use strict";
/**
 * core/errors.ts
 *
 * Typed error hierarchy. Every throw site uses one of these.
 * The `code` property is what shows up in ToolError.code and what
 * TSD retryPolicy.retryableErrors matches against.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.HookNotFoundError = exports.HookError = exports.RateLimitError = exports.TimeoutError = exports.ElevationError = exports.SandboxViolationError = exports.AccessDeniedError = exports.ResourceInUseError = exports.PathNotFoundError = exports.ExecutionError = exports.UnknownToolError = exports.MissingArgumentError = exports.ValidationError = exports.MalformedToolCallError = exports.ParseError = exports.McpBaseError = void 0;
class McpBaseError extends Error {
    code;
    details;
    constructor(message, code, details) {
        super(message);
        this.code = code;
        this.details = details;
        this.name = this.constructor.name;
        Object.setPrototypeOf(this, new.target.prototype); // fix instanceof in TS
    }
}
exports.McpBaseError = McpBaseError;
// ---------------------------------------------------------------------------
// Parse-layer errors
// ---------------------------------------------------------------------------
/** Model output could not be interpreted as a tool call at all. */
class ParseError extends McpBaseError {
    constructor(message, details) {
        super(message, 'PARSE_ERROR', details);
    }
}
exports.ParseError = ParseError;
/** A <tool_call> tag was found but its JSON payload is malformed. */
class MalformedToolCallError extends McpBaseError {
    constructor(rawTag) {
        super(`Malformed JSON inside <tool_call> tag`, 'MALFORMED_TOOL_CALL', { rawTag });
    }
}
exports.MalformedToolCallError = MalformedToolCallError;
// ---------------------------------------------------------------------------
// Validation errors
// ---------------------------------------------------------------------------
/** Arguments failed the tool's OpenAI schema or the TSD's stricter schema. */
class ValidationError extends McpBaseError {
    constructor(toolName, violations) {
        super(`Validation failed for tool "${toolName}"`, 'VALIDATION_ERROR', { toolName, violations });
    }
}
exports.ValidationError = ValidationError;
/** A required argument is missing entirely. */
class MissingArgumentError extends McpBaseError {
    constructor(toolName, argName) {
        super(`Missing required argument "${argName}" for tool "${toolName}"`, 'MISSING_ARGUMENT', { toolName, argName });
    }
}
exports.MissingArgumentError = MissingArgumentError;
// ---------------------------------------------------------------------------
// Registry / dispatch errors
// ---------------------------------------------------------------------------
/** The LLM requested a tool name that doesn't exist in the registry. */
class UnknownToolError extends McpBaseError {
    constructor(toolName) {
        super(`Unknown tool: "${toolName}"`, 'UNKNOWN_TOOL', { toolName });
    }
}
exports.UnknownToolError = UnknownToolError;
// ---------------------------------------------------------------------------
// Execution errors (Windows API layer)
// ---------------------------------------------------------------------------
/** The underlying Windows API call failed. */
class ExecutionError extends McpBaseError {
    constructor(toolName, message, details) {
        super(message, 'EXECUTION_ERROR', { toolName, ...details });
    }
}
exports.ExecutionError = ExecutionError;
/** A file or directory path does not exist. */
class PathNotFoundError extends McpBaseError {
    constructor(path) {
        super(`Path not found: "${path}"`, 'PATH_NOT_FOUND', { path });
    }
}
exports.PathNotFoundError = PathNotFoundError;
/** The target file / key is locked or in use by another process. */
class ResourceInUseError extends McpBaseError {
    constructor(resource) {
        super(`Resource is in use: "${resource}"`, 'FILE_IN_USE', { resource });
    }
}
exports.ResourceInUseError = ResourceInUseError;
/** Access denied by the OS — usually a permissions issue. */
class AccessDeniedError extends McpBaseError {
    constructor(resource) {
        super(`Access denied: "${resource}"`, 'ACCESS_DENIED', { resource });
    }
}
exports.AccessDeniedError = AccessDeniedError;
/** The requested path is outside the configured sandbox. */
class SandboxViolationError extends McpBaseError {
    constructor(requestedPath, allowedPrefixes) {
        super(`Path "${requestedPath}" is outside the allowed sandbox`, 'SANDBOX_VIOLATION', { requestedPath, allowedPrefixes });
    }
}
exports.SandboxViolationError = SandboxViolationError;
// ---------------------------------------------------------------------------
// Elevation / UAC errors
// ---------------------------------------------------------------------------
/** The tool requires elevation and UAC was denied or not available. */
class ElevationError extends McpBaseError {
    constructor(toolName) {
        super(`Tool "${toolName}" requires administrator privileges and elevation was denied`, 'ELEVATION_DENIED', { toolName });
    }
}
exports.ElevationError = ElevationError;
// ---------------------------------------------------------------------------
// Timeout errors
// ---------------------------------------------------------------------------
/** TSD timeout was exceeded. */
class TimeoutError extends McpBaseError {
    constructor(toolName, timeoutMs) {
        super(`Tool "${toolName}" exceeded timeout of ${timeoutMs}ms`, 'TIMEOUT', { toolName, timeoutMs });
    }
}
exports.TimeoutError = TimeoutError;
// ---------------------------------------------------------------------------
// Rate-limit errors
// ---------------------------------------------------------------------------
/** Tool was called more frequently than its TSD allows. */
class RateLimitError extends McpBaseError {
    constructor(toolName) {
        super(`Rate limit exceeded for tool "${toolName}"`, 'RATE_LIMIT_EXCEEDED', { toolName });
    }
}
exports.RateLimitError = RateLimitError;
// ---------------------------------------------------------------------------
// Hook errors
// ---------------------------------------------------------------------------
/** A pre- or post-hook threw an error. */
class HookError extends McpBaseError {
    constructor(hookName, phase, cause) {
        super(`Hook "${hookName}" failed in ${phase} phase: ${cause.message}`, 'HOOK_ERROR', { hookName, phase, originalError: cause.message });
    }
}
exports.HookError = HookError;
/** A hook name referenced in a TSD could not be found in the hook registry. */
class HookNotFoundError extends McpBaseError {
    constructor(hookRef) {
        super(`Hook not found: "${hookRef}"`, 'HOOK_NOT_FOUND', { hookRef });
    }
}
exports.HookNotFoundError = HookNotFoundError;
//# sourceMappingURL=errors.js.map