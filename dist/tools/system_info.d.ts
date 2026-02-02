/**
 * tools/system_info.ts
 *
 * Read-only system information queries. Nothing here modifies state.
 * Safe to call frequently for monitoring or decision-making.
 * All data comes from WMI / PowerShell CIM queries.
 */
import { ToolModule } from '../core/types';
declare const systemInfo: ToolModule;
export default systemInfo;
//# sourceMappingURL=system_info.d.ts.map