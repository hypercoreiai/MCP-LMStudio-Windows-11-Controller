/**
 * tools/window_manager.ts
 *
 * Controls application windows on the Windows 11 desktop.
 * All Win32 window operations are performed via PowerShell + .NET
 * (System.Windows.Forms for window enumeration, plus P/Invoke shims
 * for SetForegroundWindow, ShowWindow, MoveWindow, etc.)
 */
import { ToolModule } from '../core/types';
declare const windowManager: ToolModule;
export default windowManager;
//# sourceMappingURL=window_manager.d.ts.map