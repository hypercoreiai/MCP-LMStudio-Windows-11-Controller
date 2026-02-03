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

let instance: pino.Logger | null = null;

export function initLogger(config: SessionConfig): pino.Logger {
  instance = pino({
    level: config.logLevel ?? 'info'
  });
  return instance;
}

export function getLogger(): pino.Logger {
  if (!instance) {
    // Fallback for early imports before initLogger is called
    instance = pino({ level: 'info' });
  }
  return instance;
}

/**
 * Returns a child logger scoped to a specific module.
 * Usage:  const log = scopedLogger('tools/file_manager');
 */
export function scopedLogger(moduleName: string): pino.Logger {
  return getLogger().child({ module: moduleName });
}

// Convenience default export for quick imports
export const logger = new Proxy({} as pino.Logger, {
  get(_target, prop) {
    return (getLogger() as any)[prop];
  }
});
