/**
 * core/hooks.ts
 *
 * Central registry for named hooks.
 * TSDs reference hooks by string name (e.g. "backup_target").
 * This module resolves those names to actual functions.
 *
 * Built-in hooks are registered at the bottom of this file.
 * Application code can add custom hooks via registerHook().
 */
import { HookRef, HookModule, PreHookFn, PostHookFn } from './types';
export declare function registerHook(name: string, mod: HookModule): void;
/**
 * Given a HookRef (string name or { module, export } object),
 * return the HookModule. Throws if not found.
 */
export declare function resolveHook(ref: HookRef): HookModule;
/**
 * Safe pre-hook runner. Resolves the ref, calls .pre(), wraps errors.
 */
export declare function runPreHook(ref: HookRef, ctx: Parameters<PreHookFn>[0]): Promise<Record<string, unknown>>;
/**
 * Safe post-hook runner. Resolves the ref, calls .post(), wraps errors.
 */
export declare function runPostHook(ref: HookRef, ctx: Parameters<PostHookFn>[0]): Promise<typeof ctx.result>;
export declare function listHooks(): string[];
//# sourceMappingURL=hooks.d.ts.map