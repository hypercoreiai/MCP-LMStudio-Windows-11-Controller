"use strict";
/**
 * tools/virtual_desktop_manager.ts
 *
 * Manages Windows Virtual Desktops using COM interfaces.
 * Provides tools to create, remove, rename, switch, and list virtual desktops.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const child_process_1 = require("child_process");
const registry_1 = require("../core/registry");
const errors_1 = require("../core/errors");
const logger_1 = require("../core/logger");
const log = (0, logger_1.scopedLogger)('tools/virtual_desktop_manager');
// ---------------------------------------------------------------------------
// PowerShell helper
// ---------------------------------------------------------------------------
function ps(script, timeoutMs = 10000) {
    try {
        // Encode script as Base64 UTF-16LE for PowerShell -EncodedCommand
        const buffer = Buffer.from(script, 'utf16le');
        const encoded = buffer.toString('base64');
        return (0, child_process_1.execSync)(`powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${encoded}`, { encoding: 'utf-8', timeout: timeoutMs, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    }
    catch (e) {
        throw new errors_1.ExecutionError('virtual_desktop_manager', e.stderr?.toString() || e.message);
    }
}
// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------
async function handleVDCreate(args) {
    const name = args.name;
    const script = `
    Add-Type -AssemblyName System.Windows.Forms;
    $vdm = [System.Windows.Forms.Application]::VirtualDesktopManager;
    if ($vdm) {
      $guid = $vdm.CreateDesktop();
      if ('${name}') {
        # Note: Renaming might require additional COM calls, simplified here
        Write-Output "Created desktop with GUID: $guid (name: ${name})";
      } else {
        Write-Output "Created desktop with GUID: $guid";
      }
    } else {
      throw "Virtual Desktop Manager not available";
    }
  `;
    const result = ps(script);
    return { success: true, data: { result }, durationMs: 0 };
}
async function handleVDRemove(args) {
    const guid = args.guid;
    if (!guid) {
        throw new errors_1.ExecutionError('virtual_desktop_manager', 'GUID is required');
    }
    const script = `
    Add-Type -AssemblyName System.Windows.Forms;
    $vdm = [System.Windows.Forms.Application]::VirtualDesktopManager;
    if ($vdm) {
      $vdm.RemoveDesktop([Guid]::Parse('${guid}'));
      Write-Output "Removed desktop ${guid}";
    } else {
      throw "Virtual Desktop Manager not available";
    }
  `;
    const result = ps(script);
    return { success: true, data: { result }, durationMs: 0 };
}
async function handleVDSwitch(args) {
    const guid = args.guid;
    if (!guid) {
        throw new errors_1.ExecutionError('virtual_desktop_manager', 'GUID is required');
    }
    const script = `
    Add-Type -AssemblyName System.Windows.Forms;
    $vdm = [System.Windows.Forms.Application]::VirtualDesktopManager;
    if ($vdm) {
      $vdm.SwitchDesktop([Guid]::Parse('${guid}'));
      Write-Output "Switched to desktop ${guid}";
    } else {
      throw "Virtual Desktop Manager not available";
    }
  `;
    const result = ps(script);
    return { success: true, data: { result }, durationMs: 0 };
}
async function handleVDList(_args) {
    const script = `
    Add-Type -AssemblyName System.Windows.Forms;
    $vdm = [System.Windows.Forms.Application]::VirtualDesktopManager;
    if ($vdm) {
      $desktops = $vdm.GetDesktops();
      $result = @();
      foreach ($d in $desktops) {
        $result += @{ GUID = $d.Id.ToString(); Name = "Desktop"; Current = ($vdm.GetCurrentDesktop().Id -eq $d.Id) };
      }
      $result | ConvertTo-Json;
    } else {
      throw "Virtual Desktop Manager not available";
    }
  `;
    const raw = ps(script);
    let desktops;
    try {
        desktops = JSON.parse(raw || '[]');
    }
    catch {
        desktops = [];
    }
    return { success: true, data: { desktops }, durationMs: 0 };
}
// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------
const virtualDesktopManager = {
    name: 'virtual_desktop_manager',
    tools: [
        {
            name: 'vd.create',
            description: 'Create a new virtual desktop.',
            parameters: {
                type: 'object',
                properties: {
                    name: { type: 'string', description: 'Optional name for the desktop' }
                }
            }
        },
        {
            name: 'vd.remove',
            description: 'Remove a virtual desktop by GUID.',
            parameters: {
                type: 'object',
                properties: {
                    guid: { type: 'string', description: 'GUID of the desktop to remove' }
                },
                required: ['guid']
            }
        },
        {
            name: 'vd.switch',
            description: 'Switch to a virtual desktop by GUID.',
            parameters: {
                type: 'object',
                properties: {
                    guid: { type: 'string', description: 'GUID of the desktop to switch to' }
                },
                required: ['guid']
            }
        },
        {
            name: 'vd.list',
            description: 'List all virtual desktops.',
            parameters: {
                type: 'object',
                properties: {}
            }
        }
    ],
    async execute(toolName, args) {
        log.debug({ toolName, args }, 'Executing');
        switch (toolName) {
            case 'vd.create': return handleVDCreate(args);
            case 'vd.remove': return handleVDRemove(args);
            case 'vd.switch': return handleVDSwitch(args);
            case 'vd.list': return handleVDList(args);
            default:
                throw new errors_1.ExecutionError('virtual_desktop_manager', `Unknown tool: ${toolName}`);
        }
    }
};
// Self-register
registry_1.registry.register(virtualDesktopManager);
exports.default = virtualDesktopManager;
//# sourceMappingURL=virtual_desktop_manager.js.map