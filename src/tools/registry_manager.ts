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

import { execSync } from 'child_process';
import { ToolModule, ToolResult } from '../core/types';
import { registry } from '../core/registry';
import { ExecutionError } from '../core/errors';
import { scopedLogger } from '../core/logger';

const log = scopedLogger('tools/registry_manager');

// ---------------------------------------------------------------------------
// PowerShell helper
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
    throw new ExecutionError('registry_manager', e.stderr?.toString() || e.message);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Detect if a path targets HKLM (requires elevation). */
function requiresElevation(keyPath: string): boolean {
  const upper = keyPath.toUpperCase();
  return upper.startsWith('HKEY_LOCAL_MACHINE') ||
         upper.startsWith('HKLM');
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function handleRegistryRead(args: Record<string, unknown>): Promise<ToolResult> {
  const keyPath  = args.keyPath as string;
  const valueName = args.valueName as string | undefined;

  let script: string;

  if (valueName) {
    // Read a specific value
    script = `
      $val = Get-ItemProperty -Path "${keyPath}" -Name "${valueName}" -ErrorAction Stop;
      [PSCustomObject]@{
        keyPath   = "${keyPath}";
        valueName = "${valueName}";
        value     = $val."${valueName}";
        type      = ($val | Get-Member -Name "${valueName}" | Select-Object -ExpandProperty Definition) -replace '.*; ',''
      } | ConvertTo-Json -Depth 3;
    `;
  } else {
    // Read all values under the key
    script = `
      $key = Get-Item -Path "${keyPath}" -ErrorAction Stop;
      $values = @();
      foreach ($name in $key.GetValueNames()) {
        $values += [PSCustomObject]@{
          name  = $name;
          value = $key.GetValue($name);
          type  = $key.GetValueKind($name).ToString()
        }
      }
      [PSCustomObject]@{
        keyPath = "${keyPath}";
        values  = $values;
        subKeys = @($key.GetSubKeyNames())
      } | ConvertTo-Json -Depth 4;
    `;
  }

  const raw = ps(script);
  let data: unknown;
  try { data = JSON.parse(raw); } catch { data = { raw } }

  return { success: true, data, durationMs: 0 };
}

async function handleRegistryWrite(args: Record<string, unknown>): Promise<ToolResult> {
  const keyPath   = args.keyPath as string;
  const valueName = args.valueName as string;
  const value     = args.value;
  const valueType = (args.valueType as string) ?? 'String'; // String | DWord | QWord | ExpandString | MultiString | Binary

  // Log elevation requirement (the TSD applier enforces it; this is informational)
  if (requiresElevation(keyPath)) {
    log.debug({ keyPath }, 'HKLM path detected — elevation required');
  }

  // Serialize the value appropriately for PowerShell
  let psValue: string;
  switch (valueType) {
    case 'DWord':
    case 'QWord':
      psValue = String(value);
      break;
    case 'MultiString':
      // Expect an array
      psValue = `@(${(value as string[]).map(s => `"${s}"`).join(', ')})`;
      break;
    case 'Binary':
      // Expect a base64 string; decode to byte array
      psValue = `[Convert]::FromBase64String("${value}")`;
      break;
    default:
      psValue = `"${String(value).replace(/"/g, '`"')}"`;
  }

  const script = `
    # Ensure the key exists
    if (-not (Test-Path "${keyPath}")) {
      New-Item -Path "${keyPath}" -Force | Out-Null;
    }
    Set-ItemProperty -Path "${keyPath}" -Name "${valueName}" -Value ${psValue} -Type ${valueType} -ErrorAction Stop;
    Write-Output "OK";
  `;

  ps(script);
  return {
    success: true,
    data: { written: { keyPath, valueName, valueType }, requiresElevation: requiresElevation(keyPath) },
    durationMs: 0
  };
}

async function handleRegistryDelete(args: Record<string, unknown>): Promise<ToolResult> {
  const keyPath   = args.keyPath as string;
  const valueName = args.valueName as string | undefined;
  const recursive = (args.recursive as boolean) ?? false;

  if (requiresElevation(keyPath)) {
    log.debug({ keyPath }, 'HKLM path detected — elevation required');
  }

  let script: string;

  if (valueName) {
    // Delete a specific value
    script = `
      Remove-ItemProperty -Path "${keyPath}" -Name "${valueName}" -ErrorAction Stop;
      Write-Output "OK";
    `;
  } else {
    // Delete the entire key (and optionally all subkeys)
    const recurseFlag = recursive ? '-Recurse' : '';
    script = `
      Remove-Item -Path "${keyPath}" ${recurseFlag} -ErrorAction Stop;
      Write-Output "OK";
    `;
  }

  ps(script);
  return {
    success: true,
    data: { deleted: { keyPath, valueName: valueName ?? '(entire key)', recursive } },
    durationMs: 0
  };
}

async function handleRegistryList(args: Record<string, unknown>): Promise<ToolResult> {
  const keyPath = args.keyPath as string;

  const script = `
    $key = Get-Item -Path "${keyPath}" -ErrorAction Stop;
    [PSCustomObject]@{
      keyPath = "${keyPath}";
      subKeys = @($key.GetSubKeyNames());
      values  = @($key.GetValueNames() | ForEach-Object {
        [PSCustomObject]@{
          name = $_;
          type = $key.GetValueKind($_).ToString()
        }
      })
    } | ConvertTo-Json -Depth 3;
  `;

  const raw = ps(script);
  let data: unknown;
  try { data = JSON.parse(raw); } catch { data = { raw } }

  return { success: true, data, durationMs: 0 };
}

async function handleRegistryExport(args: Record<string, unknown>): Promise<ToolResult> {
  const keyPath  = args.keyPath as string;
  const filePath = args.filePath as string;

  const script = `
    reg export "${keyPath}" "${filePath}" /y 2>&1;
    if ($LASTEXITCODE -eq 0) { Write-Output "exported" } else { Write-Output "failed" }
  `;

  const result = ps(script);
  const success = result.includes('exported');

  return {
    success,
    data: { exported: { keyPath, filePath } },
    error: success ? undefined : { code: 'EXPORT_FAILED', message: `reg export failed for ${keyPath}` },
    durationMs: 0
  };
}

// ---------------------------------------------------------------------------
// Module definition + registration
// ---------------------------------------------------------------------------

const registryManager: ToolModule = {
  name: 'registry_manager',

  tools: [
    {
      name: 'registry.read',
      description: 'Read a registry key or a specific value. If valueName is omitted, returns all values and subkey names under the key.',
      parameters: {
        type: 'object',
        properties: {
          keyPath:   { type: 'string', description: 'Full registry path (e.g. "HKCU:\\Software\\MyApp")' },
          valueName: { type: 'string', description: 'Specific value name to read. Omit to read all values.' }
        },
        required: ['keyPath']
      }
    },
    {
      name: 'registry.write',
      description: 'Create or update a registry value. The key is created if it does not exist. HKLM paths require elevation.',
      parameters: {
        type: 'object',
        properties: {
          keyPath:   { type: 'string', description: 'Registry key path' },
          valueName: { type: 'string', description: 'Value name to set' },
          value:     { type: 'string', description: 'The value to write (string, number, or array depending on type)' },
          valueType: { type: 'string', description: 'Registry value type', enum: ['String', 'DWord', 'QWord', 'ExpandString', 'MultiString', 'Binary'], default: 'String' }
        },
        required: ['keyPath', 'valueName', 'value']
      }
    },
    {
      name: 'registry.delete',
      description: 'Delete a registry value or an entire key. Set recursive=true to delete a key and all its subkeys.',
      parameters: {
        type: 'object',
        properties: {
          keyPath:   { type: 'string', description: 'Registry key path' },
          valueName: { type: 'string', description: 'Value to delete. Omit to delete the entire key.' },
          recursive: { type: 'boolean', description: 'Delete subkeys recursively when deleting a key. Default: false' }
        },
        required: ['keyPath']
      }
    },
    {
      name: 'registry.list',
      description: 'List all subkeys and value names under a registry key.',
      parameters: {
        type: 'object',
        properties: {
          keyPath: { type: 'string', description: 'Registry key path to list' }
        },
        required: ['keyPath']
      }
    },
    {
      name: 'registry.export',
      description: 'Export a registry key tree to a .reg file.',
      parameters: {
        type: 'object',
        properties: {
          keyPath:  { type: 'string', description: 'Registry key to export' },
          filePath: { type: 'string', description: 'Destination .reg file path' }
        },
        required: ['keyPath', 'filePath']
      }
    }
  ],

  async execute(toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
    log.debug({ toolName, args }, 'Executing');

    switch (toolName) {
      case 'registry.read':   return handleRegistryRead(args);
      case 'registry.write':  return handleRegistryWrite(args);
      case 'registry.delete': return handleRegistryDelete(args);
      case 'registry.list':   return handleRegistryList(args);
      case 'registry.export': return handleRegistryExport(args);
      default:
        throw new ExecutionError('registry_manager', `Unknown tool: ${toolName}`);
    }
  }
};

registry.register(registryManager);
export default registryManager;
