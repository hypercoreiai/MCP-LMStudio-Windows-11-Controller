/**
 * tools/window_manager.ts
 * 
 * Controls application windows on the Windows 11 desktop.
 * All Win32 window operations are performed via PowerShell + .NET
 * (System.Windows.Forms for window enumeration, plus P/Invoke shims
 * for SetForegroundWindow, ShowWindow, MoveWindow, etc.)
 */

import { execSync } from 'child_process';
import { ToolModule, ToolResult } from '../core/types';
import { registry } from '../core/registry';
import { ExecutionError } from '../core/errors';
import { scopedLogger } from '../core/logger';

const log = scopedLogger('tools/window_manager');

// ---------------------------------------------------------------------------
// PowerShell helpers
// ---------------------------------------------------------------------------

function ps(script: string, timeoutMs = 10000): string {
  try {
    // Encode script as Base64 UTF-16LE for PowerShell -EncodedCommand
    const buffer = Buffer.from(script, 'utf16le');
    const encoded = buffer.toString('base64');
    
    return execSync(
      `powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${encoded}`,
      { encoding: 'utf-8', timeout: timeoutMs, stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();
  } catch (e: any) {
    const stderr = e.stderr?.toString() ?? '';
    throw new ExecutionError('window_manager', stderr || e.message);
  }
}

// ---------------------------------------------------------------------------
// Internal dispatch
// ---------------------------------------------------------------------------

async function handleWindowList(_args: Record<string, unknown>): Promise<ToolResult> {
  const script = `
    Add-Type -AssemblyName System.Windows.Forms;
    $screens = [System.Windows.Forms.Screen]::AllScreens;
    $result = @();
    foreach ($s in $screens) {
      $result += @{ Name = $s.DeviceName; Bounds = $s.Bounds.ToString(); Primary = $s.Primary };
    }
    # Use Get-Process to enumerate windows with titles
    Get-Process | Where-Object { $_.MainWindowTitle -ne '' } | ForEach-Object {
      [PSCustomObject]@{
        Pid        = $_.Id;
        Title      = $_.MainWindowTitle;
        ProcessName = $_.ProcessName;
        Handle     = $_.MainWindowHandle;
      }
    } | ConvertTo-Json -Depth 3;
  `;

  const raw = ps(script);
  let windows: unknown[];
  try {
    windows = JSON.parse(raw || '[]');
  } catch {
    windows = [];
  }

  return { success: true, data: { windows }, durationMs: 0 };
}

async function handleWindowFocus(args: Record<string, unknown>): Promise<ToolResult> {
  const pid = args.pid as number;
  const script = `
    $proc = Get-Process -Id ${pid} -ErrorAction Stop;
    $handle = $proc.MainWindowHandle;
    Add-Type '
      using System;
      using System.Runtime.InteropServices;
      public class Win32 {
        [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
      }
    ';
    [Win32]::SetForegroundWindow($handle) | Out-Null;
    Write-Output "OK";
  `;

  ps(script);
  return { success: true, data: { focused: pid }, durationMs: 0 };
}

async function handleWindowMove(args: Record<string, unknown>): Promise<ToolResult> {
  const pid = args.pid as number;
  const x = args.x as number;
  const y = args.y as number;
  const script = `
    $proc = Get-Process -Id ${pid} -ErrorAction Stop;
    $handle = $proc.MainWindowHandle;
    Add-Type '
      using System;
      using System.Runtime.InteropServices;
      public class Win32Move {
        [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr hWnd, int x, int y, int nWidth, int nHeight, bool bRepaint);
        [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, ref System.Drawing.Rectangle lpRect);
      }
    ';
    $rect = New-Object System.Drawing.Rectangle;
    [Win32Move]::GetWindowRect($handle, [ref]$rect) | Out-Null;
    [Win32Move]::MoveWindow($handle, ${x}, ${y}, $rect.Width, $rect.Height, $true) | Out-Null;
    Write-Output "OK";
  `;

  ps(script);
  return { success: true, data: { moved: { pid, x, y } }, durationMs: 0 };
}

async function handleWindowResize(args: Record<string, unknown>): Promise<ToolResult> {
  const pid = args.pid as number;
  const width = args.width as number;
  const height = args.height as number;
  const script = `
    $proc = Get-Process -Id ${pid} -ErrorAction Stop;
    $handle = $proc.MainWindowHandle;
    Add-Type '
      using System;
      using System.Runtime.InteropServices;
      public class Win32Resize {
        [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr hWnd, int x, int y, int nWidth, int nHeight, bool bRepaint);
        [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, ref System.Drawing.Rectangle lpRect);
      }
    ';
    $rect = New-Object System.Drawing.Rectangle;
    [Win32Resize]::GetWindowRect($handle, [ref]$rect) | Out-Null;
    [Win32Resize]::MoveWindow($handle, $rect.X, $rect.Y, ${width}, ${height}, $true) | Out-Null;
    Write-Output "OK";
  `;

  ps(script);
  return { success: true, data: { resized: { pid, width, height } }, durationMs: 0 };
}

async function handleWindowMinimize(args: Record<string, unknown>): Promise<ToolResult> {
  const pid = args.pid as number;
  // SW_MINIMIZE = 9
  const script = `
    $proc = Get-Process -Id ${pid} -ErrorAction Stop;
    $handle = $proc.MainWindowHandle;
    Add-Type '
      using System;
      using System.Runtime.InteropServices;
      public class Win32Min {
        [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
      }
    ';
    [Win32Min]::ShowWindow($handle, 9) | Out-Null;
    Write-Output "OK";
  `;

  ps(script);
  return { success: true, data: { minimized: pid }, durationMs: 0 };
}

async function handleWindowMaximize(args: Record<string, unknown>): Promise<ToolResult> {
  const pid = args.pid as number;
  // SW_MAXIMIZE = 3
  const script = `
    $proc = Get-Process -Id ${pid} -ErrorAction Stop;
    $handle = $proc.MainWindowHandle;
    Add-Type '
      using System;
      using System.Runtime.InteropServices;
      public class Win32Max {
        [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
      }
    ';
    [Win32Max]::ShowWindow($handle, 3) | Out-Null;
    Write-Output "OK";
  `;

  ps(script);
  return { success: true, data: { maximized: pid }, durationMs: 0 };
}

async function handleWindowRestore(args: Record<string, unknown>): Promise<ToolResult> {
  const pid = args.pid as number;
  // SW_RESTORE = 9 (actually SW_RESTORE = 9 restores from min; use 1 = SW_SHOWNORMAL for general restore)
  const script = `
    $proc = Get-Process -Id ${pid} -ErrorAction Stop;
    $handle = $proc.MainWindowHandle;
    Add-Type '
      using System;
      using System.Runtime.InteropServices;
      public class Win32Restore {
        [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
      }
    ';
    [Win32Restore]::ShowWindow($handle, 1) | Out-Null;
    Write-Output "OK";
  `;

  ps(script);
  return { success: true, data: { restored: pid }, durationMs: 0 };
}

async function handleWindowClose(args: Record<string, unknown>): Promise<ToolResult> {
  const pid = args.pid as number;
  // WM_CLOSE = 0x0010
  const script = `
    $proc = Get-Process -Id ${pid} -ErrorAction Stop;
    $handle = $proc.MainWindowHandle;
    Add-Type '
      using System;
      using System.Runtime.InteropServices;
      public class Win32Close {
        [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
      }
    ';
    [Win32Close]::PostMessage($handle, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null;
    Write-Output "OK";
  `;

  ps(script);
  return { success: true, data: { closeSent: pid }, durationMs: 0 };
}

async function handleWindowSnap(args: Record<string, unknown>): Promise<ToolResult> {
  const pid = args.pid as number;
  const slot = args.slot as string; // "left", "right", "top", "bottom", "topLeft", "topRight", "bottomLeft", "bottomRight"

  // Windows 11 snap layouts are managed by the shell. We approximate by
  // reading the primary screen dimensions and moving/resizing accordingly.
  const script = `
    Add-Type -AssemblyName System.Windows.Forms;
    $screen = [System.Windows.Forms.Screen]::PrimaryScreen;
    $w = $screen.Bounds.Width;
    $h = $screen.Bounds.Height;
    $x = $screen.Bounds.X;
    $y = $screen.Bounds.Y;

    $proc = Get-Process -Id ${pid} -ErrorAction Stop;
    $handle = $proc.MainWindowHandle;

    Add-Type '
      using System;
      using System.Runtime.InteropServices;
      public class Win32Snap {
        [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr hWnd, int x, int y, int nWidth, int nHeight, bool bRepaint);
        [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
      }
    ';

    # Restore first (SW_SHOWNORMAL = 1)
    [Win32Snap]::ShowWindow($handle, 1) | Out-Null;

    switch ("${slot}") {
      "left"        { [Win32Snap]::MoveWindow($handle, $x, $y, $w/2, $h, $true) }
      "right"       { [Win32Snap]::MoveWindow($handle, $x + $w/2, $y, $w/2, $h, $true) }
      "top"         { [Win32Snap]::MoveWindow($handle, $x, $y, $w, $h/2, $true) }
      "bottom"      { [Win32Snap]::MoveWindow($handle, $x, $y + $h/2, $w, $h/2, $true) }
      "topLeft"     { [Win32Snap]::MoveWindow($handle, $x, $y, $w/2, $h/2, $true) }
      "topRight"    { [Win32Snap]::MoveWindow($handle, $x + $w/2, $y, $w/2, $h/2, $true) }
      "bottomLeft"  { [Win32Snap]::MoveWindow($handle, $x, $y + $h/2, $w/2, $h/2, $true) }
      "bottomRight" { [Win32Snap]::MoveWindow($handle, $x + $w/2, $y + $h/2, $w/2, $h/2, $true) }
    }
    Write-Output "OK";
  `;

  ps(script);
  return { success: true, data: { snapped: { pid, slot } }, durationMs: 0 };
}

// ---------------------------------------------------------------------------
// Module definition + registration
// ---------------------------------------------------------------------------

const windowManager: ToolModule = {
  name: 'window_manager',

  tools: [
    {
      name: 'window.list',
      description: 'List all visible application windows with their title, PID, process name, and window handle.',
      parameters: { type: 'object', properties: {}, required: [] }
    },
    {
      name: 'window.focus',
      description: 'Bring a specific window to the foreground by its process ID.',
      parameters: {
        type: 'object',
        properties: {
          pid: { type: 'number', description: 'Process ID of the target window' }
        },
        required: ['pid']
      }
    },
    {
      name: 'window.move',
      description: 'Move a window to a new position specified by top-left corner coordinates (pixels).',
      parameters: {
        type: 'object',
        properties: {
          pid:  { type: 'number', description: 'Process ID of the target window' },
          x:    { type: 'number', description: 'New X coordinate (pixels from left edge of primary monitor)' },
          y:    { type: 'number', description: 'New Y coordinate (pixels from top edge of primary monitor)' }
        },
        required: ['pid', 'x', 'y']
      }
    },
    {
      name: 'window.resize',
      description: 'Resize a window to the specified width and height in pixels.',
      parameters: {
        type: 'object',
        properties: {
          pid:    { type: 'number', description: 'Process ID of the target window' },
          width:  { type: 'number', description: 'New width in pixels' },
          height: { type: 'number', description: 'New height in pixels' }
        },
        required: ['pid', 'width', 'height']
      }
    },
    {
      name: 'window.minimize',
      description: 'Minimize a window.',
      parameters: {
        type: 'object',
        properties: {
          pid: { type: 'number', description: 'Process ID of the target window' }
        },
        required: ['pid']
      }
    },
    {
      name: 'window.maximize',
      description: 'Maximize a window to fill its monitor.',
      parameters: {
        type: 'object',
        properties: {
          pid: { type: 'number', description: 'Process ID of the target window' }
        },
        required: ['pid']
      }
    },
    {
      name: 'window.restore',
      description: 'Restore a minimized or maximized window to its previous size and position.',
      parameters: {
        type: 'object',
        properties: {
          pid: { type: 'number', description: 'Process ID of the target window' }
        },
        required: ['pid']
      }
    },
    {
      name: 'window.close',
      description: 'Send a close message to a window. Note: the application may show a save dialog before actually closing.',
      parameters: {
        type: 'object',
        properties: {
          pid: { type: 'number', description: 'Process ID of the target window' }
        },
        required: ['pid']
      }
    },
    {
      name: 'window.snap',
      description: 'Snap a window to a Windows 11 snap layout position.',
      parameters: {
        type: 'object',
        properties: {
          pid:  { type: 'number', description: 'Process ID of the target window' },
          slot: {
            type: 'string',
            description: 'Snap layout slot',
            enum: ['left', 'right', 'top', 'bottom', 'topLeft', 'topRight', 'bottomLeft', 'bottomRight']
          }
        },
        required: ['pid', 'slot']
      }
    }
  ],

  async execute(toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
    log.debug({ toolName, args }, 'Executing');

    switch (toolName) {
      case 'window.list':     return handleWindowList(args);
      case 'window.focus':    return handleWindowFocus(args);
      case 'window.move':     return handleWindowMove(args);
      case 'window.resize':   return handleWindowResize(args);
      case 'window.minimize': return handleWindowMinimize(args);
      case 'window.maximize': return handleWindowMaximize(args);
      case 'window.restore':  return handleWindowRestore(args);
      case 'window.close':    return handleWindowClose(args);
      case 'window.snap':     return handleWindowSnap(args);
      default:
        throw new ExecutionError('window_manager', `Unknown tool: ${toolName}`);
    }
  }
};

// Self-register
registry.register(windowManager);

export default windowManager;
