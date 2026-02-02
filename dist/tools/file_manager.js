"use strict";
/**
 * tools/file_manager.ts
 *
 * Full filesystem control. Uses Node's fs module directly for most operations
 * (fast, no subprocess overhead). Falls back to shell commands only when
 * shell expansion or OS-level behaviour is needed (e.g. opening with default app).
 *
 * Path sandboxing is enforced: if the session config specifies allowed prefixes,
 * any path outside them is rejected before any I/O happens.
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
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const child_process_1 = require("child_process");
const registry_1 = require("../core/registry");
const errors_1 = require("../core/errors");
const logger_1 = require("../core/logger");
const log = (0, logger_1.scopedLogger)('tools/file_manager');
// ---------------------------------------------------------------------------
// Input validation helpers
// ---------------------------------------------------------------------------
function validateStringArg(value, argName) {
    if (typeof value !== 'string' || value.trim() === '') {
        throw new errors_1.ExecutionError('file_manager', `Invalid ${argName}: must be a non-empty string`, { [argName]: value });
    }
    return value;
}
function validateBooleanArg(value, argName, defaultValue) {
    if (value === undefined || value === null)
        return defaultValue;
    if (typeof value !== 'boolean') {
        throw new errors_1.ExecutionError('file_manager', `Invalid ${argName}: must be a boolean`, { [argName]: value });
    }
    return value;
}
function validateEncodingArg(value) {
    const encoding = value ?? 'utf-8';
    if (!['utf-8', 'base64', 'ascii', 'binary'].includes(encoding)) {
        throw new errors_1.ExecutionError('file_manager', `Invalid encoding: must be one of utf-8, base64, ascii, binary`, { encoding });
    }
    return encoding;
}
// ---------------------------------------------------------------------------
// Sandbox enforcement
// ---------------------------------------------------------------------------
// These can be overridden via environment variable at startup.
// Set FILE_MANAGER_SANDBOX to a semicolon-separated list of allowed path prefixes.
// If empty/unset, no sandboxing is enforced (full filesystem access).
function getAllowedPrefixes() {
    const env = process.env.FILE_MANAGER_SANDBOX;
    if (!env)
        return [];
    return env.split(';').map(p => path.resolve(p.trim())).filter(Boolean);
}
function assertSandbox(targetPath) {
    const allowed = getAllowedPrefixes();
    if (allowed.length === 0)
        return; // no sandbox configured
    const resolved = path.resolve(targetPath);
    const inSandbox = allowed.some(prefix => resolved.startsWith(prefix));
    if (!inSandbox) {
        throw new errors_1.SandboxViolationError(resolved, allowed);
    }
}
// ---------------------------------------------------------------------------
// Shared error mapper
// ---------------------------------------------------------------------------
function mapFsError(e, targetPath) {
    switch (e.code) {
        case 'ENOENT': throw new errors_1.PathNotFoundError(targetPath);
        case 'EACCES': throw new errors_1.AccessDeniedError(targetPath);
        default: throw new errors_1.ExecutionError('file_manager', e.message, { path: targetPath, code: e.code });
    }
}
// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------
async function handleFileRead(args) {
    const filePath = validateStringArg(args.path, 'path');
    assertSandbox(filePath);
    try {
        const encoding = validateEncodingArg(args.encoding);
        if (encoding === 'base64') {
            const buffer = await fs.promises.readFile(filePath);
            return { success: true, data: { content: buffer.toString('base64'), encoding: 'base64' }, durationMs: 0 };
        }
        const content = await fs.promises.readFile(filePath, 'utf-8');
        return { success: true, data: { content, encoding: 'utf-8' }, durationMs: 0 };
    }
    catch (e) {
        return mapFsError(e, filePath);
    }
}
async function handleFileWrite(args) {
    const filePath = validateStringArg(args.path, 'path');
    const content = validateStringArg(args.content, 'content');
    const encoding = validateEncodingArg(args.encoding);
    assertSandbox(filePath);
    try {
        // Ensure parent directory exists
        const dir = path.dirname(filePath);
        await fs.promises.mkdir(dir, { recursive: true });
        if (encoding === 'base64') {
            await fs.promises.writeFile(filePath, Buffer.from(content, 'base64'));
        }
        else {
            await fs.promises.writeFile(filePath, content, 'utf-8');
        }
        const stats = await fs.promises.stat(filePath);
        return { success: true, data: { written: filePath, bytes: stats.size }, durationMs: 0 };
    }
    catch (e) {
        return mapFsError(e, filePath);
    }
}
async function handleFileCopy(args) {
    const src = validateStringArg(args.source, 'source');
    const dest = validateStringArg(args.destination, 'destination');
    const recursive = validateBooleanArg(args.recursive, 'recursive', false);
    assertSandbox(src);
    assertSandbox(dest);
    try {
        await fs.promises.cp(src, dest, { recursive, force: true });
        return { success: true, data: { copied: { from: src, to: dest } }, durationMs: 0 };
    }
    catch (e) {
        return mapFsError(e, src);
    }
}
async function handleFileMove(args) {
    const src = validateStringArg(args.source, 'source');
    const dest = validateStringArg(args.destination, 'destination');
    assertSandbox(src);
    assertSandbox(dest);
    try {
        // Ensure destination parent exists
        const dir = path.dirname(dest);
        await fs.promises.mkdir(dir, { recursive: true });
        await fs.promises.rename(src, dest);
        return { success: true, data: { moved: { from: src, to: dest } }, durationMs: 0 };
    }
    catch (e) {
        return mapFsError(e, src);
    }
}
async function handleFileDelete(args) {
    const targetPath = validateStringArg(args.path, 'path');
    const recursive = validateBooleanArg(args.recursive, 'recursive', false);
    assertSandbox(targetPath);
    try {
        await fs.promises.rm(targetPath, { recursive, force: false });
        return { success: true, data: { deleted: targetPath }, durationMs: 0 };
    }
    catch (e) {
        return mapFsError(e, targetPath);
    }
}
async function handleFileList(args) {
    const dirPath = validateStringArg(args.path, 'path');
    const pattern = args.pattern; // simple glob like "*.txt"
    assertSandbox(dirPath);
    try {
        let entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
        // Simple glob filter: only supports * wildcard at the start or end
        if (pattern) {
            const re = new RegExp('^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$', 'i');
            entries = entries.filter(e => re.test(e.name));
        }
        const items = entries.map(e => ({
            name: e.name,
            type: e.isDirectory() ? 'directory' : 'file',
            fullPath: path.join(dirPath, e.name)
        }));
        return { success: true, data: { items, count: items.length }, durationMs: 0 };
    }
    catch (e) {
        return mapFsError(e, dirPath);
    }
}
async function handleFileSearch(args) {
    const dirPath = validateStringArg(args.directory, 'directory');
    const query = validateStringArg(args.query, 'query');
    const useRegex = validateBooleanArg(args.useRegex, 'useRegex', false);
    const maxResults = typeof args.maxResults === 'number' ? args.maxResults : 50;
    assertSandbox(dirPath);
    const results = [];
    let pattern;
    try {
        pattern = useRegex ? new RegExp(query) : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    }
    catch {
        throw new errors_1.ExecutionError('file_manager', `Invalid regex: ${query}`);
    }
    async function searchDir(dir) {
        if (results.length >= maxResults)
            return;
        let entries;
        try {
            entries = await fs.promises.readdir(dir, { withFileTypes: true });
        }
        catch {
            return; // permission denied on this sub-dir — skip silently
        }
        for (const entry of entries) {
            if (results.length >= maxResults)
                return;
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                await searchDir(full);
            }
            else if (entry.isFile()) {
                try {
                    const content = await fs.promises.readFile(full, 'utf-8');
                    const lines = content.split('\n');
                    for (let i = 0; i < lines.length; i++) {
                        if (pattern.test(lines[i])) {
                            results.push({ file: full, line: i + 1, match: lines[i].trim() });
                            if (results.length >= maxResults)
                                return;
                        }
                    }
                }
                catch {
                    // Binary or unreadable — skip
                }
            }
        }
    }
    await searchDir(dirPath);
    return { success: true, data: { results, total: results.length }, durationMs: 0 };
}
async function handleFileOpen(args) {
    const filePath = validateStringArg(args.path, 'path');
    assertSandbox(filePath);
    try {
        // Check if file exists using async
        await fs.promises.access(filePath);
    }
    catch {
        throw new errors_1.PathNotFoundError(filePath);
    }
    try {
        // `start` is the Windows shell command to open a file with its default app
        (0, child_process_1.execSync)(`start "" "${filePath}"`, { shell: 'powershell', stdio: 'pipe' });
        return { success: true, data: { opened: filePath }, durationMs: 0 };
    }
    catch (e) {
        throw new errors_1.ExecutionError('file_manager', e.message, { path: filePath });
    }
}
async function handleFileProperties(args) {
    const filePath = validateStringArg(args.path, 'path');
    assertSandbox(filePath);
    try {
        const stats = await fs.promises.stat(filePath);
        return {
            success: true,
            data: {
                path: filePath,
                isFile: stats.isFile(),
                isDirectory: stats.isDirectory(),
                size: stats.size,
                createdAt: stats.birthtime.toISOString(),
                modifiedAt: stats.mtime.toISOString(),
                accessedAt: stats.atime.toISOString(),
                mode: stats.mode.toString(8) // octal permissions
            },
            durationMs: 0
        };
    }
    catch (e) {
        return mapFsError(e, filePath);
    }
}
// ---------------------------------------------------------------------------
// Module definition + registration
// ---------------------------------------------------------------------------
const fileManager = {
    name: 'file_manager',
    tools: [
        {
            name: 'file.read',
            description: 'Read the contents of a file. Returns text by default or base64-encoded binary if encoding is set to "base64".',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'Absolute path to the file' },
                    encoding: { type: 'string', description: 'Output encoding: "utf-8" (default) or "base64"', enum: ['utf-8', 'base64'] }
                },
                required: ['path']
            }
        },
        {
            name: 'file.write',
            description: 'Create or overwrite a file with the given content. Parent directories are created automatically.',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'Absolute path to the target file' },
                    content: { type: 'string', description: 'The content to write' },
                    encoding: { type: 'string', description: 'Input encoding: "utf-8" (default) or "base64"', enum: ['utf-8', 'base64'] }
                },
                required: ['path', 'content']
            }
        },
        {
            name: 'file.copy',
            description: 'Copy a file or directory to a new location.',
            parameters: {
                type: 'object',
                properties: {
                    source: { type: 'string', description: 'Source path' },
                    destination: { type: 'string', description: 'Destination path' },
                    recursive: { type: 'boolean', description: 'If true, copy directories recursively. Default: false' }
                },
                required: ['source', 'destination']
            }
        },
        {
            name: 'file.move',
            description: 'Move (rename) a file or directory.',
            parameters: {
                type: 'object',
                properties: {
                    source: { type: 'string', description: 'Current path' },
                    destination: { type: 'string', description: 'New path' }
                },
                required: ['source', 'destination']
            }
        },
        {
            name: 'file.delete',
            description: 'Delete a file or directory. For directories, set recursive to true.',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'Path to delete' },
                    recursive: { type: 'boolean', description: 'Delete directories recursively. Default: false' }
                },
                required: ['path']
            }
        },
        {
            name: 'file.list',
            description: 'List the contents of a directory. Optionally filter by a glob-style pattern (e.g. "*.txt").',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'Directory path to list' },
                    pattern: { type: 'string', description: 'Optional glob filter (e.g. "*.log")' }
                },
                required: ['path']
            }
        },
        {
            name: 'file.search',
            description: 'Search file contents recursively within a directory for lines matching a query string or regex.',
            parameters: {
                type: 'object',
                properties: {
                    directory: { type: 'string', description: 'Root directory to search' },
                    query: { type: 'string', description: 'Search string or regex pattern' },
                    useRegex: { type: 'boolean', description: 'Treat query as a regular expression. Default: false' },
                    maxResults: { type: 'number', description: 'Maximum number of matches to return. Default: 50' }
                },
                required: ['directory', 'query']
            }
        },
        {
            name: 'file.open',
            description: 'Open a file with its default associated application (e.g. .docx opens in Word).',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'Absolute path to the file to open' }
                },
                required: ['path']
            }
        },
        {
            name: 'file.properties',
            description: 'Return metadata about a file or directory: size, timestamps, permissions.',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'Path to inspect' }
                },
                required: ['path']
            }
        }
    ],
    async execute(toolName, args) {
        log.debug({ toolName, args }, 'Executing');
        switch (toolName) {
            case 'file.read': return handleFileRead(args);
            case 'file.write': return handleFileWrite(args);
            case 'file.copy': return handleFileCopy(args);
            case 'file.move': return handleFileMove(args);
            case 'file.delete': return handleFileDelete(args);
            case 'file.list': return handleFileList(args);
            case 'file.search': return handleFileSearch(args);
            case 'file.open': return handleFileOpen(args);
            case 'file.properties': return handleFileProperties(args);
            default:
                throw new errors_1.ExecutionError('file_manager', `Unknown tool: ${toolName}`);
        }
    }
};
registry_1.registry.register(fileManager);
exports.default = fileManager;
//# sourceMappingURL=file_manager.js.map