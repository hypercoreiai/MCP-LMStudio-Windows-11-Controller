/**
 * tools/clipboard_manager.ts
 * 
 * Read and write the Windows system clipboard.
 * Supports text, images (returned as base64 PNG), and file lists.
 * Uses PowerShell + System.Windows.Clipboard for all operations.
 */

import { execSync } from 'child_process';
import { ToolModule, ToolResult } from '../core/types';
import { registry } from '../core/registry';
import { ExecutionError } from '../core/errors';
import { scopedLogger } from '../core/logger';

const log = scopedLogger('tools/clipboard_manager');

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
    throw new ExecutionError('clipboard_manager', e.stderr?.toString() || e.message);
  }
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function handleClipboardGet(args: Record<string, unknown>): Promise<ToolResult> {
  // Detect what's on the clipboard and return it in the appropriate format
  const script = `
    Add-Type -AssemblyName System.Windows.Forms;
    $clip = [System.Windows.Forms.Clipboard]::GetData([System.Windows.Forms.DataFormats]::Text);
    $hasImage = [System.Windows.Forms.Clipboard]::ContainsImage();
    $hasFiles = [System.Windows.Forms.Clipboard]::ContainsFileDropList();

    $result = @{ hasText = ($null -ne $clip); hasImage = $hasImage; hasFiles = $hasFiles };

    if ($null -ne $clip) {
      $result.text = $clip;
    }

    if ($hasFiles) {
      $files = [System.Windows.Forms.Clipboard]::GetFileDropList();
      $result.files = @($files | ForEach-Object { $_.ToString() });
    }

    if ($hasImage) {
      $img = [System.Windows.Forms.Clipboard]::GetImage();
      $ms = New-Object System.IO.MemoryStream;
      $img.Save($ms, 'PNG');
      $img.Dispose();
      $result.imageBase64 = [Convert]::ToBase64String($ms.ToArray());
      $ms.Dispose();
    }

    $result | ConvertTo-Json -Depth 3;
  `;

  const raw = ps(script);
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(raw);
  } catch {
    data = { text: raw };
  }

  return { success: true, data, durationMs: 0 };
}

async function handleClipboardSet(args: Record<string, unknown>): Promise<ToolResult> {
  const text  = args.text as string | undefined;
  const image = args.imageBase64 as string | undefined;

  if (text !== undefined) {
    // Set text
    const escaped = text.replace(/`/g, '``').replace(/"/g, '`"').replace(/\$/g, '`$');
    const script = `
      Add-Type -AssemblyName System.Windows.Forms;
      [System.Windows.Forms.Clipboard]::SetText("${escaped}");
      Write-Output "OK";
    `;
    ps(script);
    return { success: true, data: { set: 'text', length: text.length }, durationMs: 0 };
  }

  if (image !== undefined) {
    // Set image from base64
    const script = `
      Add-Type -AssemblyName System.Windows.Forms;
      $bytes = [Convert]::FromBase64String("${image}");
      $ms = New-Object System.IO.MemoryStream($bytes);
      $img = [System.Drawing.Image]::FromStream($ms);
      [System.Windows.Forms.Clipboard]::SetImage($img);
      $img.Dispose();
      $ms.Dispose();
      Write-Output "OK";
    `;
    ps(script);
    return { success: true, data: { set: 'image' }, durationMs: 0 };
  }

  throw new ExecutionError('clipboard_manager', 'Either "text" or "imageBase64" must be provided');
}

async function handleClipboardClear(_args: Record<string, unknown>): Promise<ToolResult> {
  const script = `
    Add-Type -AssemblyName System.Windows.Forms;
    [System.Windows.Forms.Clipboard]::Clear();
    Write-Output "OK";
  `;
  ps(script);
  return { success: true, data: { cleared: true }, durationMs: 0 };
}

// ---------------------------------------------------------------------------
// Module definition + registration
// ---------------------------------------------------------------------------

const clipboardManager: ToolModule = {
  name: 'clipboard_manager',

  tools: [
    {
      name: 'clipboard.get',
      description: 'Read the current clipboard contents. Returns text, a base64-encoded image, and/or a list of file paths depending on what is on the clipboard.',
      parameters: { type: 'object', properties: {}, required: [] }
    },
    {
      name: 'clipboard.set',
      description: 'Write content to the clipboard. Provide either text or a base64-encoded PNG image.',
      parameters: {
        type: 'object',
        properties: {
          text:        { type: 'string', description: 'Text to put on the clipboard' },
          imageBase64: { type: 'string', description: 'Base64-encoded PNG image to put on the clipboard' }
        }
        // At least one of text or imageBase64 is required (enforced in handler)
      }
    },
    {
      name: 'clipboard.clear',
      description: 'Clear the clipboard.',
      parameters: { type: 'object', properties: {}, required: [] }
    }
  ],

  async execute(toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
    log.debug({ toolName, args }, 'Executing');

    switch (toolName) {
      case 'clipboard.get':   return handleClipboardGet(args);
      case 'clipboard.set':   return handleClipboardSet(args);
      case 'clipboard.clear': return handleClipboardClear(args);
      default:
        throw new ExecutionError('clipboard_manager', `Unknown tool: ${toolName}`);
    }
  }
};

registry.register(clipboardManager);
export default clipboardManager;
