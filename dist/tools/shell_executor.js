"use strict";
/**
 * tools/shell_executor.ts
 *
 * Executes arbitrary shell commands (PowerShell) with safety checks.
 * Useful for custom operations not covered by other tools.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const child_process_1 = require("child_process");
const registry_1 = require("../core/registry");
const errors_1 = require("../core/errors");
const logger_1 = require("../core/logger");
const log = (0, logger_1.scopedLogger)('tools/shell_executor');
// ---------------------------------------------------------------------------
// Blacklist dangerous commands
// ---------------------------------------------------------------------------
const DANGEROUS_COMMANDS = [
    'rmdir', 'del', 'erase', 'format', 'fdisk', 'shutdown', 'restart',
    'net stop', 'sc stop', 'taskkill /f', 'powershell -c',
    'cmd /c', 'wmic', 'reg delete', 'schtasks /delete'
];
function isSafeCommand(command) {
    const lower = command.toLowerCase();
    return !DANGEROUS_COMMANDS.some(danger => lower.includes(danger));
}
// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------
async function handleShellExecute(args) {
    const command = args.command;
    const timeoutMs = args.timeoutMs || 30000;
    if (!command) {
        throw new errors_1.ExecutionError('shell_executor', 'Command is required');
    }
    if (!isSafeCommand(command)) {
        throw new errors_1.ExecutionError('shell_executor', 'Command contains potentially dangerous operations');
    }
    try {
        const result = (0, child_process_1.execSync)(command, {
            encoding: 'utf-8',
            timeout: timeoutMs,
            stdio: ['pipe', 'pipe', 'pipe']
        }).trim();
        return { success: true, data: { output: result }, durationMs: 0 };
    }
    catch (e) {
        throw new errors_1.ExecutionError('shell_executor', `Command failed: ${e.message}`);
    }
}
// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------
const shellExecutor = {
    name: 'shell_executor',
    tools: [
        {
            name: 'shell.execute',
            description: 'Execute a safe PowerShell command. Dangerous commands are blocked.',
            parameters: {
                type: 'object',
                properties: {
                    command: { type: 'string', description: 'PowerShell command to execute' },
                    timeoutMs: { type: 'number', description: 'Timeout in milliseconds (default: 30000)', default: 30000 }
                },
                required: ['command']
            }
        }
    ],
    async execute(toolName, args) {
        log.debug({ toolName, args }, 'Executing');
        switch (toolName) {
            case 'shell.execute': return handleShellExecute(args);
            default:
                throw new errors_1.ExecutionError('shell_executor', `Unknown tool: ${toolName}`);
        }
    }
};
// Self-register
registry_1.registry.register(shellExecutor);
exports.default = shellExecutor;
//# sourceMappingURL=shell_executor.js.map