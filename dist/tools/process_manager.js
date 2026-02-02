"use strict";
/**
 * tools/process_manager.ts
 *
 * Spawn, query, and terminate Windows processes.
 * Uses a combination of Node child_process for spawning and
 * PowerShell/WMI for querying the process table (richer metadata
 * than what Node exposes: parent PID, memory, CPU%).
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
const child_process_1 = require("child_process");
const path = __importStar(require("path"));
const registry_1 = require("../core/registry");
const errors_1 = require("../core/errors");
const logger_1 = require("../core/logger");
const log = (0, logger_1.scopedLogger)('tools/process_manager');
// Keep track of spawned processes for wait/run operations
const spawnedProcesses = new Map();
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
function getProcessIdByName(exePath) {
    const exeName = path.basename(exePath).replace(/\.exe$/i, '');
    const script = `
    $proc = Get-Process -Name '${exeName}' -ErrorAction SilentlyContinue |
      Sort-Object StartTime -Descending |
      Select-Object -First 1 -ExpandProperty Id;
    if ($proc) { $proc } else { '' };
  `;
    const result = ps(script).trim();
    const pid = parseInt(result, 10);
    return Number.isFinite(pid) ? pid : null;
}
function processExists(pid) {
    const script = `
    $proc = Get-Process -Id ${pid} -ErrorAction SilentlyContinue;
    if ($proc) { 'yes' } else { 'no' };
  `;
    return ps(script).trim() === 'yes';
}
// ---------------------------------------------------------------------------
// PowerShell helper
// ---------------------------------------------------------------------------
function ps(script, timeoutMs = 15000) {
    try {
        // Encode script as Base64 UTF-16LE for PowerShell -EncodedCommand
        const buffer = Buffer.from(script, 'utf16le');
        const encoded = buffer.toString('base64');
        return (0, child_process_1.execSync)(`powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${encoded}`, { encoding: 'utf-8', timeout: timeoutMs, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    }
    catch (e) {
        throw new errors_1.ExecutionError('process_manager', e.stderr?.toString() || e.message);
    }
}
// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------
async function handleProcessList(_args) {
    const script = `
    Get-CimInstance -ClassName Win32_Process |
    Select-Object -First 200 ProcessName, Id, ParentProcessId, WorkingSetSize, @{
      Name='CPU';
      Expression={ [math]::Round(($_.UserModeTime + $_.KernelModeTime) / 10000000, 2) }
    } |
    ConvertTo-Json -Depth 2;
  `;
    const raw = ps(script);
    let processes;
    try {
        processes = JSON.parse(raw || '[]');
    }
    catch {
        processes = [];
    }
    return { success: true, data: { processes }, durationMs: 0 };
}
async function handleProcessStart(args) {
    const executable = args.executable;
    const cmdArgs = args.arguments ?? [];
    const workingDir = args.workingDirectory;
    const env = args.environment;
    try {
        const child = (0, child_process_1.spawn)(executable, cmdArgs, {
            cwd: workingDir,
            env: env ? { ...process.env, ...env } : undefined,
            detached: true, // don't die if the MCP server exits
            stdio: 'ignore' // we don't capture stdio for background launches
        });
        child.unref(); // let the parent exit without waiting
        let pid = child.pid;
        spawnedProcesses.set(pid, child);
        // Some apps (e.g., firefox.exe) spawn and exit immediately — wait briefly and resolve a live PID.
        await sleep(300);
        if (!processExists(pid)) {
            const resolvedPid = getProcessIdByName(executable);
            if (resolvedPid) {
                pid = resolvedPid;
            }
            else {
                return {
                    success: false,
                    error: { code: 'PROCESS_NOT_FOUND', message: `Process for ${executable} exited before it could be tracked` },
                    durationMs: 0
                };
            }
        }
        log.info({ executable, pid }, 'Process started');
        return {
            success: true,
            data: { pid, executable, arguments: cmdArgs, workingDirectory: workingDir ?? process.cwd() },
            durationMs: 0
        };
    }
    catch (e) {
        throw new errors_1.ExecutionError('process_manager', e.message, { executable });
    }
}
async function handleProcessKill(args) {
    const pid = args.pid;
    const force = args.force ?? false;
    try {
        if (force) {
            // Forceful termination via taskkill
            (0, child_process_1.execSync)(`taskkill /F /PID ${pid}`, { stdio: 'pipe' });
        }
        else {
            // Graceful — try TerminateProcess via PowerShell first; if the process
            // handles it gracefully (e.g. saves before exit), this is preferred.
            const script = `
        $proc = Get-CimInstance -ClassName Win32_Process -Filter "ProcessId = ${pid}";
        if ($proc) {
          $proc.Terminate();
          Write-Output "terminated";
        } else {
          Write-Output "not_found";
        }
      `;
            const result = ps(script);
            if (result === 'not_found') {
                return { success: false, error: { code: 'PROCESS_NOT_FOUND', message: `No process with PID ${pid}` }, durationMs: 0 };
            }
        }
        spawnedProcesses.delete(pid);
        return { success: true, data: { killed: pid, force }, durationMs: 0 };
    }
    catch (e) {
        throw new errors_1.ExecutionError('process_manager', e.message, { pid });
    }
}
async function handleProcessWait(args) {
    const pid = args.pid;
    const timeoutMs = args.timeoutMs ?? 30000;
    // Check if we spawned this process and have a handle
    const child = spawnedProcesses.get(pid);
    if (child) {
        return new Promise((resolve) => {
            const timer = setTimeout(() => {
                resolve({
                    success: false,
                    error: { code: 'TIMEOUT', message: `Process ${pid} did not exit within ${timeoutMs}ms` },
                    durationMs: 0
                });
            }, timeoutMs);
            child.on('close', (code) => {
                clearTimeout(timer);
                spawnedProcesses.delete(pid);
                resolve({ success: true, data: { pid, exitCode: code }, durationMs: 0 });
            });
            child.on('error', (err) => {
                clearTimeout(timer);
                spawnedProcesses.delete(pid);
                resolve({ success: false, error: { code: 'PROCESS_ERROR', message: err.message }, durationMs: 0 });
            });
        });
    }
    // We don't have a Node handle — poll via WMI until the process disappears or times out
    const deadline = Date.now() + timeoutMs;
    const pollInterval = 500;
    while (Date.now() < deadline) {
        try {
            const script = `
        $proc = Get-CimInstance -ClassName Win32_Process -Filter "ProcessId = ${pid}";
        if ($proc) { Write-Output "running" } else { Write-Output "gone" }
      `;
            const status = ps(script);
            if (status === 'gone') {
                return { success: true, data: { pid, exitCode: null, note: 'Process exited (exit code unavailable — not spawned by this server)' }, durationMs: 0 };
            }
        }
        catch {
            // Query failed — process probably gone
            return { success: true, data: { pid, exitCode: null }, durationMs: 0 };
        }
        await new Promise(r => setTimeout(r, pollInterval));
    }
    return {
        success: false,
        error: { code: 'TIMEOUT', message: `Process ${pid} did not exit within ${timeoutMs}ms` },
        durationMs: 0
    };
}
async function handleProcessRun(args) {
    const executable = args.executable;
    const cmdArgs = args.arguments ?? [];
    const workingDir = args.workingDirectory;
    const timeoutMs = args.timeoutMs ?? 30000;
    return new Promise((resolve) => {
        const child = (0, child_process_1.spawn)(executable, cmdArgs, {
            cwd: workingDir,
            stdio: ['pipe', 'pipe', 'pipe']
        });
        let stdout = '';
        let stderr = '';
        child.stdout?.on('data', (chunk) => { stdout += chunk.toString(); });
        child.stderr?.on('data', (chunk) => { stderr += chunk.toString(); });
        const timer = setTimeout(() => {
            child.kill('SIGKILL');
            resolve({
                success: false,
                error: { code: 'TIMEOUT', message: `Process did not complete within ${timeoutMs}ms` },
                durationMs: 0
            });
        }, timeoutMs);
        child.on('close', (code) => {
            clearTimeout(timer);
            resolve({
                success: code === 0,
                data: { exitCode: code, stdout: stdout.trim(), stderr: stderr.trim() },
                error: code !== 0 ? { code: 'NON_ZERO_EXIT', message: `Process exited with code ${code}` } : undefined,
                durationMs: 0
            });
        });
        child.on('error', (err) => {
            clearTimeout(timer);
            resolve({
                success: false,
                error: { code: 'SPAWN_ERROR', message: err.message },
                durationMs: 0
            });
        });
    });
}
// ---------------------------------------------------------------------------
// Module definition + registration
// ---------------------------------------------------------------------------
const processManager = {
    name: 'process_manager',
    tools: [
        {
            name: 'process.list',
            description: 'List running processes with name, PID, parent PID, working set size, and CPU time.',
            parameters: { type: 'object', properties: {}, required: [] }
        },
        {
            name: 'process.start',
            description: 'Launch an executable in the background. Returns the PID immediately without waiting for it to finish.',
            parameters: {
                type: 'object',
                properties: {
                    executable: { type: 'string', description: 'Full path or name of the executable to launch' },
                    arguments: { type: 'array', description: 'Command-line arguments', items: { type: 'string' } },
                    workingDirectory: { type: 'string', description: 'Working directory for the process' },
                    environment: { type: 'object', description: 'Additional environment variables (merged with current env)' }
                },
                required: ['executable']
            }
        },
        {
            name: 'process.kill',
            description: 'Terminate a process by PID. Use force=true for immediate termination (taskkill /F).',
            parameters: {
                type: 'object',
                properties: {
                    pid: { type: 'number', description: 'Process ID to terminate' },
                    force: { type: 'boolean', description: 'Force-kill without giving the process a chance to clean up. Default: false' }
                },
                required: ['pid']
            }
        },
        {
            name: 'process.wait',
            description: 'Wait for a process to exit. Returns its exit code. Useful after process.start.',
            parameters: {
                type: 'object',
                properties: {
                    pid: { type: 'number', description: 'Process ID to wait for' },
                    timeoutMs: { type: 'number', description: 'Maximum time to wait in milliseconds. Default: 30000' }
                },
                required: ['pid']
            }
        },
        {
            name: 'process.run',
            description: 'Start a process AND wait for it to finish. Captures and returns stdout and stderr. Use this for short-lived commands.',
            parameters: {
                type: 'object',
                properties: {
                    executable: { type: 'string', description: 'Full path or name of the executable' },
                    arguments: { type: 'array', description: 'Command-line arguments', items: { type: 'string' } },
                    workingDirectory: { type: 'string', description: 'Working directory' },
                    timeoutMs: { type: 'number', description: 'Timeout in milliseconds. Default: 30000' }
                },
                required: ['executable']
            }
        }
    ],
    async execute(toolName, args) {
        log.debug({ toolName, args }, 'Executing');
        switch (toolName) {
            case 'process.list': return handleProcessList(args);
            case 'process.start': return handleProcessStart(args);
            case 'process.kill': return handleProcessKill(args);
            case 'process.wait': return handleProcessWait(args);
            case 'process.run': return handleProcessRun(args);
            default:
                throw new errors_1.ExecutionError('process_manager', `Unknown tool: ${toolName}`);
        }
    }
};
registry_1.registry.register(processManager);
exports.default = processManager;
//# sourceMappingURL=process_manager.js.map