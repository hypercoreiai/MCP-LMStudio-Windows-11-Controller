/**
 * tools/system_info.ts
 * 
 * Read-only system information queries. Nothing here modifies state.
 * Safe to call frequently for monitoring or decision-making.
 * All data comes from WMI / PowerShell CIM queries.
 */

import { execSync } from 'child_process';
import { ToolModule, ToolResult } from '../core/types';
import { registry } from '../core/registry';
import { ExecutionError } from '../core/errors';
import { scopedLogger } from '../core/logger';

const log = scopedLogger('tools/system_info');

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
    throw new ExecutionError('system_info', e.stderr?.toString() || e.message);
  }
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function handleSystemInfo(_args: Record<string, unknown>): Promise<ToolResult> {
  const script = `
    $os = Get-CimInstance -ClassName Win32_OperatingSystem;
    $cs = Get-CimInstance -ClassName Win32_ComputerSystem;
    $uptime = New-TimeSpan -Start $os.LastBootUpTime -End (Get-Date);
    [PSCustomObject]@{
      osCaption      = $os.Caption;
      osVersion      = $os.Version;
      osBuildNumber  = $os.BuildNumber;
      hostname       = $cs.Name;
      domain         = $cs.Domain;
      manufacturer   = $cs.Manufacturer;
      model          = $cs.Model;
      uptimeDays     = $uptime.Days;
      uptimeHours    = $uptime.Hours;
      uptimeMinutes  = $uptime.Minutes;
      locale         = (Get-WinSystemLocale).Name;
      timeZone       = (Get-TimeZone).StandardName;
      lastBootUp     = $os.LastBootUpTime.ToString('o');
      installDate    = $os.InstallDate.ToString('o');
      systemRoot     = $os.SystemRoot
    } | ConvertTo-Json -Depth 2;
  `;

  try {
    const raw = ps(script);
    if (!raw || raw.trim() === '') {
      throw new ExecutionError('system_info', 'PowerShell returned empty output');
    }
    return { success: true, data: JSON.parse(raw), durationMs: 0 };
  } catch (e) {
    if (e instanceof ExecutionError) throw e;
    throw new ExecutionError('system_info', `Failed to parse system info: ${(e as Error).message}`);
  }
}

async function handleSystemCpu(_args: Record<string, unknown>): Promise<ToolResult> {
  const script = `
    $cpus = Get-CimInstance -ClassName Win32_Processor;
    $perf = Get-CimInstance -ClassName Win32_PerfFormattedData_PerfOS_Processor;

    $results = @();
    foreach ($cpu in $cpus) {
      $results += [PSCustomObject]@{
        name          = $cpu.Name;
        coreCount     = $cpu.NumberOfCores;
        logicalCount  = $cpu.NumberOfLogicalProcessors;
        speedMHz      = $cpu.MaxClockSpeed;
        architecture  = $cpu.ProcessorArchitecture;
        status        = $cpu.Status
      }
    }

    # Overall CPU usage
    $totalUsage = ($perf | Where-Object { $_.Name -eq '_Total' } | Select-Object -ExpandProperty PercentProcessorTime);

    # Per-core usage (first 16 cores max to keep output manageable)
    $perCore = @();
    $cores = $perf | Where-Object { $_.Name -ne '_Total' } | Select-Object -First 16;
    foreach ($core in $cores) {
      $perCore += [PSCustomObject]@{ core = $core.Name; usagePct = $core.PercentProcessorTime }
    }

    [PSCustomObject]@{
      processors  = $results;
      totalUsagePct = $totalUsage;
      perCore     = $perCore
    } | ConvertTo-Json -Depth 4;
  `;

  try {
    const raw = ps(script);
    if (!raw || raw.trim() === '') {
      throw new ExecutionError('system_info', 'PowerShell returned empty output for CPU info');
    }
    return { success: true, data: JSON.parse(raw), durationMs: 0 };
  } catch (e) {
    if (e instanceof ExecutionError) throw e;
    throw new ExecutionError('system_info', `Failed to parse CPU info: ${(e as Error).message}`);
  }
}

async function handleSystemMemory(_args: Record<string, unknown>): Promise<ToolResult> {
  const script = `
    $os = Get-CimInstance -ClassName Win32_OperatingSystem;
    $totalGB = [math]::Round($os.TotalVisibleMemorySize / 1MB, 2);
    $freeGB  = [math]::Round($os.FreePhysicalMemory / 1MB, 2);
    $usedGB  = [math]::Round($totalGB - $freeGB, 2);
    $usedPct = [math]::Round(($usedGB / $totalGB) * 100, 1);

    # Page file info
    $pf = Get-CimInstance -ClassName Win32_PageFileSetting;

    [PSCustomObject]@{
      totalGB  = $totalGB;
      usedGB   = $usedGB;
      freeGB   = $freeGB;
      usedPct  = $usedPct;
      pageFiles = @($pf | ForEach-Object { [PSCustomObject]@{ name = $_.Name; initialSizeMB = $_.InitialSize; maxSizeMB = $_.MaximumSize } })
    } | ConvertTo-Json -Depth 3;
  `;

  try {
    const raw = ps(script);
    if (!raw || raw.trim() === '') {
      throw new ExecutionError('system_info', 'PowerShell returned empty output for memory info');
    }
    return { success: true, data: JSON.parse(raw), durationMs: 0 };
  } catch (e) {
    if (e instanceof ExecutionError) throw e;
    throw new ExecutionError('system_info', `Failed to parse memory info: ${(e as Error).message}`);
  }
}

async function handleSystemDisk(_args: Record<string, unknown>): Promise<ToolResult> {
  const script = `
    Get-CimInstance -ClassName Win32_LogicalDisk -Filter "DriveType = 3" | ForEach-Object {
      $totalGB = [math]::Round($_.Size / 1GB, 2);
      $freeGB  = [math]::Round($_.FreeSpace / 1GB, 2);
      $usedGB  = [math]::Round($totalGB - $freeGB, 2);
      $usedPct = if ($totalGB -gt 0) { [math]::Round(($usedGB / $totalGB) * 100, 1) } else { 0 };

      [PSCustomObject]@{
        driveLetter = $_.DeviceID;
        volumeName  = $_.VolumeName;
        fileSystem  = $_.FileSystem;
        totalGB     = $totalGB;
        usedGB      = $usedGB;
        freeGB      = $freeGB;
        usedPct     = $usedPct
      }
    } | ConvertTo-Json -Depth 2;
  `;

  const raw = ps(script);
  let disks: unknown[];
  try {
    const parsed = JSON.parse(raw || '[]');
    disks = Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    disks = [];
  }

  return { success: true, data: { disks }, durationMs: 0 };
}

async function handleSystemNetwork(_args: Record<string, unknown>): Promise<ToolResult> {
  const script = `
    $adapters = Get-CimInstance -ClassName Win32_NetworkAdapterConfiguration -Filter "IPEnabled = True";
    $results = @();
    foreach ($a in $adapters) {
      $results += [PSCustomObject]@{
        index         = $a.Index;
        description   = $a.Description;
        macAddress    = $a.MACAddress;
        ipAddresses   = @($a.IPAddress);
        ipGateways    = @($a.IPGateway);
        dnsServers    = @($a.DNSServerSearchOrder);
        dhcpEnabled   = $a.DHCPEnabled
      }
    }

    # Quick connectivity check
    $ping = Test-Connection -ComputerName 8.8.8.8 -Count 1 -Quiet -ErrorAction SilentlyContinue;

    [PSCustomObject]@{
      adapters        = $results;
      internetReachable = $ping
    } | ConvertTo-Json -Depth 4;
  `;

  const raw = ps(script, 15000);
  if (!raw || raw.trim() === '') {
    throw new ExecutionError('system_info', 'PowerShell returned empty output for network info');
  }
  try {
    return { success: true, data: JSON.parse(raw), durationMs: 0 };
  } catch (e) {
    throw new ExecutionError('system_info', `Failed to parse network info: ${(e as Error).message}`);
  }
}

async function handleSystemBattery(_args: Record<string, unknown>): Promise<ToolResult> {
  const script = `
    $battery = Get-CimInstance -ClassName Win32_Battery -ErrorAction SilentlyContinue;
    if ($null -eq $battery) {
      Write-Output '{ "available": false, "message": "No battery detected (likely a desktop)" }';
    } else {
      [PSCustomObject]@{
        available    = $true;
        chargeLevel  = $battery.EstimatedChargeRemaining;
        status       = switch ($battery.BatteryStatus) {
                         { $_ -eq 1 }  { "Discharging" }
                         { $_ -eq 2 }  { "Charging" }
                         { $_ -eq 5 }  { "Fully Charged" }
                         default       { "Unknown ($battery.BatteryStatus)" }
                       };
        chemistry    = $battery.Chemistry;
        designCapacity = $battery.DesignCapacity;
        fullChargeCapacity = $battery.FullChargeCapacity
      } | ConvertTo-Json -Depth 2;
    }
  `;

  try {
    const raw = ps(script);
    if (!raw || raw.trim() === '') {
      throw new ExecutionError('system_info', 'PowerShell returned empty output for battery info');
    }
    return { success: true, data: JSON.parse(raw), durationMs: 0 };
  } catch (e) {
    if (e instanceof ExecutionError) throw e;
    throw new ExecutionError('system_info', `Failed to parse battery info: ${(e as Error).message}`);
  }
}

async function handleSystemServices(args: Record<string, unknown>): Promise<ToolResult> {
  const filter = args.filter as string | undefined; // 'running' | 'stopped' | 'all'
  const namePattern = args.namePattern as string | undefined; // wildcard pattern like "Win*"

  let whereClause = '';
  if (filter === 'running') whereClause += ' | Where-Object { $_.State -eq "Running" }';
  else if (filter === 'stopped') whereClause += ' | Where-Object { $_.State -eq "Stopped" }';

  let nameClause = '';
  if (namePattern) nameClause = `-Name "${namePattern}"`;

  const script = `
    Get-Service ${nameClause} -ErrorAction SilentlyContinue ${whereClause} |
    Select-Object -First 100 |
    ForEach-Object {
      [PSCustomObject]@{
        name        = $_.Name;
        displayName = $_.DisplayName;
        state       = $_.Status.ToString();
        startType   = $_.StartType.ToString()
      }
    } | ConvertTo-Json -Depth 2;
  `;

  const raw = ps(script);
  let services: unknown[];
  try {
    const parsed = JSON.parse(raw || '[]');
    services = Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    services = [];
  }

  return { success: true, data: { services, count: services.length }, durationMs: 0 };
}

// ---------------------------------------------------------------------------
// Module definition + registration
// ---------------------------------------------------------------------------

const systemInfo: ToolModule = {
  name: 'system_info',

  tools: [
    {
      name: 'system.info',
      description: 'Get general system information: OS version, hostname, uptime, locale, timezone, manufacturer, and model.',
      parameters: { type: 'object', properties: {}, required: [] }
    },
    {
      name: 'system.cpu',
      description: 'Get CPU information including model, core/thread counts, clock speed, and live usage percentages (overall and per-core).',
      parameters: { type: 'object', properties: {}, required: [] }
    },
    {
      name: 'system.memory',
      description: 'Get RAM usage: total, used, free (all in GB), usage percentage, and page file configuration.',
      parameters: { type: 'object', properties: {}, required: [] }
    },
    {
      name: 'system.disk',
      description: 'Get disk usage for all local fixed drives: total, used, free space and usage percentages.',
      parameters: { type: 'object', properties: {}, required: [] }
    },
    {
      name: 'system.network',
      description: 'Get network adapter information (IP, MAC, gateways, DNS) for all enabled adapters, plus an internet connectivity check.',
      parameters: { type: 'object', properties: {}, required: [] }
    },
    {
      name: 'system.battery',
      description: 'Get battery status and charge level. Returns a message indicating unavailability if no battery is detected (desktops).',
      parameters: { type: 'object', properties: {}, required: [] }
    },
    {
      name: 'system.services',
      description: 'List Windows services. Optionally filter by state or name pattern.',
      parameters: {
        type: 'object',
        properties: {
          filter:      { type: 'string', description: 'Filter by service state', enum: ['running', 'stopped', 'all'], default: 'all' },
          namePattern: { type: 'string', description: 'Wildcard pattern to filter service names (e.g. "Win*")' }
        }
      }
    }
  ],

  async execute(toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
    log.debug({ toolName }, 'Executing');

    switch (toolName) {
      case 'system.info':     return handleSystemInfo(args);
      case 'system.cpu':      return handleSystemCpu(args);
      case 'system.memory':   return handleSystemMemory(args);
      case 'system.disk':     return handleSystemDisk(args);
      case 'system.network':  return handleSystemNetwork(args);
      case 'system.battery':  return handleSystemBattery(args);
      case 'system.services': return handleSystemServices(args);
      default:
        throw new ExecutionError('system_info', `Unknown tool: ${toolName}`);
    }
  }
};

registry.register(systemInfo);
export default systemInfo;
