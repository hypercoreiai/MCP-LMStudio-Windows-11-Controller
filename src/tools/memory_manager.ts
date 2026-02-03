/**
 * tools/memory_manager.ts
 *
 * Provides file-based memory/persistence for storing and retrieving
 * key-value data across tool calls. Useful for multi-step tasks
 * and maintaining context, similar to Python's memory tools.
 *
 * Stores data as JSON files in a dedicated directory.
 */

import { promises as fs } from 'fs';
import { join } from 'path';
import { ToolModule, ToolResult } from '../core/types';
import { registry } from '../core/registry';
import { ExecutionError } from '../core/errors';
import { scopedLogger } from '../core/logger';

const log = scopedLogger('tools/memory_manager');

// ---------------------------------------------------------------------------
// Memory storage path
// ---------------------------------------------------------------------------

const MEMORY_DIR = join(process.cwd(), 'memories');

// Ensure memory directory exists
async function ensureMemoryDir(): Promise<void> {
  try {
    await fs.mkdir(MEMORY_DIR, { recursive: true });
  } catch (e) {
    log.warn({ error: e }, 'Failed to create memories directory');
  }
}

// ---------------------------------------------------------------------------
// Internal handlers
// ---------------------------------------------------------------------------

async function handleMemorySave(args: Record<string, unknown>): Promise<ToolResult> {
  const key = args.key as string;
  const value = args.value;
  const overwrite = (args.overwrite as boolean) ?? true;

  if (!key) {
    throw new ExecutionError('memory_manager', 'Key is required');
  }

  await ensureMemoryDir();

  const filePath = join(MEMORY_DIR, `${key}.json`);

  try {
    // Check if exists and overwrite is false
    if (!overwrite) {
      await fs.access(filePath);
      throw new ExecutionError('memory_manager', `Memory '${key}' already exists. Set overwrite=true to update.`);
    }

    await fs.writeFile(filePath, JSON.stringify(value, null, 2), 'utf-8');
    return { success: true, data: { saved: key }, durationMs: 0 };
  } catch (e: any) {
    if (e.code === 'ENOENT' && !overwrite) {
      // File doesn't exist, save it
      await fs.writeFile(filePath, JSON.stringify(value, null, 2), 'utf-8');
      return { success: true, data: { saved: key }, durationMs: 0 };
    }
    throw new ExecutionError('memory_manager', e.message);
  }
}

async function handleMemoryLoad(args: Record<string, unknown>): Promise<ToolResult> {
  const key = args.key as string;

  if (!key) {
    throw new ExecutionError('memory_manager', 'Key is required');
  }

  const filePath = join(MEMORY_DIR, `${key}.json`);

  try {
    const data = await fs.readFile(filePath, 'utf-8');
    const value = JSON.parse(data);
    return { success: true, data: { key, value }, durationMs: 0 };
  } catch (e: any) {
    if (e.code === 'ENOENT') {
      throw new ExecutionError('memory_manager', `Memory '${key}' not found`);
    }
    throw new ExecutionError('memory_manager', `Failed to load memory: ${e.message}`);
  }
}

async function handleMemoryList(_args: Record<string, unknown>): Promise<ToolResult> {
  await ensureMemoryDir();

  try {
    const files = await fs.readdir(MEMORY_DIR);
    const keys = files.filter(f => f.endsWith('.json')).map(f => f.slice(0, -5)); // Remove .json
    return { success: true, data: { keys }, durationMs: 0 };
  } catch (e: any) {
    throw new ExecutionError('memory_manager', `Failed to list memories: ${e.message}`);
  }
}

async function handleMemoryDelete(args: Record<string, unknown>): Promise<ToolResult> {
  const key = args.key as string;

  if (!key) {
    throw new ExecutionError('memory_manager', 'Key is required');
  }

  const filePath = join(MEMORY_DIR, `${key}.json`);

  try {
    await fs.unlink(filePath);
    return { success: true, data: { deleted: key }, durationMs: 0 };
  } catch (e: any) {
    if (e.code === 'ENOENT') {
      throw new ExecutionError('memory_manager', `Memory '${key}' not found`);
    }
    throw new ExecutionError('memory_manager', `Failed to delete memory: ${e.message}`);
  }
}

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

const memoryManager: ToolModule = {
  name: 'memory_manager',

  tools: [
    {
      name: 'memory.save',
      description: 'Save a key-value pair to persistent memory. Overwrites by default.',
      parameters: {
        type: 'object',
        properties: {
          key:       { type: 'string', description: 'Unique key for the memory item' },
          value:     { type: 'object', description: 'Value to store (any JSON-serializable data)' },
          overwrite: { type: 'boolean', description: 'Whether to overwrite if key exists (default: true)', default: true }
        },
        required: ['key', 'value']
      }
    },
    {
      name: 'memory.load',
      description: 'Load a value from memory by key.',
      parameters: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'Key of the memory item to load' }
        },
        required: ['key']
      }
    },
    {
      name: 'memory.list',
      description: 'List all memory keys.',
      parameters: {
        type: 'object',
        properties: {}
      }
    },
    {
      name: 'memory.delete',
      description: 'Delete a memory item by key.',
      parameters: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'Key of the memory item to delete' }
        },
        required: ['key']
      }
    }
  ],

  async execute(toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
    log.debug({ toolName, args }, 'Executing');

    switch (toolName) {
      case 'memory.save':   return handleMemorySave(args);
      case 'memory.load':   return handleMemoryLoad(args);
      case 'memory.list':   return handleMemoryList(args);
      case 'memory.delete': return handleMemoryDelete(args);
      default:
        throw new ExecutionError('memory_manager', `Unknown tool: ${toolName}`);
    }
  }
};

// Self-register
registry.register(memoryManager);

export default memoryManager;