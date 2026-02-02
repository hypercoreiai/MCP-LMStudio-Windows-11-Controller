"use strict";
/**
 * core/logger.ts
 *
 * Singleton pino logger. Every module does:
 *     import { logger } from '@core/logger';
 *
 * Child loggers are scoped with a `module` field so audit logs
 * can be filtered per-module.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
exports.initLogger = initLogger;
exports.getLogger = getLogger;
exports.scopedLogger = scopedLogger;
const pino_1 = __importDefault(require("pino"));
let instance = null;
function initLogger(config) {
    instance = (0, pino_1.default)({
        level: config.logLevel ?? 'info'
    });
    return instance;
}
function getLogger() {
    if (!instance) {
        // Fallback for early imports before initLogger is called
        instance = (0, pino_1.default)({ level: 'info' });
    }
    return instance;
}
/**
 * Returns a child logger scoped to a specific module.
 * Usage:  const log = scopedLogger('tools/file_manager');
 */
function scopedLogger(moduleName) {
    return getLogger().child({ module: moduleName });
}
// Convenience default export for quick imports
exports.logger = new Proxy({}, {
    get(_target, prop) {
        return getLogger()[prop];
    }
});
//# sourceMappingURL=logger.js.map