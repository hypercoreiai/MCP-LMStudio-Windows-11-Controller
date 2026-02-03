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
import { HookNotFoundError, HookError } from './errors';
import { scopedLogger } from './logger';

const log = scopedLogger('core/hooks');

// The registry: name → { pre?, post? }
const hookRegistry = new Map<string, HookModule>();

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerHook(name: string, mod: HookModule): void {
  hookRegistry.set(name, mod);
  log.debug({ name }, 'Hook registered');
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/**
 * Given a HookRef (string name or { module, export } object),
 * return the HookModule. Throws if not found.
 */
export function resolveHook(ref: HookRef): HookModule {
  if (typeof ref === 'string') {
    const mod = hookRegistry.get(ref);
    if (!mod) throw new HookNotFoundError(ref);
    return mod;
  }

  // Inline module reference — attempt dynamic require with whitelist
  // Whitelist of allowed hook modules for security
  const allowedHookModules = [
    './hooks',
    '../hooks',
    './builtin-hooks',
    '../builtin-hooks'
  ];
  
  if (!allowedHookModules.includes(ref.module)) {
    log.error({ module: ref.module }, 'Hook module not in whitelist');
    throw new HookNotFoundError(`${ref.module}#${ref.export} - not in whitelist`);
  }
  
  try {
    const mod = require(ref.module);
    const hookMod = mod[ref.export] as HookModule;
    if (!hookMod) throw new HookNotFoundError(`${ref.module}#${ref.export}`);
    return hookMod;
  } catch (e) {
    throw new HookNotFoundError(`${ref.module}#${ref.export}`);
  }
}

/**
 * Safe pre-hook runner. Resolves the ref, calls .pre(), wraps errors.
 */
export async function runPreHook(
  ref: HookRef,
  ctx: Parameters<PreHookFn>[0]
): Promise<Record<string, unknown>> {
  const hookName = typeof ref === 'string' ? ref : `${ref.module}#${ref.export}`;
  const mod = resolveHook(ref);

  if (!mod.pre) {
    log.debug({ hookName }, 'Hook has no pre function — skipping');
    return ctx.args;
  }

  try {
    return await mod.pre(ctx);
  } catch (e) {
    throw new HookError(hookName, 'pre', e as Error);
  }
}

/**
 * Safe post-hook runner. Resolves the ref, calls .post(), wraps errors.
 */
export async function runPostHook(
  ref: HookRef,
  ctx: Parameters<PostHookFn>[0]
): Promise<typeof ctx.result> {
  const hookName = typeof ref === 'string' ? ref : `${ref.module}#${ref.export}`;
  const mod = resolveHook(ref);

  if (!mod.post) {
    log.debug({ hookName }, 'Hook has no post function — skipping');
    return ctx.result;
  }

  try {
    return await mod.post(ctx);
  } catch (e) {
    throw new HookError(hookName, 'post', e as Error);
  }
}

// ---------------------------------------------------------------------------
// List all registered hooks (for introspection / debugging)
// ---------------------------------------------------------------------------

export function listHooks(): string[] {
  return Array.from(hookRegistry.keys());
}

// ===========================================================================
// Built-in hooks
// ===========================================================================

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

/**
 * backup_target (pre)
 * Copies the target file or registry key to a timestamped backup location
 * before a destructive operation runs.
 * 
 * Expects args to contain either:
 *   - { path: string }          → file backup
 *   - { keyPath: string }       → registry export
 */
registerHook('backup_target', {
  pre: async (ctx) => {
    const backupDir = path.resolve(process.cwd(), '.backups');
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

    if (typeof ctx.args.path === 'string') {
      const src = ctx.args.path as string;
      if (fs.existsSync(src)) {
        const dest = path.join(backupDir, `${timestamp}_${path.basename(src)}`);
        fs.copyFileSync(src, dest);
        log.info({ src, dest }, 'File backed up');
      }
    } else if (typeof ctx.args.keyPath === 'string') {
      const keyPath = ctx.args.keyPath as string;
      const dest = path.join(backupDir, `${timestamp}_registry_export.reg`);
      try {
        execSync(`reg export "${keyPath}" "${dest}" /y`, { stdio: 'pipe' });
        log.info({ keyPath, dest }, 'Registry key backed up');
      } catch {
        log.warn({ keyPath }, 'Registry backup failed — key may not exist');
      }
    }

    return ctx.args; // pass through unchanged
  }
});

/**
 * screenshot_focus (pre)
 * Captures a screenshot of the current desktop and attaches it to args
 * as a base64 string under args._screenshot. This gives visual grounding
 * to input-related tools.
 * 
 * Uses PowerShell + Windows screenshot API.
 */
registerHook('screenshot_focus', {
  pre: async (ctx) => {
    try {
      // PowerShell one-liner: capture primary monitor, save to temp, read as base64
      const ps = `
        Add-Type -AssemblyName System.Windows.Forms;
        $screen = [System.Windows.Forms.Screen]::PrimaryScreen;
        $bmp = New-Object System.Drawing.Bitmap($screen.Bounds.Width, $screen.Bounds.Height);
        $g = [System.Drawing.Graphics]::FromImage($bmp);
        $g.CopyFromScreen($screen.Bounds.Location, [System.Drawing.Point]::Empty, $screen.Bounds.Size);
        $g.Dispose();
        $ms = New-Object System.IO.MemoryStream;
        $bmp.Save($ms, 'PNG');
        $bmp.Dispose();
        [Convert]::ToBase64String($ms.ToArray());
      `.trim();

      const base64 = execSync(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${ps.replace(/"/g, '`"')}"`, {
        encoding: 'utf-8',
        timeout: 5000
      }).trim();

      return { ...ctx.args, _screenshot: base64 };
    } catch {
      log.warn('screenshot_focus: failed to capture screenshot — continuing without it');
      return ctx.args;
    }
  }
});

/**
 * verify_deleted (post)
 * Confirms that args.path no longer exists on disk.
 * Flips result.success to false if the path still exists.
 */
registerHook('verify_deleted', {
  post: async (ctx) => {
    const targetPath = ctx.args.path as string;
    if (targetPath && fs.existsSync(targetPath)) {
      return {
        ...ctx.result,
        success: false,
        error: {
          code: 'VERIFY_FAILED',
          message: `Verification failed: "${targetPath}" still exists after deletion`
        }
      };
    }
    return ctx.result;
  }
});

/**
 * verify_exists (post)
 * Confirms that args.path now exists on disk.
 */
registerHook('verify_exists', {
  post: async (ctx) => {
    const targetPath = ctx.args.path as string;
    if (targetPath && !fs.existsSync(targetPath)) {
      return {
        ...ctx.result,
        success: false,
        error: {
          code: 'VERIFY_FAILED',
          message: `Verification failed: "${targetPath}" does not exist after operation`
        }
      };
    }
    return ctx.result;
  }
});

/**
 * log_action (pre + post)
 * Appends a structured JSON line to an audit log file.
 */
registerHook('log_action', {
  pre: async (ctx) => {
    const entry = {
      phase: 'pre',
      tool: ctx.toolName,
      args: ctx.args,
      timestamp: new Date().toISOString()
    };
    appendAuditLog(entry);
    return ctx.args;
  },
  post: async (ctx) => {
    const entry = {
      phase: 'post',
      tool: ctx.toolName,
      result: ctx.result,
      timestamp: new Date().toISOString()
    };
    appendAuditLog(entry);
    return ctx.result;
  }
});

function appendAuditLog(entry: Record<string, unknown>): void {
  const logPath = path.resolve(process.cwd(), 'audit.log');
  fs.appendFileSync(logPath, JSON.stringify(entry) + '\n');
}

/**
 * poll_for_window (post)
 * After a process.start, waits up to args._pollTimeoutMs (default 3000)
 * for a window with a matching title substring to appear.
 * Attaches the window handle info to result.data if found.
 */
registerHook('poll_for_window', {
  post: async (ctx) => {
    const timeoutMs = (ctx.args._pollTimeoutMs as number) ?? 3000;
    const titleHint = (ctx.args._windowTitleHint as string) ?? '';
    const pollInterval = 200; // ms between checks
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      try {
        // Query all windows via PowerShell and look for the title hint
        const ps = `
          Get-CimInstance -ClassName Win32_Process |
          Where-Object { $_.MainWindowTitle -like "*${titleHint}*" } |
          Select-Object -First 1 -ExpandProperty ProcessId
        `.trim();

        const pid = execSync(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${ps}"`, {
          encoding: 'utf-8',
          timeout: 2000
        }).trim();

        if (pid) {
          log.info({ titleHint, pid }, 'poll_for_window: window found');
          return {
            ...ctx.result,
            data: { ...((ctx.result.data as Record<string, unknown>) ?? {}), windowPid: parseInt(pid, 10) }
          };
        }
      } catch {
        // Window not found yet — keep polling
      }

      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    log.warn({ titleHint, timeoutMs }, 'poll_for_window: timed out waiting for window');
    return ctx.result; // return original result — not a hard failure
  }
});
