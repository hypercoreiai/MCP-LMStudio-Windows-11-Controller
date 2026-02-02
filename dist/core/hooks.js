"use strict";
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerHook = registerHook;
exports.resolveHook = resolveHook;
exports.runPreHook = runPreHook;
exports.runPostHook = runPostHook;
exports.listHooks = listHooks;
const errors_1 = require("./errors");
const logger_1 = require("./logger");
const log = (0, logger_1.scopedLogger)('core/hooks');
// The registry: name → { pre?, post? }
const hookRegistry = new Map();
// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------
function registerHook(name, mod) {
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
function resolveHook(ref) {
    if (typeof ref === 'string') {
        const mod = hookRegistry.get(ref);
        if (!mod)
            throw new errors_1.HookNotFoundError(ref);
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
        throw new errors_1.HookNotFoundError(`${ref.module}#${ref.export} - not in whitelist`);
    }
    try {
        const mod = require(ref.module);
        const hookMod = mod[ref.export];
        if (!hookMod)
            throw new errors_1.HookNotFoundError(`${ref.module}#${ref.export}`);
        return hookMod;
    }
    catch (e) {
        throw new errors_1.HookNotFoundError(`${ref.module}#${ref.export}`);
    }
}
/**
 * Safe pre-hook runner. Resolves the ref, calls .pre(), wraps errors.
 */
async function runPreHook(ref, ctx) {
    const hookName = typeof ref === 'string' ? ref : `${ref.module}#${ref.export}`;
    const mod = resolveHook(ref);
    if (!mod.pre) {
        log.debug({ hookName }, 'Hook has no pre function — skipping');
        return ctx.args;
    }
    try {
        return await mod.pre(ctx);
    }
    catch (e) {
        throw new errors_1.HookError(hookName, 'pre', e);
    }
}
/**
 * Safe post-hook runner. Resolves the ref, calls .post(), wraps errors.
 */
async function runPostHook(ref, ctx) {
    const hookName = typeof ref === 'string' ? ref : `${ref.module}#${ref.export}`;
    const mod = resolveHook(ref);
    if (!mod.post) {
        log.debug({ hookName }, 'Hook has no post function — skipping');
        return ctx.result;
    }
    try {
        return await mod.post(ctx);
    }
    catch (e) {
        throw new errors_1.HookError(hookName, 'post', e);
    }
}
// ---------------------------------------------------------------------------
// List all registered hooks (for introspection / debugging)
// ---------------------------------------------------------------------------
function listHooks() {
    return Array.from(hookRegistry.keys());
}
// ===========================================================================
// Built-in hooks
// ===========================================================================
const child_process_1 = require("child_process");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
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
        if (!fs.existsSync(backupDir))
            fs.mkdirSync(backupDir, { recursive: true });
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        if (typeof ctx.args.path === 'string') {
            const src = ctx.args.path;
            if (fs.existsSync(src)) {
                const dest = path.join(backupDir, `${timestamp}_${path.basename(src)}`);
                fs.copyFileSync(src, dest);
                log.info({ src, dest }, 'File backed up');
            }
        }
        else if (typeof ctx.args.keyPath === 'string') {
            const keyPath = ctx.args.keyPath;
            const dest = path.join(backupDir, `${timestamp}_registry_export.reg`);
            try {
                (0, child_process_1.execSync)(`reg export "${keyPath}" "${dest}" /y`, { stdio: 'pipe' });
                log.info({ keyPath, dest }, 'Registry key backed up');
            }
            catch {
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
            const base64 = (0, child_process_1.execSync)(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${ps.replace(/"/g, '`"')}"`, {
                encoding: 'utf-8',
                timeout: 5000
            }).trim();
            return { ...ctx.args, _screenshot: base64 };
        }
        catch {
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
        const targetPath = ctx.args.path;
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
        const targetPath = ctx.args.path;
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
function appendAuditLog(entry) {
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
        const timeoutMs = ctx.args._pollTimeoutMs ?? 3000;
        const titleHint = ctx.args._windowTitleHint ?? '';
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
                const pid = (0, child_process_1.execSync)(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${ps}"`, {
                    encoding: 'utf-8',
                    timeout: 2000
                }).trim();
                if (pid) {
                    log.info({ titleHint, pid }, 'poll_for_window: window found');
                    return {
                        ...ctx.result,
                        data: { ...(ctx.result.data ?? {}), windowPid: parseInt(pid, 10) }
                    };
                }
            }
            catch {
                // Window not found yet — keep polling
            }
            await new Promise(resolve => setTimeout(resolve, pollInterval));
        }
        log.warn({ titleHint, timeoutMs }, 'poll_for_window: timed out waiting for window');
        return ctx.result; // return original result — not a hard failure
    }
});
//# sourceMappingURL=hooks.js.map