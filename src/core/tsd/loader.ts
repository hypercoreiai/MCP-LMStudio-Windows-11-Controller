/**
 * core/tsd/loader.ts
 * 
 * Reads every .json file from the config/tsds/ directory at startup
 * and builds a lookup map: toolName → TaskSpecificDefinition.
 * 
 * Files are expected to match the TaskSpecificDefinition shape defined
 * in core/types.ts. Invalid files are logged and skipped.
 */

import * as fs from 'fs';
import * as path from 'path';
import { TaskSpecificDefinition } from '../types';
import { scopedLogger } from '../logger';

const log = scopedLogger('core/tsd/loader');

export class TsdLoader {
  private readonly tsds = new Map<string, TaskSpecificDefinition>();
  private readonly tsdDir: string;

  constructor(tsdDir?: string) {
    // Default to config/tsds/ relative to the project root (where package.json lives)
    this.tsdDir = tsdDir ?? path.resolve(process.cwd(), 'config', 'tsds');
  }

  /**
   * Scan the TSD directory and load all .json files.
   * Call once at server startup.
   */
  load(): void {
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
        const tsd: TaskSpecificDefinition = JSON.parse(raw);

        if (!tsd.toolName || typeof tsd.toolName !== 'string') {
          log.warn({ file }, 'TSD file missing toolName — skipped');
          continue;
        }

        this.tsds.set(tsd.toolName, tsd);
        log.debug({ file, toolName: tsd.toolName }, 'TSD loaded');
      } catch (e) {
        log.error({ file, error: (e as Error).message }, 'Failed to parse TSD file — skipped');
      }
    }

    log.info({ total: this.tsds.size }, 'TSDs loaded');
  }

  /** Get the TSD for a specific tool. Returns undefined if none configured. */
  get(toolName: string): TaskSpecificDefinition | undefined {
    return this.tsds.get(toolName);
  }

  /** Returns all loaded TSDs (useful for introspection). */
  getAll(): Map<string, TaskSpecificDefinition> {
    return new Map(this.tsds);
  }

  /** Returns the list of tool names that have TSDs configured. */
  listToolNames(): string[] {
    return Array.from(this.tsds.keys());
  }
}
