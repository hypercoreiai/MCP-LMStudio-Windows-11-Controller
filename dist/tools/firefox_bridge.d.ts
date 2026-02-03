/**
 * tools/firefox_bridge.ts
 *
 * Provides a high-fidelity bridge to Mozilla Firefox via the Remote Debugging Protocol (RDP).
 * This bypasses Windows UI Automation (UIA) limitations for web pages by injecting
 * JavaScript directly into the browser context.
 *
 * Requirements: Firefox must be started with --remote-debugging-port=9222.
 */
import { ToolModule } from '../core/types';
declare const firefoxBridge: ToolModule;
export default firefoxBridge;
//# sourceMappingURL=firefox_bridge.d.ts.map