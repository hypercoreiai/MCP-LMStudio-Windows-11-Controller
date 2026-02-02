"use strict";
/**
 * tools/scheduled_tasks.ts
 *
 * Manage the Windows Task Scheduler via the schtasks CLI utility.
 * All commands are executed through PowerShell for consistent error handling
 * and JSON output.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const child_process_1 = require("child_process");
const registry_1 = require("../core/registry");
const errors_1 = require("../core/errors");
const logger_1 = require("../core/logger");
const log = (0, logger_1.scopedLogger)('tools/scheduled_tasks');
// ---------------------------------------------------------------------------
// PowerShell helper
// ---------------------------------------------------------------------------
function ps(script, timeoutMs = 15000) {
    try {
        // Encode script as Base64 UTF-16LE for PowerShell -EncodedCommand
        const buffer = Buffer.from(script, 'utf16le');
        const encoded = buffer.toString('base64');
        return (0, child_process_1.execSync)(`powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${encoded}`, { encoding: 'utf-8', timeout: timeoutMs, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    }
    catch (e) {
        throw new errors_1.ExecutionError('scheduled_tasks', e.stderr?.toString() || e.message);
    }
}
// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------
async function handleTaskList(args) {
    const folder = args.folder ?? '\\'; // root folder by default
    const script = `
    $tasks = Get-ScheduledTask -TaskPath "${folder}" -ErrorAction SilentlyContinue;
    $results = @();
    foreach ($task in $tasks) {
      $info = Get-ScheduledTaskInfo -TaskName $task.TaskName -TaskPath $task.TaskPath -ErrorAction SilentlyContinue;
      $results += [PSCustomObject]@{
        TaskName     = $task.TaskName;
        TaskPath     = $task.TaskPath;
        State        = $task.State.ToString();
        Description  = $task.Description;
        Author       = $task.Principal.UserId;
        LastRunTime  = if ($info) { $info.LastRunTime.ToString('o') } else { $null };
        NextRunTime  = if ($info) { $info.NextRunTime.ToString('o') } else { $null };
        LastExitCode = if ($info) { $info.LastExitCode } else { $null };
        Actions      = @($task.Actions | ForEach-Object {
          if ($_.ActionType -eq 'Execute') {
            [PSCustomObject]@{ Type = 'Execute'; Execute = $_.Execute; Argument = $_.Argument; WorkingDirectory = $_.WorkingDirectory }
          } else {
            [PSCustomObject]@{ Type = $_.ActionType.ToString() }
          }
        })
      }
    }
    $results | ConvertTo-Json -Depth 5;
  `;
    const raw = ps(script);
    let tasks;
    try {
        const parsed = JSON.parse(raw || '[]');
        tasks = Array.isArray(parsed) ? parsed : [parsed];
    }
    catch {
        tasks = [];
    }
    return { success: true, data: { tasks, folder }, durationMs: 0 };
}
async function handleTaskCreate(args) {
    const taskName = args.taskName;
    const taskPath = args.taskPath ?? '\\';
    const executable = args.executable;
    const taskArgs = args.arguments ?? '';
    const triggerType = args.triggerType; // 'schedule' | 'atLogon' | 'atStartup' | 'onEvent'
    const schedule = args.schedule; // cron-like or specific time for 'schedule'
    const user = args.user ?? 'SYSTEM';
    const runLevel = args.runLevel ?? 'LeastPrivilege'; // LeastPrivilege | HighestPrivilege
    const description = args.description ?? '';
    // Build trigger based on type
    let triggerScript;
    switch (triggerType) {
        case 'atLogon':
            triggerScript = `$trigger = New-ScheduledTaskTrigger -AtLogon -User "${user}";`;
            break;
        case 'atStartup':
            triggerScript = `$trigger = New-ScheduledTaskTrigger -AtStartup;`;
            break;
        case 'schedule':
            if (!schedule)
                throw new errors_1.ExecutionError('scheduled_tasks', 'schedule is required when triggerType is "schedule"');
            // Parse simple schedule formats:
            //   "daily HH:MM"     → daily at time
            //   "weekly DayName HH:MM" → weekly on day at time
            //   "once YYYY-MM-DD HH:MM" → one-shot
            const parts = schedule.split(' ');
            if (parts[0] === 'daily') {
                triggerScript = `$trigger = New-ScheduledTaskTrigger -Daily -At "${parts[1]}";`;
            }
            else if (parts[0] === 'weekly') {
                triggerScript = `$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek ${parts[1]} -At "${parts[2]}";`;
            }
            else if (parts[0] === 'once') {
                triggerScript = `$trigger = New-ScheduledTaskTrigger -Once -At "${parts[1]} ${parts[2]}";`;
            }
            else {
                throw new errors_1.ExecutionError('scheduled_tasks', `Unsupported schedule format: "${schedule}". Use: "daily HH:MM", "weekly DayName HH:MM", or "once YYYY-MM-DD HH:MM"`);
            }
            break;
        case 'onEvent':
            // args should include eventLogName and eventId
            const logName = args.eventLogName ?? 'System';
            const eventId = args.eventId;
            triggerScript = `$trigger = New-ScheduledTaskTrigger -CimClassName Win32_EventFilter -FilterQuery "SELECT * FROM __InstanceCreationEvent WITHIN 5 WHERE TargetInstance ISA 'Win32_LoggedEvent' AND TargetInstance.EventID = ${eventId} AND TargetInstance.LogName = '${logName}'";`;
            break;
        default:
            throw new errors_1.ExecutionError('scheduled_tasks', `Unknown triggerType: "${triggerType}". Use: schedule, atLogon, atStartup, onEvent`);
    }
    const script = `
    ${triggerScript}

    $action = New-ScheduledTaskAction -Execute "${executable}" -Argument "${taskArgs}";
    $principal = New-ScheduledTaskPrincipal -UserId "${user}" -RunLevel ${runLevel};
    $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Hours 1);

    Register-ScheduledTask -TaskName "${taskName}" -TaskPath "${taskPath}" -Trigger $trigger -Action $action -Principal $principal -Settings $settings -Description "${description}" -Force;

    Write-Output "OK";
  `;
    ps(script);
    return {
        success: true,
        data: {
            created: { taskName, taskPath, executable, triggerType, schedule: schedule ?? null, user, runLevel }
        },
        durationMs: 0
    };
}
async function handleTaskDelete(args) {
    const taskName = args.taskName;
    const taskPath = args.taskPath ?? '\\';
    const script = `
    Unregister-ScheduledTask -TaskName "${taskName}" -TaskPath "${taskPath}" -Confirm:$false -ErrorAction Stop;
    Write-Output "OK";
  `;
    ps(script);
    return { success: true, data: { deleted: { taskName, taskPath } }, durationMs: 0 };
}
async function handleTaskEnable(args) {
    const taskName = args.taskName;
    const taskPath = args.taskPath ?? '\\';
    const script = `
    $task = Get-ScheduledTask -TaskName "${taskName}" -TaskPath "${taskPath}" -ErrorAction Stop;
    Set-ScheduledTask -TaskName "${taskName}" -TaskPath "${taskPath}" -Settings (New-ScheduledTaskSettingsSet -Enabled $true) -ErrorAction Stop;
    # Alternative approach that's more reliable:
    schtasks /change /tn "${taskPath}${taskName}" /enable 2>&1 | Out-Null;
    Write-Output "OK";
  `;
    ps(script);
    return { success: true, data: { enabled: { taskName, taskPath } }, durationMs: 0 };
}
async function handleTaskDisable(args) {
    const taskName = args.taskName;
    const taskPath = args.taskPath ?? '\\';
    const script = `
    schtasks /change /tn "${taskPath}${taskName}" /disable 2>&1 | Out-Null;
    Write-Output "OK";
  `;
    ps(script);
    return { success: true, data: { disabled: { taskName, taskPath } }, durationMs: 0 };
}
async function handleTaskRunNow(args) {
    const taskName = args.taskName;
    const taskPath = args.taskPath ?? '\\';
    const script = `
    schtasks /run /tn "${taskPath}${taskName}" 2>&1;
    Write-Output "OK";
  `;
    ps(script);
    return { success: true, data: { triggered: { taskName, taskPath } }, durationMs: 0 };
}
// ---------------------------------------------------------------------------
// Module definition + registration
// ---------------------------------------------------------------------------
const scheduledTasks = {
    name: 'scheduled_tasks',
    tools: [
        {
            name: 'task.list',
            description: 'List all scheduled tasks, optionally filtered by folder path. Returns task state, schedule info, last/next run times, and actions.',
            parameters: {
                type: 'object',
                properties: {
                    folder: { type: 'string', description: 'Task folder path to list (e.g. "\\\\Microsoft\\\\Windows"). Default: root.' }
                }
            }
        },
        {
            name: 'task.create',
            description: 'Create a new scheduled task with a trigger and action.',
            parameters: {
                type: 'object',
                properties: {
                    taskName: { type: 'string', description: 'Name for the new task' },
                    taskPath: { type: 'string', description: 'Folder to create the task in. Default: root.' },
                    executable: { type: 'string', description: 'Full path to the executable to run' },
                    arguments: { type: 'string', description: 'Command-line arguments for the executable' },
                    triggerType: { type: 'string', description: 'When to trigger the task', enum: ['schedule', 'atLogon', 'atStartup', 'onEvent'] },
                    schedule: { type: 'string', description: 'Schedule string (required for triggerType=schedule). Format: "daily HH:MM", "weekly DayName HH:MM", or "once YYYY-MM-DD HH:MM"' },
                    user: { type: 'string', description: 'User account to run as. Default: SYSTEM' },
                    runLevel: { type: 'string', description: 'Privilege level', enum: ['LeastPrivilege', 'HighestPrivilege'], default: 'LeastPrivilege' },
                    description: { type: 'string', description: 'Human-readable description of the task' },
                    eventLogName: { type: 'string', description: 'Event log name (for onEvent trigger)' },
                    eventId: { type: 'number', description: 'Event ID to trigger on (for onEvent trigger)' }
                },
                required: ['taskName', 'executable', 'triggerType']
            }
        },
        {
            name: 'task.delete',
            description: 'Delete a scheduled task by name.',
            parameters: {
                type: 'object',
                properties: {
                    taskName: { type: 'string', description: 'Name of the task to delete' },
                    taskPath: { type: 'string', description: 'Task folder path. Default: root.' }
                },
                required: ['taskName']
            }
        },
        {
            name: 'task.enable',
            description: 'Enable a previously disabled scheduled task.',
            parameters: {
                type: 'object',
                properties: {
                    taskName: { type: 'string', description: 'Task name' },
                    taskPath: { type: 'string', description: 'Task folder. Default: root.' }
                },
                required: ['taskName']
            }
        },
        {
            name: 'task.disable',
            description: 'Disable a scheduled task without deleting it.',
            parameters: {
                type: 'object',
                properties: {
                    taskName: { type: 'string', description: 'Task name' },
                    taskPath: { type: 'string', description: 'Task folder. Default: root.' }
                },
                required: ['taskName']
            }
        },
        {
            name: 'task.run.now',
            description: 'Manually trigger a scheduled task to run immediately.',
            parameters: {
                type: 'object',
                properties: {
                    taskName: { type: 'string', description: 'Task name to run' },
                    taskPath: { type: 'string', description: 'Task folder. Default: root.' }
                },
                required: ['taskName']
            }
        }
    ],
    async execute(toolName, args) {
        log.debug({ toolName, args }, 'Executing');
        switch (toolName) {
            case 'task.list': return handleTaskList(args);
            case 'task.create': return handleTaskCreate(args);
            case 'task.delete': return handleTaskDelete(args);
            case 'task.enable': return handleTaskEnable(args);
            case 'task.disable': return handleTaskDisable(args);
            case 'task.run.now': return handleTaskRunNow(args);
            default:
                throw new errors_1.ExecutionError('scheduled_tasks', `Unknown tool: ${toolName}`);
        }
    }
};
registry_1.registry.register(scheduledTasks);
exports.default = scheduledTasks;
//# sourceMappingURL=scheduled_tasks.js.map