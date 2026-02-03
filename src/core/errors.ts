/**
 * core/errors.ts
 * 
 * Typed error hierarchy. Every throw site uses one of these.
 * The `code` property is what shows up in ToolError.code and what
 * TSD retryPolicy.retryableErrors matches against.
 */

export class McpBaseError extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(message: string, code: string, details?: Record<string, unknown>) {
    super(message);
    this.code = code;
    this.details = details;
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, new.target.prototype); // fix instanceof in TS
  }
}

// ---------------------------------------------------------------------------
// Parse-layer errors
// ---------------------------------------------------------------------------

/** Model output could not be interpreted as a tool call at all. */
export class ParseError extends McpBaseError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'PARSE_ERROR', details);
  }
}

/** A <tool_call> tag was found but its JSON payload is malformed. */
export class MalformedToolCallError extends McpBaseError {
  constructor(rawTag: string) {
    super(
      `Malformed JSON inside <tool_call> tag`,
      'MALFORMED_TOOL_CALL',
      { rawTag }
    );
  }
}

// ---------------------------------------------------------------------------
// Validation errors
// ---------------------------------------------------------------------------

/** Arguments failed the tool's OpenAI schema or the TSD's stricter schema. */
export class ValidationError extends McpBaseError {
  constructor(toolName: string, violations: unknown[]) {
    super(
      `Validation failed for tool "${toolName}"`,
      'VALIDATION_ERROR',
      { toolName, violations }
    );
  }
}

/** A required argument is missing entirely. */
export class MissingArgumentError extends McpBaseError {
  constructor(toolName: string, argName: string) {
    super(
      `Missing required argument "${argName}" for tool "${toolName}"`,
      'MISSING_ARGUMENT',
      { toolName, argName }
    );
  }
}

// ---------------------------------------------------------------------------
// Registry / dispatch errors
// ---------------------------------------------------------------------------

/** The LLM requested a tool name that doesn't exist in the registry. */
export class UnknownToolError extends McpBaseError {
  constructor(toolName: string) {
    super(
      `Unknown tool: "${toolName}"`,
      'UNKNOWN_TOOL',
      { toolName }
    );
  }
}

// ---------------------------------------------------------------------------
// Execution errors (Windows API layer)
// ---------------------------------------------------------------------------

/** The underlying Windows API call failed. */
export class ExecutionError extends McpBaseError {
  constructor(toolName: string, message: string, details?: Record<string, unknown>) {
    super(message, 'EXECUTION_ERROR', { toolName, ...details });
  }
}

/** A file or directory path does not exist. */
export class PathNotFoundError extends McpBaseError {
  constructor(path: string) {
    super(`Path not found: "${path}"`, 'PATH_NOT_FOUND', { path });
  }
}

/** The target file / key is locked or in use by another process. */
export class ResourceInUseError extends McpBaseError {
  constructor(resource: string) {
    super(`Resource is in use: "${resource}"`, 'FILE_IN_USE', { resource });
  }
}

/** Access denied by the OS — usually a permissions issue. */
export class AccessDeniedError extends McpBaseError {
  constructor(resource: string) {
    super(`Access denied: "${resource}"`, 'ACCESS_DENIED', { resource });
  }
}

/** The requested path is outside the configured sandbox. */
export class SandboxViolationError extends McpBaseError {
  constructor(requestedPath: string, allowedPrefixes: string[]) {
    super(
      `Path "${requestedPath}" is outside the allowed sandbox`,
      'SANDBOX_VIOLATION',
      { requestedPath, allowedPrefixes }
    );
  }
}

// ---------------------------------------------------------------------------
// Elevation / UAC errors
// ---------------------------------------------------------------------------

/** The tool requires elevation and UAC was denied or not available. */
export class ElevationError extends McpBaseError {
  constructor(toolName: string) {
    super(
      `Tool "${toolName}" requires administrator privileges and elevation was denied`,
      'ELEVATION_DENIED',
      { toolName }
    );
  }
}

// ---------------------------------------------------------------------------
// Timeout errors
// ---------------------------------------------------------------------------

/** TSD timeout was exceeded. */
export class TimeoutError extends McpBaseError {
  constructor(toolName: string, timeoutMs: number) {
    super(
      `Tool "${toolName}" exceeded timeout of ${timeoutMs}ms`,
      'TIMEOUT',
      { toolName, timeoutMs }
    );
  }
}

// ---------------------------------------------------------------------------
// Rate-limit errors
// ---------------------------------------------------------------------------

/** Tool was called more frequently than its TSD allows. */
export class RateLimitError extends McpBaseError {
  constructor(toolName: string) {
    super(
      `Rate limit exceeded for tool "${toolName}"`,
      'RATE_LIMIT_EXCEEDED',
      { toolName }
    );
  }
}

// ---------------------------------------------------------------------------
// Hook errors
// ---------------------------------------------------------------------------

/** A pre- or post-hook threw an error. */
export class HookError extends McpBaseError {
  constructor(hookName: string, phase: 'pre' | 'post', cause: Error) {
    super(
      `Hook "${hookName}" failed in ${phase} phase: ${cause.message}`,
      'HOOK_ERROR',
      { hookName, phase, originalError: cause.message }
    );
  }
}

/** A hook name referenced in a TSD could not be found in the hook registry. */
export class HookNotFoundError extends McpBaseError {
  constructor(hookRef: string) {
    super(`Hook not found: "${hookRef}"`, 'HOOK_NOT_FOUND', { hookRef });
  }
}
