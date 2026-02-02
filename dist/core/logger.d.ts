/**
 * core/logger.ts
 *
 * Singleton pino logger. Every module does:
 *     import { logger } from '@core/logger';
 *
 * Child loggers are scoped with a `module` field so audit logs
 * can be filtered per-module.
 */
import pino from 'pino';
import { SessionConfig } from './types';
export declare function initLogger(config: SessionConfig): pino.Logger;
export declare function getLogger(): pino.Logger;
/**
 * Returns a child logger scoped to a specific module.
 * Usage:  const log = scopedLogger('tools/file_manager');
 */
export declare function scopedLogger(moduleName: string): pino.Logger;
export declare const logger: pino.Logger<never, boolean>;
//# sourceMappingURL=logger.d.ts.map