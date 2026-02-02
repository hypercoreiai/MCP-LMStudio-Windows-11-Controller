/**
 * core/tsd/loader.ts
 *
 * Reads every .json file from the config/tsds/ directory at startup
 * and builds a lookup map: toolName → TaskSpecificDefinition.
 *
 * Files are expected to match the TaskSpecificDefinition shape defined
 * in core/types.ts. Invalid files are logged and skipped.
 */
import { TaskSpecificDefinition } from '../types';
export declare class TsdLoader {
    private readonly tsds;
    private readonly tsdDir;
    constructor(tsdDir?: string);
    /**
     * Scan the TSD directory and load all .json files.
     * Call once at server startup.
     */
    load(): void;
    /** Get the TSD for a specific tool. Returns undefined if none configured. */
    get(toolName: string): TaskSpecificDefinition | undefined;
    /** Returns all loaded TSDs (useful for introspection). */
    getAll(): Map<string, TaskSpecificDefinition>;
    /** Returns the list of tool names that have TSDs configured. */
    listToolNames(): string[];
}
//# sourceMappingURL=loader.d.ts.map