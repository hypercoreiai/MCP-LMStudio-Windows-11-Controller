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

import { execSync } from 'child_process';
import { ToolModule, ToolResult } from '../core/types';
import { registry } from '../core/registry';
import { ExecutionError } from '../core/errors';
import { scopedLogger } from '../core/logger';

const log = scopedLogger('tools/input_handler');

// ---------------------------------------------------------------------------
// Native addon detection
// ---------------------------------------------------------------------------

let nativeAddon: any = null;

try {
  // Attempt to load the compiled native addon.
  // Path is relative to the compiled JS output in dist/
  nativeAddon = require('../native/input_addon');
  log.info('Native input addon loaded successfully');
} catch {
  log.info('Native input addon not available — using PowerShell fallback');
}

// ---------------------------------------------------------------------------
// Key name → SendKeys escape mapping
// ---------------------------------------------------------------------------

const SENDKEYS_SPECIAL: Record<string, string> = {
  Enter:      '{ENTER}',
  Return:     '{ENTER}',
  Escape:     '{ESC}',
  Tab:        '{TAB}',
  Backspace:  '{BACKSPACE}',
  Delete:     '{DELETE}',
  Insert:     '{INSERT}',
  Home:       '{HOME}',
  End:        '{END}',
  PageUp:     '{PGUP}',
  PageDown:   '{PGDN}',
  ArrowUp:    '{UP}',
  ArrowDown:  '{DOWN}',
  ArrowLeft:  '{LEFT}',
  ArrowRight: '{RIGHT}',
  Space:      ' ',
  F1: '{F1}', F2: '{F2}', F3: '{F3}', F4: '{F4}',
  F5: '{F5}', F6: '{F6}', F7: '{F7}', F8: '{F8}',
  F9: '{F9}', F10: '{F10}', F11: '{F11}', F12: '{F12}',
  PrintScreen: '{PRTSC}',
  ScrollLock:  '{SCROLLLOCK}',
  Pause:       '{PAUSE}',
  NumLock:     '{NUMLOCK}',
  CapsLock:    '{CAPSLOCK}'
};

const SENDKEYS_MODIFIERS: Record<string, string> = {
  Ctrl:  '+',
  Shift: '+',
  Alt:   '%',
  Win:   '{LWIN}'
};

function escapeSendKeys(text: string): string {
  // SendKeys treats +, ^, %, ~, {, }, [, ] as special. Escape them with {}.
  return text.replace(/([+^%~{}\[\]])/g, '{$1}');
}

// ---------------------------------------------------------------------------
// PowerShell helper
// ---------------------------------------------------------------------------

function ps(script: string, timeoutMs = 5000): string {
  try {
    // Encode script as Base64 UTF-16LE for PowerShell -EncodedCommand
    const buffer = Buffer.from(script, 'utf16le');
    const encoded = buffer.toString('base64');
    
    return execSync(
      `powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${encoded}`,
      { encoding: 'utf-8', timeout: timeoutMs, stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();
  } catch (e: any) {
    throw new ExecutionError('input_handler', e.stderr?.toString() || e.message);
  }
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function handleInputType(args: Record<string, unknown>): Promise<ToolResult> {
  const text = args.text as string;
  const delayMs = (args.delayMs as number) ?? 0; // optional per-character delay

  if (nativeAddon) {
    nativeAddon.typeText(text, delayMs);
  } else {
    // PowerShell SendKeys fallback
    const escaped = escapeSendKeys(text);
    const script = `
      Add-Type -AssemblyName System.Windows.Forms;
      [System.Windows.Forms.SendKeys]::SendWait("${escaped}");
    `;
    ps(script, 10000);
  }

  return { success: true, data: { typed: text }, durationMs: 0 };
}

async function handleInputKey(args: Record<string, unknown>): Promise<ToolResult> {
  const key       = args.key as string;
  const modifiers = (args.modifiers as string[]) ?? [];

  if (nativeAddon) {
    nativeAddon.pressKey(key, modifiers);
  } else {
    // Build a SendKeys combo
    let combo = '';

    // Add modifier prefixes (order: Ctrl, Alt, Shift)
    const modOrder = ['Ctrl', 'Alt', 'Shift'];
    for (const mod of modOrder) {
      if (modifiers.includes(mod)) {
        combo += SENDKEYS_MODIFIERS[mod] ?? '';
      }
    }

    // Win key is special — can't combine with SendKeys prefix syntax
    if (modifiers.includes('Win')) {
      combo += '{LWIN}';
    }

    // The key itself
    combo += SENDKEYS_SPECIAL[key] ?? escapeSendKeys(key);

    const script = `
      Add-Type -AssemblyName System.Windows.Forms;
      [System.Windows.Forms.SendKeys]::SendWait("${combo}");
    `;
    ps(script);
  }

  return { success: true, data: { key, modifiers }, durationMs: 0 };
}

async function handleInputMouseClick(args: Record<string, unknown>): Promise<ToolResult> {
  const x      = args.x as number;
  const y      = args.y as number;
  const button = (args.button as string) ?? 'left'; // left | right | middle
  const clicks = (args.clicks as number) ?? 1;

  if (nativeAddon) {
    nativeAddon.mouseClick(x, y, button, clicks);
  } else {
    // PowerShell P/Invoke SendInput for mouse
    const buttonDown = button === 'right' ? 'MOUSEEVENTF_RIGHTDOWN' :
                       button === 'middle' ? 'MOUSEEVENTF_MIDDLEDOWN' : 'MOUSEEVENTF_LEFTDOWN';
    const buttonUp   = button === 'right' ? 'MOUSEEVENTF_RIGHTUP' :
                       button === 'middle' ? 'MOUSEEVENTF_MIDDLEUP' : 'MOUSEEVENTF_LEFTUP';

    // We use mouse_event (simpler than SendInput for absolute positioning)
    // MOUSEEVENTF_ABSOLUTE = 0x8000
    // Combined flags: left_down=0x0002, left_up=0x0004, right_down=0x0008, right_up=0x0010, middle_down=0x0020, middle_up=0x0040
    const downFlag = button === 'right' ? '0x0008' : button === 'middle' ? '0x0020' : '0x0002';
    const upFlag   = button === 'right' ? '0x0010' : button === 'middle' ? '0x0040' : '0x0004';

    // Normalize coordinates to 0-65535 range (mouse_event with ABSOLUTE flag expects this)
    // We need the screen resolution to do this correctly
    const script = `
      Add-Type -AssemblyName System.Windows.Forms;
      $screen = [System.Windows.Forms.Screen]::PrimaryScreen;
      $scaleX = 65535 / $screen.Bounds.Width;
      $scaleY = 65535 / $screen.Bounds.Height;
      $normX = [int](${x} * $scaleX);
      $normY = [int](${y} * $scaleY);

      Add-Type '
        using System;
        using System.Runtime.InteropServices;
        public class MouseInput {
          [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, int dx, int dy, int dwData, IntPtr dwExtraInfo);
        }
      ';

      for ($i = 0; $i -lt ${clicks}; $i++) {
        [MouseInput]::mouse_event(0x8000 -bor ${downFlag}, $normX, $normY, 0, [IntPtr]::Zero);
        Start-Sleep -Milliseconds 30;
        [MouseInput]::mouse_event(0x8000 -bor ${upFlag}, $normX, $normY, 0, [IntPtr]::Zero);
        if ($i -lt ${clicks} - 1) { Start-Sleep -Milliseconds 50; }
      }
      Write-Output "OK";
    `;
    ps(script);
  }

  return { success: true, data: { clicked: { x, y, button, clicks } }, durationMs: 0 };
}

async function handleInputMouseDrag(args: Record<string, unknown>): Promise<ToolResult> {
  const fromX = args.fromX as number;
  const fromY = args.fromY as number;
  const toX   = args.toX as number;
  const toY   = args.toY as number;

  if (nativeAddon) {
    nativeAddon.mouseDrag(fromX, fromY, toX, toY);
  } else {
    const script = `
      Add-Type -AssemblyName System.Windows.Forms;
      $screen = [System.Windows.Forms.Screen]::PrimaryScreen;
      $scaleX = 65535 / $screen.Bounds.Width;
      $scaleY = 65535 / $screen.Bounds.Height;

      Add-Type '
        using System;
        using System.Runtime.InteropServices;
        public class MouseDrag {
          [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, int dx, int dy, int dwData, IntPtr dwExtraInfo);
        }
      ';

      # Move to start
      [MouseDrag]::mouse_event(0x8000 -bor 0x0001, [int](${fromX} * $scaleX), [int](${fromY} * $scaleY), 0, [IntPtr]::Zero);
      Start-Sleep -Milliseconds 50;
      # Press down
      [MouseDrag]::mouse_event(0x0002, 0, 0, 0, [IntPtr]::Zero);
      Start-Sleep -Milliseconds 50;

      # Interpolate movement in steps for smooth drag
      $steps = 10;
      for ($i = 1; $i -le $steps; $i++) {
        $interpX = [int]((${fromX} + (${toX} - ${fromX}) * ($i / $steps)) * $scaleX);
        $interpY = [int]((${fromY} + (${toY} - ${fromY}) * ($i / $steps)) * $scaleY);
        [MouseDrag]::mouse_event(0x8000 -bor 0x0001, $interpX, $interpY, 0, [IntPtr]::Zero);
        Start-Sleep -Milliseconds 20;
      }

      # Release
      [MouseDrag]::mouse_event(0x0004, 0, 0, 0, [IntPtr]::Zero);
      Write-Output "OK";
    `;
    ps(script, 10000);
  }

  return { success: true, data: { dragged: { from: { x: fromX, y: fromY }, to: { x: toX, y: toY } } }, durationMs: 0 };
}

async function handleInputMouseScroll(args: Record<string, unknown>): Promise<ToolResult> {
  const x      = args.x as number;
  const y      = args.y as number;
  const ticks  = args.ticks as number; // positive = up, negative = down
  const direction = (args.direction as string) ?? 'vertical'; // vertical | horizontal

  if (nativeAddon) {
    nativeAddon.mouseScroll(x, y, ticks, direction);
  } else {
    // WHEEL_DELTA = 120; positive = scroll up
    const wheelAmount = ticks * 120;
    const script = `
      Add-Type -AssemblyName System.Windows.Forms;
      $screen = [System.Windows.Forms.Screen]::PrimaryScreen;
      $scaleX = 65535 / $screen.Bounds.Width;
      $scaleY = 65535 / $screen.Bounds.Height;

      Add-Type '
        using System;
        using System.Runtime.InteropServices;
        public class MouseScroll {
          [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, int dx, int dy, int dwData, IntPtr dwExtraInfo);
        }
      ';

      # Move mouse to position first
      [MouseScroll]::mouse_event(0x8000 -bor 0x0001, [int](${x} * $scaleX), [int](${y} * $scaleY), 0, [IntPtr]::Zero);
      Start-Sleep -Milliseconds 50;

      # MOUSEEVENTF_WHEEL = 0x0800
      [MouseScroll]::mouse_event(0x0800, 0, 0, ${wheelAmount}, [IntPtr]::Zero);
      Write-Output "OK";
    `;
    ps(script);
  }

  return { success: true, data: { scrolled: { x, y, ticks, direction } }, durationMs: 0 };
}

async function handleInputHotkey(args: Record<string, unknown>): Promise<ToolResult> {
  const combo = args.combo as string; // e.g. "Ctrl+C", "Alt+F4", "Ctrl+Shift+Esc"

  // Parse the combo string into key + modifiers
  const parts = combo.split('+').map(s => s.trim());
  const key = parts[parts.length - 1];
  const modifiers = parts.slice(0, -1);

  // Delegate to handleInputKey
  return handleInputKey({ key, modifiers });
}

async function handleInputMultiClick(args: Record<string, unknown>): Promise<ToolResult> {
  const clicks = args.clicks as Array<{ x: number; y: number; button?: string; clicks?: number }>;

  if (!clicks || !Array.isArray(clicks)) {
    throw new ExecutionError('input_handler', 'Clicks must be an array');
  }

  for (const click of clicks) {
    await handleInputMouseClick({
      x: click.x,
      y: click.y,
      button: click.button || 'left',
      clicks: click.clicks || 1
    });
    // Small delay between clicks
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  return { success: true, data: { multiClicked: clicks.length }, durationMs: 0 };
}

async function handleInputMultiType(args: Record<string, unknown>): Promise<ToolResult> {
  const types = args.types as Array<{ text: string; delayMs?: number }>;

  if (!types || !Array.isArray(types)) {
    throw new ExecutionError('input_handler', 'Types must be an array');
  }

  for (const type of types) {
    await handleInputType({
      text: type.text,
      delayMs: type.delayMs || 0
    });
  }

  return { success: true, data: { multiTyped: types.length }, durationMs: 0 };
}

async function handleInputScrapeUI(args: Record<string, unknown>): Promise<ToolResult> {
  const automationId = args.automationId as string;
  const name = args.name as string;
  const className = args.className as string;
  const rootHandle = args.rootHandle as number | undefined;

  const script = `
    Add-Type -AssemblyName UIAutomationClient;
    Add-Type -AssemblyName UIAutomationTypes;
    $root = ${rootHandle ? `[System.Windows.Automation.AutomationElement]::FromHandle(${rootHandle})` : '[System.Windows.Automation.AutomationElement]::RootElement'};
    $conditions = @();

    if ('${automationId}') {
      $conditions += [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::AutomationIdProperty, '${automationId}');
    }
    if ('${name}') {
      $conditions += [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty, '${name}');
    }
    if ('${className}') {
      $conditions += [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ClassNameProperty, '${className}');
    }

    $condition = $null;
    if ($conditions.Count -eq 1) {
      $condition = $conditions[0];
    } elseif ($conditions.Count -gt 1) {
      $condition = [System.Windows.Automation.AndCondition]::new($conditions);
    } else {
      $condition = [System.Windows.Automation.Condition]::TrueCondition;
    }

    $element = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $condition);
    if ($element) {
      $text = $element.GetCurrentPropertyValue([System.Windows.Automation.ValuePattern]::ValueProperty);
      if (-not $text) {
        $text = $element.Current.Name;
      }
      @{ text = $text; found = $true } | ConvertTo-Json;
    } else {
      @{ text = ''; found = $false } | ConvertTo-Json;
    }
  `;

  const raw = ps(script, 10000);
  let result: { text: string; found: boolean };
  try {
    result = JSON.parse(raw);
  } catch {
    result = { text: '', found: false };
  }

  return { success: true, data: result, durationMs: 0 };
}

// ---------------------------------------------------------------------------
// Module definition + registration
// ---------------------------------------------------------------------------

const inputHandler: ToolModule = {
  name: 'input_handler',

  tools: [
    {
      name: 'input.type',
      description: 'Type a string of characters into the currently focused window, as if typed on a keyboard.',
      parameters: {
        type: 'object',
        properties: {
          text:    { type: 'string', description: 'The text to type' },
          delayMs: { type: 'number', description: 'Optional delay in ms between each character (for apps that need it). Default: 0' }
        },
        required: ['text']
      }
    },
    {
      name: 'input.key',
      description: 'Press a key, optionally with modifier keys held down.',
      parameters: {
        type: 'object',
        properties: {
          key:       { type: 'string', description: 'Key name (e.g. "Enter", "Escape", "a", "F5", "ArrowDown")' },
          modifiers: { type: 'array',  description: 'Modifier keys to hold (Ctrl, Alt, Shift, Win)', items: { type: 'string', enum: ['Ctrl', 'Alt', 'Shift', 'Win'] } }
        },
        required: ['key']
      }
    },
    {
      name: 'input.mouse_click',
      description: 'Click the mouse at absolute screen coordinates.',
      parameters: {
        type: 'object',
        properties: {
          x:      { type: 'number', description: 'X coordinate in pixels' },
          y:      { type: 'number', description: 'Y coordinate in pixels' },
          button: { type: 'string', description: 'Mouse button to click', enum: ['left', 'right', 'middle'], default: 'left' },
          clicks: { type: 'number', description: 'Number of clicks (e.g. 2 for double-click). Default: 1' }
        },
        required: ['x', 'y']
      }
    },
    {
      name: 'input.mouse_drag',
      description: 'Drag from one point to another using a smooth interpolated motion.',
      parameters: {
        type: 'object',
        properties: {
          fromX: { type: 'number', description: 'Starting X coordinate' },
          fromY: { type: 'number', description: 'Starting Y coordinate' },
          toX:   { type: 'number', description: 'Ending X coordinate' },
          toY:   { type: 'number', description: 'Ending Y coordinate' }
        },
        required: ['fromX', 'fromY', 'toX', 'toY']
      }
    },
    {
      name: 'input.mouse_scroll',
      description: 'Scroll the mouse wheel at a given position. Positive ticks = scroll up, negative = scroll down.',
      parameters: {
        type: 'object',
        properties: {
          x:         { type: 'number', description: 'X coordinate to scroll at' },
          y:         { type: 'number', description: 'Y coordinate to scroll at' },
          ticks:     { type: 'number', description: 'Number of scroll ticks (positive=up, negative=down)' },
          direction: { type: 'string', description: 'Scroll axis', enum: ['vertical', 'horizontal'], default: 'vertical' }
        },
        required: ['x', 'y', 'ticks']
      }
    },
    {
      name: 'input.hotkey',
      description: 'Fire a keyboard shortcut combo (e.g. "Ctrl+C", "Alt+F4", "Ctrl+Shift+Esc").',
      parameters: {
        type: 'object',
        properties: {
          combo: { type: 'string', description: 'The hotkey combo in "Modifier+Key" format (e.g. "Ctrl+C")' }
        },
        required: ['combo']
      }
    },
    {
      name: 'input.multi_click',
      description: 'Perform multiple mouse clicks at different positions.',
      parameters: {
        type: 'object',
        properties: {
          clicks: {
            type: 'array',
            description: 'Array of click objects',
            items: {
              type: 'object',
              properties: {
                x:      { type: 'number', description: 'X coordinate' },
                y:      { type: 'number', description: 'Y coordinate' },
                button: { type: 'string', description: 'Mouse button', enum: ['left', 'right', 'middle'], default: 'left' },
                clicks: { type: 'number', description: 'Number of clicks', default: 1 }
              },
              required: ['x', 'y']
            }
          }
        },
        required: ['clicks']
      }
    },
    {
      name: 'input.multi_type',
      description: 'Type multiple text strings sequentially.',
      parameters: {
        type: 'object',
        properties: {
          types: {
            type: 'array',
            description: 'Array of type objects',
            items: {
              type: 'object',
              properties: {
                text:    { type: 'string', description: 'Text to type' },
                delayMs: { type: 'number', description: 'Delay between characters in ms', default: 0 }
              },
              required: ['text']
            }
          }
        },
        required: ['types']
      }
    },
    {
      name: 'input.scrape_ui',
      description: 'Scrape text content from a UI element using UIA.',
      parameters: {
        type: 'object',
        properties: {
          automationId: { type: 'string', description: 'Automation ID of the element' },
          name:         { type: 'string', description: 'Name of the element' },
          className:    { type: 'string', description: 'Class name of the element' },
          rootHandle:   { type: 'number', description: 'Window handle to search from (optional)' }
        }
      }
    }
  ],

  async execute(toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
    log.debug({ toolName, args }, 'Executing');

    switch (toolName) {
      case 'input.type':         return handleInputType(args);
      case 'input.key':          return handleInputKey(args);
      case 'input.mouse_click':  return handleInputMouseClick(args);
      case 'input.mouse_drag':   return handleInputMouseDrag(args);
      case 'input.mouse_scroll': return handleInputMouseScroll(args);
      case 'input.hotkey':       return handleInputHotkey(args);
      case 'input.multi_click':  return handleInputMultiClick(args);
      case 'input.multi_type':   return handleInputMultiType(args);
      case 'input.scrape_ui':    return handleInputScrapeUI(args);
      default:
        throw new ExecutionError('input_handler', `Unknown tool: ${toolName}`);
    }
  }
};

registry.register(inputHandler);
export default inputHandler;
