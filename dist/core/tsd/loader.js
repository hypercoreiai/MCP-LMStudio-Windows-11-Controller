"use strict";
/**
 * core/tsd/loader.ts
 *
 * Reads every .json file from the config/tsds/ directory at startup
 * and builds a lookup map: toolName → TaskSpecificDefinition.
 *
 * Files are expected to match the TaskSpecificDefinition shape defined
 * in core/types.ts. Invalid files are logged and skipped.
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
exports.TsdLoader = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const logger_1 = require("../logger");
const log = (0, logger_1.scopedLogger)('core/tsd/loader');
class TsdLoader {
    tsds = new Map();
    tsdDir;
    constructor(tsdDir) {
        // Default to config/tsds/ relative to the project root (where package.json lives)
        this.tsdDir = tsdDir ?? path.resolve(process.cwd(), 'config', 'tsds');
    }
    /**
     * Scan the TSD directory and load all .json files.
     * Call once at server startup.
     */
    load() {
        if (!fs.existsSync(this.tsdDir)) {
            log.warn({ dir: this.tsdDir }, 'TSD directory does not exist — no TSDs loaded');
            return;
        }
        const files = fs.readdirSync(this.tsdDir).filter(f => f.endsWith('.json'));
        log.info({ dir: this.tsdDir, count: files.length }, 'Loading TSDs');
        for (const file of files) {
            const filePath = path.join(this.tsdDir, file);
            try {
                const raw = fs.readFileSync(filePath, 'utf-8');
                const tsd = JSON.parse(raw);
                if (!tsd.toolName || typeof tsd.toolName !== 'string') {
                    log.warn({ file }, 'TSD file missing toolName — skipped');
                    continue;
                }
                this.tsds.set(tsd.toolName, tsd);
                log.debug({ file, toolName: tsd.toolName }, 'TSD loaded');
            }
            catch (e) {
                log.error({ file, error: e.message }, 'Failed to parse TSD file — skipped');
            }
        }
        log.info({ total: this.tsds.size }, 'TSDs loaded');
    }
    /** Get the TSD for a specific tool. Returns undefined if none configured. */
    get(toolName) {
        return this.tsds.get(toolName);
    }
    /** Returns all loaded TSDs (useful for introspection). */
    getAll() {
        return new Map(this.tsds);
    }
    /** Returns the list of tool names that have TSDs configured. */
    listToolNames() {
        return Array.from(this.tsds.keys());
    }
}
exports.TsdLoader = TsdLoader;
//# sourceMappingURL=loader.js.map