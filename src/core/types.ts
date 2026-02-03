/**
 * core/types.ts
 * 
 * Single source of truth for every shared type in the project.
 * All modules import from here. Nothing defines its own DTOs.
 */

// ---------------------------------------------------------------------------
// Utility: Correlation ID generation
// ---------------------------------------------------------------------------

export function generateCorrelationId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

// ---------------------------------------------------------------------------
// OpenAI Function Schema (what we expose to the LLM)
// ---------------------------------------------------------------------------

export interface OpenAIFunctionParameter {
  type: string;
  properties?: Record<string, OpenAIFunctionParameter>;
  required?: string[];
  items?: OpenAIFunctionParameter;
  description?: string;
  enum?: string[];
  default?: unknown;
}

export interface OpenAIFunctionSchema {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, OpenAIFunctionParameter>;
    required?: string[];
  };
}

// ---------------------------------------------------------------------------
// Session & Transport
// ---------------------------------------------------------------------------

export type TransportMode = 'stdio' | 'http' | 'sse';

export interface SessionConfig {
  transportMode: TransportMode;
  port?: number;                          // HTTP / SSE only
  modelSupportsToolCallTags?: boolean;     // hint from client; undefined = hybrid auto-detect
  elevationPreApproved?: boolean;          // skip per-call UAC for whitelisted tools
  elevationWhitelist?: string[];           // tool names pre-approved for elevation
  logLevel?: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  auditLogPath?: string;                   // file path for the audit trail
  globalTimeoutMs?: number;                // global default timeout for all operations (default: 30000)
  gracefulShutdownTimeoutMs?: number;      // time to wait for active operations during shutdown (default: 5000)
}

// ---------------------------------------------------------------------------
// Parser output — the single normalised shape both parsers emit
// ---------------------------------------------------------------------------

export interface ToolInvocation {
  tool: string;                            // resolved tool name (e.g. "file.delete")
  args: Record<string, unknown>;           // parsed arguments
  meta: CallMeta;
}

export interface CallMeta {
  rawOutput: string;                       // the entire model output that produced this call
  parserUsed: 'embedding' | 'text';        // which parser path was taken
  confidence?: number;                     // text_parser only — 0..1 heuristic confidence
  timestamp: number;                       // Date.now() when the invocation was parsed
  correlationId?: string;                  // optional correlation ID for request tracing
}

// ---------------------------------------------------------------------------
// Tool Module contract — every tool implements this
// ---------------------------------------------------------------------------

export interface ToolModule {
  /** Unique registry key — must match the names used in schemas and TSDs. */
  name: string;

  /**
   * All OpenAI function schemas this module exposes.
   * Most modules expose several (e.g. window_manager exposes window.list,
   * window.focus, window.move …). Each gets its own TSD.
   */
  tools: OpenAIFunctionSchema[];

  /**
   * The single dispatcher. The registry calls this with the resolved schema
   * name so the module can fan out internally if it exposes multiple tools.
   */
  execute(toolName: string, args: Record<string, unknown>): Promise<ToolResult>;
}

// ---------------------------------------------------------------------------
// Result envelope — what execute() returns
// ---------------------------------------------------------------------------

export interface ToolResult {
  success: boolean;
  data?: unknown;                          // the useful payload on success
  error?: ToolError;                       // structured error on failure
  durationMs: number;                      // wall-clock time of the execute() call itself
}

export interface ToolError {
  code: string;                            // maps to our error taxonomy (see errors.ts)
  message: string;
  details?: Record<string, unknown>;       // extra context (e.g. the failing path)
}

// ---------------------------------------------------------------------------
// Task-Specific Definition (TSD)
// ---------------------------------------------------------------------------

export type BackoffStrategy = 'none' | 'linear' | 'exponential';

export interface RetryPolicy {
  maxRetries: number;
  backoff: BackoffStrategy;
  baseDelayMs: number;                     // first delay; multiplied on each retry for exponential
  retryableErrors: string[];               // error codes from ToolError that are worth retrying
}

export interface RateLimitPolicy {
  maxCallsPerSecond: number;
  burstAllowance: number;                  // extra calls allowed in a burst above the steady rate
}

/**
 * Hook references can be either:
 *   - a string name resolved from the hooks/ registry, or
 *   - an inline object with a module path + export name for one-off hooks.
 */
export type HookRef =
  | string
  | { module: string; export: string };

export interface TaskSpecificDefinition {
  toolName: string;

  retryPolicy?: RetryPolicy;
  timeoutMs?: number;                      // hard wall-clock cap on a single execution attempt

  /** Tighter JSON Schema that overrides (intersects with) the base tool schema. */
  inputValidation?: Record<string, unknown>;

  /** Named or inline hook that runs BEFORE execute(). Can mutate args. */
  preHook?: HookRef;

  /** Named or inline hook that runs AFTER execute(). Can mutate result. */
  postHook?: HookRef;

  /** If this tool fails after all retries, try this tool name instead. */
  fallbackTool?: string;

  /** Whether this tool needs administrator privileges. */
  requiresElevation?: boolean;

  rateLimits?: RateLimitPolicy;
}

// ---------------------------------------------------------------------------
// Hook contract
// ---------------------------------------------------------------------------

export interface PreHookContext {
  toolName: string;
  args: Record<string, unknown>;
  sessionConfig: SessionConfig;
}

export interface PostHookContext {
  toolName: string;
  args: Record<string, unknown>;
  result: ToolResult;
  sessionConfig: SessionConfig;
}

export type PreHookFn  = (ctx: PreHookContext)  => Promise<Record<string, unknown>>; // returns (possibly mutated) args
export type PostHookFn = (ctx: PostHookContext) => Promise<ToolResult>;              // returns (possibly mutated) result

export interface HookModule {
  pre?:  PreHookFn;
  post?: PostHookFn;
}
