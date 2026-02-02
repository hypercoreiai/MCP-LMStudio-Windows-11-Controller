"use strict";
/**
 * tools/display_manager.ts
 *
 * Query and control monitors and display settings.
 * Screenshot capture uses .NET Graphics.CopyFromScreen.
 * Resolution and DPI changes use the Windows ChangeDisplaySettings API.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const child_process_1 = require("child_process");
const registry_1 = require("../core/registry");
const errors_1 = require("../core/errors");
const logger_1 = require("../core/logger");
const log = (0, logger_1.scopedLogger)('tools/display_manager');
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
        throw new errors_1.ExecutionError('display_manager', e.stderr?.toString() || e.message);
    }
}
// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------
async function handleDisplayList(_args) {
    const script = `
    Add-Type -AssemblyName System.Windows.Forms;
    [System.Windows.Forms.Screen]::AllScreens | ForEach-Object {
      [PSCustomObject]@{
        DeviceName = $_.DeviceName;
        Primary    = $_.Primary;
        X          = $_.Bounds.X;
        Y          = $_.Bounds.Y;
        Width      = $_.Bounds.Width;
        Height     = $_.Bounds.Height;
        WorkingAreaWidth  = $_.WorkingArea.Width;
        WorkingAreaHeight = $_.WorkingArea.Height;
      }
    } | ConvertTo-Json -Depth 2;
  `;
    const raw = ps(script);
    let monitors;
    try {
        // PowerShell returns a single object (not array) if there's only one monitor
        const parsed = JSON.parse(raw || '[]');
        monitors = Array.isArray(parsed) ? parsed : [parsed];
    }
    catch {
        monitors = [];
    }
    return { success: true, data: { monitors }, durationMs: 0 };
}
async function handleDisplayScreenshot(args) {
    const monitorIndex = args.monitorIndex;
    const region = args.region;
    const format = args.format ?? 'png'; // png | jpeg
    let captureScript;
    if (region) {
        // Capture a specific bounding rectangle
        captureScript = `
      Add-Type -AssemblyName System.Drawing;
      $bmp = New-Object System.Drawing.Bitmap(${region.width}, ${region.height});
      $g = [System.Drawing.Graphics]::FromImage($bmp);
      $g.CopyFromScreen(${region.x}, ${region.y}, 0, 0, [System.Drawing.Size]::new(${region.width}, ${region.height}));
      $g.Dispose();
      $ms = New-Object System.IO.MemoryStream;
      $bmp.Save($ms, '${format === 'jpeg' ? 'Jpeg' : 'Png'}');
      $bmp.Dispose();
      [Convert]::ToBase64String($ms.ToArray());
    `;
    }
    else if (monitorIndex !== undefined) {
        // Capture a specific monitor
        captureScript = `
      Add-Type -AssemblyName System.Windows.Forms;
      Add-Type -AssemblyName System.Drawing;
      $screen = [System.Windows.Forms.Screen]::AllScreens[${monitorIndex}];
      if ($null -eq $screen) { throw "Monitor index ${monitorIndex} out of range" }
      $bmp = New-Object System.Drawing.Bitmap($screen.Bounds.Width, $screen.Bounds.Height);
      $g = [System.Drawing.Graphics]::FromImage($bmp);
      $g.CopyFromScreen($screen.Bounds.Location, [System.Drawing.Point]::Empty, $screen.Bounds.Size);
      $g.Dispose();
      $ms = New-Object System.IO.MemoryStream;
      $bmp.Save($ms, '${format === 'jpeg' ? 'Jpeg' : 'Png'}');
      $bmp.Dispose();
      [Convert]::ToBase64String($ms.ToArray());
    `;
    }
    else {
        // Full desktop (all monitors combined)
        captureScript = `
      Add-Type -AssemblyName System.Windows.Forms;
      Add-Type -AssemblyName System.Drawing;
      # Calculate the bounding box of all screens
      $allScreens = [System.Windows.Forms.Screen]::AllScreens;
      $minX = ($allScreens | Measure-Object -Property { $_.Bounds.X } -Minimum).Minimum;
      $minY = ($allScreens | Measure-Object -Property { $_.Bounds.Y } -Minimum).Minimum;
      $maxX = ($allScreens | ForEach-Object { $_.Bounds.X + $_.Bounds.Width } | Measure-Object -Maximum).Maximum;
      $maxY = ($allScreens | ForEach-Object { $_.Bounds.Y + $_.Bounds.Height } | Measure-Object -Maximum).Maximum;
      $totalW = [int]($maxX - $minX);
      $totalH = [int]($maxY - $minY);

      $bmp = New-Object System.Drawing.Bitmap($totalW, $totalH);
      $g = [System.Drawing.Graphics]::FromImage($bmp);
      $g.CopyFromScreen([int]$minX, [int]$minY, 0, 0, [System.Drawing.Size]::new($totalW, $totalH));
      $g.Dispose();
      $ms = New-Object System.IO.MemoryStream;
      $bmp.Save($ms, '${format === 'jpeg' ? 'Jpeg' : 'Png'}');
      $bmp.Dispose();
      [Convert]::ToBase64String($ms.ToArray());
    `;
    }
    const base64 = ps(captureScript, 15000);
    return {
        success: true,
        data: {
            imageBase64: base64,
            format,
            capturedRegion: region ?? (monitorIndex !== undefined ? `monitor_${monitorIndex}` : 'full_desktop')
        },
        durationMs: 0
    };
}
async function handleDisplayScreenshotAnnotated(args) {
    const monitorIndex = args.monitorIndex;
    const region = args.region;
    const elements = args.elements;
    const format = args.format ?? 'png';
    let captureScript;
    const drawAnnotations = elements && elements.length > 0 ? `
    $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::Red, 2);
    ${elements.map((el, i) => `
    $rect${i} = New-Object System.Drawing.Rectangle(${el.x}, ${el.y}, ${el.width}, ${el.height});
    $g.DrawRectangle($pen, $rect${i});
    `).join('')}
    $pen.Dispose();
  ` : '';
    if (region) {
        captureScript = `
      Add-Type -AssemblyName System.Drawing;
      $bmp = New-Object System.Drawing.Bitmap(${region.width}, ${region.height});
      $g = [System.Drawing.Graphics]::FromImage($bmp);
      $g.CopyFromScreen(${region.x}, ${region.y}, 0, 0, [System.Drawing.Size]::new(${region.width}, ${region.height}));
      ${drawAnnotations}
      $g.Dispose();
      $ms = New-Object System.IO.MemoryStream;
      $bmp.Save($ms, '${format === 'jpeg' ? 'Jpeg' : 'Png'}');
      $bmp.Dispose();
      [Convert]::ToBase64String($ms.ToArray());
    `;
    }
    else if (monitorIndex !== undefined) {
        captureScript = `
      Add-Type -AssemblyName System.Windows.Forms;
      Add-Type -AssemblyName System.Drawing;
      $screen = [System.Windows.Forms.Screen]::AllScreens[${monitorIndex}];
      if ($null -eq $screen) { throw "Monitor index ${monitorIndex} out of range" }
      $bmp = New-Object System.Drawing.Bitmap($screen.Bounds.Width, $screen.Bounds.Height);
      $g = [System.Drawing.Graphics]::FromImage($bmp);
      $g.CopyFromScreen($screen.Bounds.Location, [System.Drawing.Point]::Empty, $screen.Bounds.Size);
      ${drawAnnotations}
      $g.Dispose();
      $ms = New-Object System.IO.MemoryStream;
      $bmp.Save($ms, '${format === 'jpeg' ? 'Jpeg' : 'Png'}');
      $bmp.Dispose();
      [Convert]::ToBase64String($ms.ToArray());
    `;
    }
    else {
        captureScript = `
      Add-Type -AssemblyName System.Windows.Forms;
      Add-Type -AssemblyName System.Drawing;
      $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds;
      $bmp = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height);
      $g = [System.Drawing.Graphics]::FromImage($bmp);
      $g.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size);
      ${drawAnnotations}
      $g.Dispose();
      $ms = New-Object System.IO.MemoryStream;
      $bmp.Save($ms, '${format === 'jpeg' ? 'Jpeg' : 'Png'}');
      $bmp.Dispose();
      [Convert]::ToBase64String($ms.ToArray());
    `;
    }
    const base64 = ps(captureScript, 15000);
    return {
        success: true,
        data: {
            imageBase64: base64,
            format,
            capturedRegion: region ?? (monitorIndex !== undefined ? `monitor_${monitorIndex}` : 'full_desktop'),
            annotations: elements ? elements.length : 0
        },
        durationMs: 0
    };
}
async function handleDisplaySetResolution(args) {
    const deviceName = args.deviceName;
    const width = args.width;
    const height = args.height;
    const refreshRate = args.refreshRate ?? 60;
    // Use wmic or PowerShell CIM to change display settings
    // Note: On modern Windows this triggers a brief screen flicker
    const script = `
    $devicePath = "${deviceName}";
    # Use Set-CimInstance with Win32_VideoController is read-only;
    # We use the Windows shell utility instead
    $result = & "C:\\Windows\\System32\\config.exe" /QUIET /FORCE 2>&1;
    # Fallback: use powershell to invoke ChangeDisplaySettingsA via P/Invoke
    Add-Type '
      using System;
      using System.Runtime.InteropServices;
      public class DisplayApi {
        [StructLayout(LayoutKind.Sequential)]
        public struct DEVMODE {
          [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string dmDeviceName;
          public ushort dmSpecVersion;
          public ushort dmDriverVersion;
          public ushort dmSize;
          public ushort dmDriverExtra;
          public uint dmFields;
          public int dmPositionX;
          public int dmPositionY;
          public uint dmOrientation;
          public uint dmPaperSafeArea;
          public uint dmPaperWidth;
          public uint dmPaperLength;
          public uint dmScale;
          public uint dmCopies;
          public uint dmDefaultBin;
          public uint dmDuplex;
          public short dmYResolution;
          public short dmOrientation2;
          public short dmTTOption;
          public short dmCollate;
          [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 9)] public string dmFormName;
          public short dmLogPixelsX;
          public short dmLogPixelsY;
          public uint dmBitsPerPel;
          public uint dmPelsWidth;
          public uint dmPelsHeight;
          public uint dmDisplayFlags;
          public uint dmDisplayFrequency;
        }
        [DllImport("user32.dll")] public static extern int ChangeDisplaySettingsA(ref DEVMODE lpDevMode, uint dwFlags);
        public const uint CDS_UPDATE_REGISTRY = 0x00000001;
        public const uint DMMDF_PELSWIDTH = 0x00010000;
        public const uint DMMDF_PELSHEIGHT = 0x00020000;
        public const uint DMMDF_DISPLAYFREQUENCY = 0x00800000;
      }
    ';

    $devmode = New-Object DisplayApi+DEVMODE;
    $devmode.dmSize = [System.Runtime.InteropServices.Marshal]::SizeOf($devmode);
    $devmode.dmDeviceName = $devicePath;
    $devmode.dmPelsWidth  = ${width};
    $devmode.dmPelsHeight = ${height};
    $devmode.dmDisplayFrequency = ${refreshRate};
    $devmode.dmFields = 0x00010000 -bor 0x00020000 -bor 0x00800000;

    $ret = [DisplayApi]::ChangeDisplaySettingsA([ref]$devmode, [DisplayApi]::CDS_UPDATE_REGISTRY);
    Write-Output $ret;  # 0 = success
  `;
    const result = ps(script);
    const success = result.trim() === '0';
    return {
        success,
        data: { deviceName, width, height, refreshRate, returnCode: parseInt(result, 10) },
        error: success ? undefined : { code: 'DISPLAY_CHANGE_FAILED', message: `ChangeDisplaySettings returned ${result}` },
        durationMs: 0
    };
}
async function handleDisplaySetDpi(args) {
    const deviceName = args.deviceName;
    const dpi = args.dpi;
    // DPI scaling on Windows 10+ is per-app or per-monitor.
    // Per-monitor DPI is set via registry + a restart of affected apps.
    // We set it via the registry key that Windows Settings uses.
    const script = `
    # Per-monitor DPI scaling registry key
    # This requires a logoff/logon or explorer restart to take effect for desktop apps
    $regPath = "HKCU:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\AppCompatibility\\OverrideCompatibilityMode";
    if (-not (Test-Path $regPath)) { New-Item -Path $regPath -Force | Out-Null }

    # The actual per-monitor DPI is complex — for simplicity we set the global DPI scale
    # DPI scale factor: 100% = 96 DPI, 125% = 120 DPI, 150% = 144 DPI, 200% = 192 DPI
    $scalePct = [math]::Round((${dpi} / 96) * 100);
    $regPath2 = "HKCU:\\Control Panel\\Desktop";
    Set-ItemProperty -Path $regPath2 -Name "LogicalDpi" -Value "${dpi}" -Type DWord 2>/dev/null;

    # Restart Windows Explorer to apply (non-destructive — taskbar and desktop reload)
    # taskkill /f /im explorer.exe; start explorer.exe
    Write-Output "DPI set to ${dpi} ($scalePct%25). Explorer restart may be needed."
  `;
    const msg = ps(script);
    return { success: true, data: { dpi, message: msg }, durationMs: 0 };
}
async function handleDisplaySetBrightness(args) {
    const level = args.level; // 0–100
    // Brightness control via WMI (works on laptops with ACPI brightness)
    const script = `
    $brightness = Get-CimInstance -Namespace root\\wmi -ClassName Backlight -ErrorAction SilentlyContinue;
    if ($null -eq $brightness) {
      Write-Error "Brightness control not available (no WMI Backlight class — likely a desktop or unsupported laptop)";
      exit 1;
    }
    $brightness.Brightness = ${level};
    Set-CimInstance -InputObject $brightness;
    Write-Output "Brightness set to ${level}";
  `;
    try {
        const msg = ps(script);
        return { success: true, data: { brightness: level, message: msg }, durationMs: 0 };
    }
    catch (e) {
        return {
            success: false,
            error: { code: 'BRIGHTNESS_UNAVAILABLE', message: e.message },
            durationMs: 0
        };
    }
}
// ---------------------------------------------------------------------------
// Module definition + registration
// ---------------------------------------------------------------------------
const displayManager = {
    name: 'display_manager',
    tools: [
        {
            name: 'display.list',
            description: 'List all connected monitors with their resolution, position, working area, and whether they are the primary display.',
            parameters: { type: 'object', properties: {}, required: [] }
        },
        {
            name: 'display.screenshot',
            description: 'Capture a screenshot. Can capture the full desktop, a single monitor by index, or a custom bounding rectangle. Returns base64-encoded image data.',
            parameters: {
                type: 'object',
                properties: {
                    monitorIndex: { type: 'number', description: 'Index of the monitor to capture (0-based). Omit for full desktop.' },
                    region: {
                        type: 'object',
                        description: 'Custom capture region (overrides monitorIndex if both provided)',
                        properties: {
                            x: { type: 'number', description: 'Left edge X coordinate' },
                            y: { type: 'number', description: 'Top edge Y coordinate' },
                            width: { type: 'number', description: 'Width in pixels' },
                            height: { type: 'number', description: 'Height in pixels' }
                        },
                        required: ['x', 'y', 'width', 'height']
                    },
                    format: { type: 'string', description: 'Image format', enum: ['png', 'jpeg'], default: 'png' }
                }
            }
        },
        {
            name: 'display.screenshot.annotated',
            description: 'Capture a screenshot with UI element annotations (red bounding boxes). Useful for visualizing UI elements from ui.list_elements.',
            parameters: {
                type: 'object',
                properties: {
                    monitorIndex: { type: 'number', description: 'Index of the monitor to capture (0-based). Omit for full desktop.' },
                    region: {
                        type: 'object',
                        description: 'Custom capture region (overrides monitorIndex if both provided)',
                        properties: {
                            x: { type: 'number', description: 'Left edge X coordinate' },
                            y: { type: 'number', description: 'Top edge Y coordinate' },
                            width: { type: 'number', description: 'Width in pixels' },
                            height: { type: 'number', description: 'Height in pixels' }
                        },
                        required: ['x', 'y', 'width', 'height']
                    },
                    elements: {
                        type: 'array',
                        description: 'List of UI elements to annotate with red bounding boxes',
                        items: {
                            type: 'object',
                            properties: {
                                x: { type: 'number', description: 'X coordinate of top-left' },
                                y: { type: 'number', description: 'Y coordinate of top-left' },
                                width: { type: 'number', description: 'Width in pixels' },
                                height: { type: 'number', description: 'Height in pixels' },
                                name: { type: 'string', description: 'Optional label for the element' }
                            },
                            required: ['x', 'y', 'width', 'height']
                        }
                    },
                    format: { type: 'string', description: 'Image format', enum: ['png', 'jpeg'], default: 'png' }
                }
            }
        },
        {
            name: 'display.set_resolution',
            description: 'Change the resolution of a specific monitor. Triggers a brief screen flicker.',
            parameters: {
                type: 'object',
                properties: {
                    deviceName: { type: 'string', description: 'Device name from display.list (e.g. "\\\\\\\\.\\\\DISPLAY1")' },
                    width: { type: 'number', description: 'New width in pixels' },
                    height: { type: 'number', description: 'New height in pixels' },
                    refreshRate: { type: 'number', description: 'Refresh rate in Hz. Default: 60' }
                },
                required: ['deviceName', 'width', 'height']
            }
        },
        {
            name: 'display.set_dpi',
            description: 'Set the DPI scaling value. 96 = 100%%, 120 = 125%%, 144 = 150%%, 192 = 200%%. May require an Explorer restart.',
            parameters: {
                type: 'object',
                properties: {
                    deviceName: { type: 'string', description: 'Target device name' },
                    dpi: { type: 'number', description: 'DPI value (e.g. 96, 120, 144, 192)' }
                },
                required: ['deviceName', 'dpi']
            }
        },
        {
            name: 'display.set_brightness',
            description: 'Set screen brightness on laptops or monitors that support ACPI brightness control. Value 0–100.',
            parameters: {
                type: 'object',
                properties: {
                    level: { type: 'number', description: 'Brightness level (0 = off, 100 = maximum)' }
                },
                required: ['level']
            }
        }
    ],
    async execute(toolName, args) {
        log.debug({ toolName }, 'Executing');
        switch (toolName) {
            case 'display.list': return handleDisplayList(args);
            case 'display.screenshot': return handleDisplayScreenshot(args);
            case 'display.screenshot.annotated': return handleDisplayScreenshotAnnotated(args);
            case 'display.set_resolution': return handleDisplaySetResolution(args);
            case 'display.set_dpi': return handleDisplaySetDpi(args);
            case 'display.set_brightness': return handleDisplaySetBrightness(args);
            default:
                throw new errors_1.ExecutionError('display_manager', `Unknown tool: ${toolName}`);
        }
    }
};
registry_1.registry.register(displayManager);
exports.default = displayManager;
//# sourceMappingURL=display_manager.js.map