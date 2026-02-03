"use strict";
/**
 * tools/firefox_bridge.ts
 *
 * Provides a high-fidelity bridge to Mozilla Firefox via the Remote Debugging Protocol (RDP).
 * This bypasses Windows UI Automation (UIA) limitations for web pages by injecting
 * JavaScript directly into the browser context.
 *
 * Requirements: Firefox must be started with --remote-debugging-port=9222.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const registry_1 = require("../core/registry");
const errors_1 = require("../core/errors");
const logger_1 = require("../core/logger");
const child_process_1 = require("child_process");
const log = (0, logger_1.scopedLogger)('tools/firefox_bridge');
// ---------------------------------------------------------------------------
// PowerShell helper for WebSocket communication
// ---------------------------------------------------------------------------
function ps(script, timeoutMs = 15000) {
    try {
        const buffer = Buffer.from(script, 'utf16le');
        const encoded = buffer.toString('base64');
        return (0, child_process_1.execSync)(`powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${encoded}`, { encoding: 'utf-8', timeout: timeoutMs, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    }
    catch (e) {
        const stderr = e.stderr?.toString() ?? '';
        throw new errors_1.ExecutionError('firefox_bridge', stderr || e.message);
    }
}
// ---------------------------------------------------------------------------
// Internal handlers
// ---------------------------------------------------------------------------
async function handleFirefoxExecuteJS(args) {
    const code = args.code;
    if (!code)
        throw new errors_1.ExecutionError('firefox_bridge', 'JavaScript code is required');
    const script = `
    # Find the active tab
    try {
      $tabs = Invoke-RestMethod -Uri "http://127.0.0.1:9222/json/list" -ErrorAction SilentlyContinue
      if ($null -eq $tabs) {
          $tabs = Invoke-RestMethod -Uri "http://127.0.0.1:9222/json" -ErrorAction Stop
      }
      $activeTab = $tabs | Where-Object { $_.type -eq "page" -or $_.type -eq "tab" } | Select-Object -First 1
      if ($null -eq $activeTab) { throw "No active Firefox tabs found." }
      $wsUrl = $activeTab.webSocketDebuggerUrl
    } catch {
      Write-Error "Failed to connect to Firefox CDP on port 9222. Ensure Firefox is running with --remote-debugging-port=9222. Error: $($_.Exception.Message)"
      exit 1
    }

    # Setup WebSocket
    $ws = New-Object System.Net.WebSockets.ClientWebSocket
    $ct = New-Object System.Threading.CancellationTokenSource
    $connectTask = $ws.ConnectAsync($wsUrl, $ct.Token)
    $connectTask.Wait()

    # Create the RDP message
    $message = @{
      id = [guid]::NewGuid().ToString()
      method = "Runtime.evaluate"
      params = @{
        expression = @"
${code.replace(/"/g, '""')}
"@
        returnByValue = $true
        awaitPromise = $true
      }
    } | ConvertTo-Json -Compress

    # Send message
    $buffer = [System.Text.Encoding]::UTF8.GetBytes($message)
    $segment = New-Object ArraySegment[byte] -ArgumentList @($buffer, 0, $buffer.Length)
    $sendTask = $ws.SendAsync($segment, [System.Net.WebSockets.WebSocketMessageType]::Text, $true, $ct.Token)
    $sendTask.Wait()

    # Receive response
    $receiveBuffer = New-Object byte[] 65536
    $receiveSegment = New-Object ArraySegment[byte] -ArgumentList @($receiveBuffer, 0, $receiveBuffer.Length)
    $receiveTask = $ws.ReceiveAsync($receiveSegment, $ct.Token)
    $receiveTask.Wait()

    $resultText = [System.Text.Encoding]::UTF8.GetString($receiveBuffer, 0, $receiveTask.Result.Count)
    
    # Close gracefully
    $closeTask = $ws.CloseAsync([System.Net.WebSockets.WebSocketCloseStatus]::NormalClosure, "Done", $ct.Token)
    $closeTask.Wait()

    Write-Output $resultText
  `;
    try {
        const raw = ps(script, 30000);
        const parsed = JSON.parse(raw);
        if (parsed.error) {
            return {
                success: false,
                error: { code: 'FIREFOX_JS_ERROR', message: parsed.error.message, details: parsed.error },
                durationMs: 0
            };
        }
        const result = parsed.result?.result;
        if (result?.type === 'undefined') {
            return { success: true, data: { result: null }, durationMs: 0 };
        }
        return {
            success: true,
            data: {
                value: result?.value,
                type: result?.type,
                description: result?.description
            },
            durationMs: 0
        };
    }
    catch (e) {
        return {
            success: false,
            error: { code: 'EXECUTION_ERROR', message: e.message },
            durationMs: 0
        };
    }
}
async function handleFirefoxGetElements(args) {
    const selector = args.selector || 'input, button, a, [role="button"], [contenteditable="true"]';
    const code = `
    (function() {
      const elements = Array.from(document.querySelectorAll('${selector.replace(/'/g, "\\'")}'));
      return elements.map(el => {
        const rect = el.getBoundingClientRect();
        return {
          tagName: el.tagName,
          id: el.id,
          className: el.className,
          text: el.innerText || el.value || el.placeholder || '',
          x: rect.left,
          y: rect.top,
          width: rect.width,
          height: rect.height,
          isVisible: rect.width > 0 && rect.height > 0 && el.offsetParent !== null
        };
      }).filter(el => el.isVisible);
    })()
  `;
    const result = await handleFirefoxExecuteJS({ code });
    if (!result.success)
        return result;
    return {
        success: true,
        data: { elements: result.data },
        durationMs: 0
    };
}
// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------
const firefoxBridge = {
    name: 'firefox_bridge',
    tools: [
        {
            name: 'firefox.execute_js',
            description: 'Execute JavaScript code directly in the active Firefox tab via Remote Debugging Protocol. Returns the evaluated result.',
            parameters: {
                type: 'object',
                properties: {
                    code: { type: 'string', description: 'The JavaScript code to execute' }
                },
                required: ['code']
            }
        },
        {
            name: 'firefox.get_elements',
            description: 'Find interactive elements (inputs, buttons, links) on the current page using JavaScript. Returns their bounding boxes and properties.',
            parameters: {
                type: 'object',
                properties: {
                    selector: { type: 'string', description: 'Optional CSS selector to filter elements. Defaults to all interactive elements.' }
                }
            }
        }
    ],
    async execute(toolName, args) {
        log.debug({ toolName, args }, 'Executing');
        switch (toolName) {
            case 'firefox.execute_js': return handleFirefoxExecuteJS(args);
            case 'firefox.get_elements': return handleFirefoxGetElements(args);
            default:
                throw new errors_1.ExecutionError('firefox_bridge', `Unknown tool: ${toolName}`);
        }
    }
};
// Self-register
registry_1.registry.register(firefoxBridge);
exports.default = firefoxBridge;
//# sourceMappingURL=firefox_bridge.js.map