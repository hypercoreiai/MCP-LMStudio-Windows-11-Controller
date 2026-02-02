/**
 * tools/registry_manager.ts
 *
 * Read and write the Windows Registry.
 * All operations go through PowerShell cmdlets (Get-ItemProperty,
 * Set-ItemProperty, Remove-Item, reg export).
 *
 * Security: HKEY_LOCAL_MACHINE paths automatically set requiresElevation
 * in their TSD. The applier will block them if the process is not elevated.
 */
import { ToolModule } from '../core/types';
declare const registryManager: ToolModule;
export default registryManager;
//# sourceMappingURL=registry_manager.d.ts.map