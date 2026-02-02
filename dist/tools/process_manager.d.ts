/**
 * tools/process_manager.ts
 *
 * Spawn, query, and terminate Windows processes.
 * Uses a combination of Node child_process for spawning and
 * PowerShell/WMI for querying the process table (richer metadata
 * than what Node exposes: parent PID, memory, CPU%).
 */
import { ToolModule } from '../core/types';
declare const processManager: ToolModule;
export default processManager;
//# sourceMappingURL=process_manager.d.ts.map