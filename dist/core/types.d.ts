/**
 * core/types.ts
 *
 * Single source of truth for every shared type in the project.
 * All modules import from here. Nothing defines its own DTOs.
 */
export declare function generateCorrelationId(): string;
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
export type TransportMode = 'stdio' | 'http' | 'sse';
export interface SessionConfig {
    transportMode: TransportMode;
    port?: number;
    modelSupportsToolCallTags?: boolean;
    elevationPreApproved?: boolean;
    elevationWhitelist?: string[];
    logLevel?: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
    auditLogPath?: string;
    globalTimeoutMs?: number;
    gracefulShutdownTimeoutMs?: number;
}
export interface ToolInvocation {
    tool: string;
    args: Record<string, unknown>;
    meta: CallMeta;
}
export interface CallMeta {
    rawOutput: string;
    parserUsed: 'embedding' | 'text';
    confidence?: number;
    timestamp: number;
    correlationId?: string;
}
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
export interface ToolResult {
    success: boolean;
    data?: unknown;
    error?: ToolError;
    durationMs: number;
}
export interface ToolError {
    code: string;
    message: string;
    details?: Record<string, unknown>;
}
export type BackoffStrategy = 'none' | 'linear' | 'exponential';
export interface RetryPolicy {
    maxRetries: number;
    backoff: BackoffStrategy;
    baseDelayMs: number;
    retryableErrors: string[];
}
export interface RateLimitPolicy {
    maxCallsPerSecond: number;
    burstAllowance: number;
}
/**
 * Hook references can be either:
 *   - a string name resolved from the hooks/ registry, or
 *   - an inline object with a module path + export name for one-off hooks.
 */
export type HookRef = string | {
    module: string;
    export: string;
};
export interface TaskSpecificDefinition {
    toolName: string;
    retryPolicy?: RetryPolicy;
    timeoutMs?: number;
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
export type PreHookFn = (ctx: PreHookContext) => Promise<Record<string, unknown>>;
export type PostHookFn = (ctx: PostHookContext) => Promise<ToolResult>;
export interface HookModule {
    pre?: PreHookFn;
    post?: PostHookFn;
}
//# sourceMappingURL=types.d.ts.map