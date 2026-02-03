/**
 * tools/shell_executor.ts
 *
 * Executes arbitrary shell commands (PowerShell) with safety checks.
 * Useful for custom operations not covered by other tools.
 */

import { execSync } from 'child_process';
import { ToolModule, ToolResult } from '../core/types';
import { registry } from '../core/registry';
import { ExecutionError } from '../core/errors';
import { scopedLogger } from '../core/logger';

const log = scopedLogger('tools/shell_executor');

// ---------------------------------------------------------------------------
// Blacklist dangerous commands
// ---------------------------------------------------------------------------

const DANGEROUS_COMMANDS = [
  'rmdir', 'del', 'erase', 'format', 'fdisk', 'shutdown', 'restart',
  'net stop', 'sc stop', 'taskkill /f', 'powershell -c',
  'cmd /c', 'wmic', 'reg delete', 'schtasks /delete'
];

function isSafeCommand(command: string): boolean {
  const lower = command.toLowerCase();
  return !DANGEROUS_COMMANDS.some(danger => lower.includes(danger));
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

async function handleShellExecute(args: Record<string, unknown>): Promise<ToolResult> {
  const command = args.command as string;
  const timeoutMs = (args.timeoutMs as number) || 30000;

  if (!command) {
    throw new ExecutionError('shell_executor', 'Command is required');
  }

  if (!isSafeCommand(command)) {
    throw new ExecutionError('shell_executor', 'Command contains potentially dangerous operations');
  }

  try {
    const result = execSync(command, {
      encoding: 'utf-8',
      timeout: timeoutMs,
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim();

    return { success: true, data: { output: result }, durationMs: 0 };
  } catch (e: any) {
    throw new ExecutionError('shell_executor', `Command failed: ${e.message}`);
  }
}

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

const shellExecutor: ToolModule = {
  name: 'shell_executor',

  tools: [
    {
      name: 'shell.execute',
      description: 'Execute a safe PowerShell command. Dangerous commands are blocked.',
      parameters: {
        type: 'object',
        properties: {
          command:   { type: 'string', description: 'PowerShell command to execute' },
          timeoutMs: { type: 'number', description: 'Timeout in milliseconds (default: 30000)', default: 30000 }
        },
        required: ['command']
      }
    }
  ],

  async execute(toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
    log.debug({ toolName, args }, 'Executing');

    switch (toolName) {
      case 'shell.execute': return handleShellExecute(args);
      default:
        throw new ExecutionError('shell_executor', `Unknown tool: ${toolName}`);
    }
  }
};

// Self-register
registry.register(shellExecutor);

export default shellExecutor;