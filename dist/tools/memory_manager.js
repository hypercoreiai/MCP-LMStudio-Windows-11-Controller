"use strict";
/**
 * tools/memory_manager.ts
 *
 * Provides file-based memory/persistence for storing and retrieving
 * key-value data across tool calls. Useful for multi-step tasks
 * and maintaining context, similar to Python's memory tools.
 *
 * Stores data as JSON files in a dedicated directory.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = require("fs");
const path_1 = require("path");
const registry_1 = require("../core/registry");
const errors_1 = require("../core/errors");
const logger_1 = require("../core/logger");
const log = (0, logger_1.scopedLogger)('tools/memory_manager');
// ---------------------------------------------------------------------------
// Memory storage path
// ---------------------------------------------------------------------------
const MEMORY_DIR = (0, path_1.join)(process.cwd(), 'memories');
// Ensure memory directory exists
async function ensureMemoryDir() {
    try {
        await fs_1.promises.mkdir(MEMORY_DIR, { recursive: true });
    }
    catch (e) {
        log.warn({ error: e }, 'Failed to create memories directory');
    }
}
// ---------------------------------------------------------------------------
// Internal handlers
// ---------------------------------------------------------------------------
async function handleMemorySave(args) {
    const key = args.key;
    const value = args.value;
    const overwrite = args.overwrite ?? true;
    if (!key) {
        throw new errors_1.ExecutionError('memory_manager', 'Key is required');
    }
    await ensureMemoryDir();
    const filePath = (0, path_1.join)(MEMORY_DIR, `${key}.json`);
    try {
        // Check if exists and overwrite is false
        if (!overwrite) {
            await fs_1.promises.access(filePath);
            throw new errors_1.ExecutionError('memory_manager', `Memory '${key}' already exists. Set overwrite=true to update.`);
        }
        await fs_1.promises.writeFile(filePath, JSON.stringify(value, null, 2), 'utf-8');
        return { success: true, data: { saved: key }, durationMs: 0 };
    }
    catch (e) {
        if (e.code === 'ENOENT' && !overwrite) {
            // File doesn't exist, save it
            await fs_1.promises.writeFile(filePath, JSON.stringify(value, null, 2), 'utf-8');
            return { success: true, data: { saved: key }, durationMs: 0 };
        }
        throw new errors_1.ExecutionError('memory_manager', e.message);
    }
}
async function handleMemoryLoad(args) {
    const key = args.key;
    if (!key) {
        throw new errors_1.ExecutionError('memory_manager', 'Key is required');
    }
    const filePath = (0, path_1.join)(MEMORY_DIR, `${key}.json`);
    try {
        const data = await fs_1.promises.readFile(filePath, 'utf-8');
        const value = JSON.parse(data);
        return { success: true, data: { key, value }, durationMs: 0 };
    }
    catch (e) {
        if (e.code === 'ENOENT') {
            throw new errors_1.ExecutionError('memory_manager', `Memory '${key}' not found`);
        }
        throw new errors_1.ExecutionError('memory_manager', `Failed to load memory: ${e.message}`);
    }
}
async function handleMemoryList(_args) {
    await ensureMemoryDir();
    try {
        const files = await fs_1.promises.readdir(MEMORY_DIR);
        const keys = files.filter(f => f.endsWith('.json')).map(f => f.slice(0, -5)); // Remove .json
        return { success: true, data: { keys }, durationMs: 0 };
    }
    catch (e) {
        throw new errors_1.ExecutionError('memory_manager', `Failed to list memories: ${e.message}`);
    }
}
async function handleMemoryDelete(args) {
    const key = args.key;
    if (!key) {
        throw new errors_1.ExecutionError('memory_manager', 'Key is required');
    }
    const filePath = (0, path_1.join)(MEMORY_DIR, `${key}.json`);
    try {
        await fs_1.promises.unlink(filePath);
        return { success: true, data: { deleted: key }, durationMs: 0 };
    }
    catch (e) {
        if (e.code === 'ENOENT') {
            throw new errors_1.ExecutionError('memory_manager', `Memory '${key}' not found`);
        }
        throw new errors_1.ExecutionError('memory_manager', `Failed to delete memory: ${e.message}`);
    }
}
// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------
const memoryManager = {
    name: 'memory_manager',
    tools: [
        {
            name: 'memory.save',
            description: 'Save a key-value pair to persistent memory. Overwrites by default.',
            parameters: {
                type: 'object',
                properties: {
                    key: { type: 'string', description: 'Unique key for the memory item' },
                    value: { type: 'object', description: 'Value to store (any JSON-serializable data)' },
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
    async execute(toolName, args) {
        log.debug({ toolName, args }, 'Executing');
        switch (toolName) {
            case 'memory.save': return handleMemorySave(args);
            case 'memory.load': return handleMemoryLoad(args);
            case 'memory.list': return handleMemoryList(args);
            case 'memory.delete': return handleMemoryDelete(args);
            default:
                throw new errors_1.ExecutionError('memory_manager', `Unknown tool: ${toolName}`);
        }
    }
};
// Self-register
registry_1.registry.register(memoryManager);
exports.default = memoryManager;
//# sourceMappingURL=memory_manager.js.map