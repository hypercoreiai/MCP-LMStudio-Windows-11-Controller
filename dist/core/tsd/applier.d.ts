/**
 * core/tsd/applier.ts
 *
 * The applier is the execution wrapper that sits between the registry
 * and the tool module's execute(). It reads the TSD for a given tool
 * and applies every policy in order:
 *
 *   1. Rate limit check
 *   2. Elevation check (+ UAC if needed)
 *   3. Input validation (TSD's stricter schema, if any)
 *   4. Pre-hook
 *   5. Retry loop with timeout (each attempt gets its own timeout)
 *       └─ execute()
 *   6. Post-hook
 *   7. Fallback (if all retries exhausted and a fallback tool is configured)
 *
 * This module is stateful only for rate limiting (per-tool call counters).
 */
import { TaskSpecificDefinition, ToolInvocation, ToolResult, SessionConfig } from '../types';
export interface ApplierExecuteFn {
    (toolName: string, args: Record<string, unknown>): Promise<ToolResult>;
}
/**
 * Wrap a raw tool execute function with all TSD policies.
 *
 * @param invocation      The parsed tool invocation
 * @param tsd             The TSD for this tool (may be undefined if none configured)
 * @param sessionConfig   Current session config
 * @param executeFn       The tool module's execute() — called inside the retry loop
 * @param fallbackFn      Optional: if provided and all retries fail, this is called
 *                         with the fallback tool name
 */
export declare function applyTsd(invocation: ToolInvocation, tsd: TaskSpecificDefinition | undefined, sessionConfig: SessionConfig, executeFn: ApplierExecuteFn, fallbackFn?: ApplierExecuteFn): Promise<ToolResult>;
//# sourceMappingURL=applier.d.ts.map