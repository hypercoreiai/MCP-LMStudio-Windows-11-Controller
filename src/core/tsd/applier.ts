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

import Ajv from 'ajv';
import { TaskSpecificDefinition, ToolInvocation, ToolResult, SessionConfig } from '../types';
import { runPreHook, runPostHook } from '../hooks';
import {
  TimeoutError,
  RateLimitError,
  ElevationError,
  ValidationError,
  McpBaseError
} from '../errors';
import { scopedLogger } from '../logger';

const log = scopedLogger('core/tsd/applier');
const ajv = new Ajv({ allErrors: true });

// ---------------------------------------------------------------------------
// Rate limit state (in-memory, per tool)
// ---------------------------------------------------------------------------

interface RateLimitState {
  timestamps: number[]; // sliding window of call timestamps
  lastCleanup: number;  // timestamp of last cleanup to prevent unbounded growth
}

const rateLimitStates = new Map<string, RateLimitState>();
const MAX_RATE_LIMIT_ENTRIES = 1000; // Prevent unbounded memory growth
const CLEANUP_INTERVAL_MS = 60000; // Cleanup old entries every minute

function checkRateLimit(tsd: TaskSpecificDefinition): void {
  if (!tsd.rateLimits) return;

  const { maxCallsPerSecond, burstAllowance } = tsd.rateLimits;
  const now = Date.now();
  const windowStart = now - 1000; // 1-second sliding window
  const maxTotal = maxCallsPerSecond + burstAllowance;

  let state = rateLimitStates.get(tsd.toolName);
  if (!state) {
    state = { timestamps: [], lastCleanup: now };
    rateLimitStates.set(tsd.toolName, state);
  }

  // Evict timestamps outside the window
  state.timestamps = state.timestamps.filter(ts => ts > windowStart);

  // Periodic cleanup: remove empty or stale entries to prevent memory leak
  if (now - state.lastCleanup > CLEANUP_INTERVAL_MS) {
    state.lastCleanup = now;
    // Clean up entries from other tools that haven't been used recently
    for (const [toolName, toolState] of rateLimitStates.entries()) {
      if (toolState.timestamps.length === 0 || 
          (toolState.timestamps[toolState.timestamps.length - 1] < now - CLEANUP_INTERVAL_MS)) {
        rateLimitStates.delete(toolName);
        log.debug({ tool: toolName }, 'Cleaned up stale rate limit entry');
      }
    }
    // Enforce max entries limit
    if (rateLimitStates.size > MAX_RATE_LIMIT_ENTRIES) {
      log.warn({ size: rateLimitStates.size, max: MAX_RATE_LIMIT_ENTRIES }, 
        'Rate limit cache exceeded max size, clearing oldest entries');
      const sortedEntries = Array.from(rateLimitStates.entries())
        .sort((a, b) => (b[1].lastCleanup || 0) - (a[1].lastCleanup || 0));
      for (let i = MAX_RATE_LIMIT_ENTRIES; i < sortedEntries.length; i++) {
        rateLimitStates.delete(sortedEntries[i][0]);
      }
    }
  }

  if (state.timestamps.length >= maxTotal) {
    throw new RateLimitError(tsd.toolName);
  }

  // Record this call
  state.timestamps.push(now);
}

// ---------------------------------------------------------------------------
// Elevation check
// ---------------------------------------------------------------------------

async function checkElevation(
  tsd: TaskSpecificDefinition,
  sessionConfig: SessionConfig
): Promise<void> {
  if (!tsd.requiresElevation) return;

  // If the session has pre-approved this tool, skip
  if (sessionConfig.elevationPreApproved &&
      sessionConfig.elevationWhitelist?.includes(tsd.toolName)) {
    log.debug({ tool: tsd.toolName }, 'Elevation pre-approved by session');
    return;
  }

  // Attempt to detect if we're already elevated (Windows only)
  // On non-Windows (dev machines), we just log and continue.
  if (process.platform === 'win32') {
    const { execSync } = require('child_process');
    try {
      // net session succeeds only if running as admin
      execSync('net session', { stdio: 'pipe' });
      log.debug({ tool: tsd.toolName }, 'Already running as administrator');
      return;
    } catch {
      // Not elevated — throw
      throw new ElevationError(tsd.toolName);
    }
  }

  // Non-Windows: assume OK (dev/test environment)
  log.debug({ tool: tsd.toolName }, 'Non-Windows platform — elevation check skipped');
}

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

function validateInput(tsd: TaskSpecificDefinition, args: Record<string, unknown>): void {
  if (!tsd.inputValidation) return;

  const valid = ajv.validate(tsd.inputValidation, args);
  if (!valid) {
    throw new ValidationError(tsd.toolName, ajv.errors ?? []);
  }
}

// ---------------------------------------------------------------------------
// Backoff helper
// ---------------------------------------------------------------------------

function computeDelay(tsd: TaskSpecificDefinition, attempt: number): number {
  const policy = tsd.retryPolicy;
  if (!policy) return 0;

  switch (policy.backoff) {
    case 'none':    return 0;
    case 'linear':  return policy.baseDelayMs * attempt;
    case 'exponential': return policy.baseDelayMs * Math.pow(2, attempt);
    default:        return 0;
  }
}

// ---------------------------------------------------------------------------
// Single-attempt executor with timeout
// ---------------------------------------------------------------------------

async function executeWithTimeout(
  executeFn: () => Promise<ToolResult>,
  timeoutMs: number | undefined,
  toolName: string
): Promise<ToolResult> {
  if (!timeoutMs) return executeFn();

  let timeoutHandle: NodeJS.Timeout | undefined;
  
  try {
    return await Promise.race([
      executeFn(),
      new Promise<ToolResult>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(new TimeoutError(toolName, timeoutMs));
        }, timeoutMs);
      })
    ]);
  } finally {
    // Clear timeout to prevent memory leak
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

// ---------------------------------------------------------------------------
// Main public API
// ---------------------------------------------------------------------------

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
export async function applyTsd(
  invocation: ToolInvocation,
  tsd: TaskSpecificDefinition | undefined,
  sessionConfig: SessionConfig,
  executeFn: ApplierExecuteFn,
  fallbackFn?: ApplierExecuteFn
): Promise<ToolResult> {
  const toolName = invocation.tool;
  const startTime = Date.now();

  // If no TSD at all, just execute directly
  if (!tsd) {
    log.debug({ tool: toolName }, 'No TSD configured — executing without policies');
    const result = await executeFn(toolName, invocation.args);
    result.durationMs = Date.now() - startTime;
    return result;
  }

  // 1. Rate limit
  checkRateLimit(tsd);

  // 2. Elevation
  await checkElevation(tsd, sessionConfig);

  // 3. Input validation
  validateInput(tsd, invocation.args);

  // 4. Pre-hook
  let args = invocation.args;
  if (tsd.preHook) {
    args = await runPreHook(tsd.preHook, {
      toolName,
      args,
      sessionConfig
    });
  }

  // 5. Retry loop
  const maxAttempts = (tsd.retryPolicy?.maxRetries ?? 0) + 1;
  let lastError: McpBaseError | Error | undefined;
  let result: ToolResult | undefined;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) {
      const delay = computeDelay(tsd, attempt);
      log.debug({ tool: toolName, attempt, delayMs: delay }, 'Retrying after delay');
      await new Promise(resolve => setTimeout(resolve, delay));
    }

    try {
      result = await executeWithTimeout(
        () => executeFn(toolName, args),
        tsd.timeoutMs,
        toolName
      );

      // If execution succeeded, break out of retry loop
      if (result.success) break;

      // Execution "succeeded" at the transport level but the tool reported failure.
      // Check if the error code is retryable.
      const errorCode = result.error?.code ?? '';
      const isRetryable = tsd.retryPolicy?.retryableErrors.includes(errorCode) ?? false;

      if (!isRetryable || attempt === maxAttempts - 1) break;

      log.debug({ tool: toolName, errorCode, attempt }, 'Retryable error — will retry');

    } catch (e) {
      lastError = e as Error;

      // Check if this exception's code is retryable
      const code = (e as McpBaseError).code ?? '';
      const isRetryable = tsd.retryPolicy?.retryableErrors.includes(code) ?? false;

      if (!isRetryable || attempt === maxAttempts - 1) {
        // Not retryable or last attempt — convert to a failed ToolResult
        result = {
          success: false,
          error: {
            code: (e as McpBaseError).code ?? 'UNKNOWN_ERROR',
            message: (e as Error).message
          },
          durationMs: Date.now() - startTime
        };
        break;
      }

      log.debug({ tool: toolName, code, attempt }, 'Retryable exception — will retry');
    }
  }

  // If we still don't have a result something went very wrong
  if (!result) {
    result = {
      success: false,
      error: { code: 'UNKNOWN_ERROR', message: lastError?.message ?? 'Unknown failure' },
      durationMs: Date.now() - startTime
    };
  }

  // 6. Fallback — only if all retries are exhausted AND a fallback is configured
  if (!result.success && tsd.fallbackTool && fallbackFn) {
    log.info({ tool: toolName, fallback: tsd.fallbackTool }, 'Activating fallback tool');
    try {
      result = await fallbackFn(tsd.fallbackTool, args);
    } catch (e) {
      log.error({ fallback: tsd.fallbackTool, error: (e as Error).message }, 'Fallback tool also failed');
      // Keep the original failure result
    }
  }

  // 7. Post-hook
  if (tsd.postHook) {
    result = await runPostHook(tsd.postHook, {
      toolName,
      args,
      result,
      sessionConfig
    });
  }

  result.durationMs = Date.now() - startTime;
  return result;
}
