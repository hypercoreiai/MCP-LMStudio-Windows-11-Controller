/**
 * tools/input_handler.ts
 *
 * Simulates keyboard and mouse input on the Windows desktop.
 *
 * Architecture note on the native addon:
 *   The ideal path for low-latency input simulation is a small N-API native
 *   addon that calls Windows SendInput() directly. However, compiling native
 *   addons requires build tools on the target machine, so this module
 *   gracefully degrades:
 *
 *     1. Try to load the native addon (./native/input_addon.node)
 *     2. If unavailable, fall back to PowerShell + .NET:
 *          - Keyboard: System.Windows.Forms.SendKeys
 *          - Mouse: P/Invoke to user32.dll SendInput
 *
 *   The fallback is ~50-100ms slower per call but requires zero compilation.
 */
import { ToolModule } from '../core/types';
declare const inputHandler: ToolModule;
export default inputHandler;
//# sourceMappingURL=input_handler.d.ts.map