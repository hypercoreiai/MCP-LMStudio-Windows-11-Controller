# Tool Testing Quick Reference

## Quick Start

```bash
# List all available tools
node test_tools.js list

# Show tool details and parameters
node test_tools.js schema file.read

# Call a tool
node test_tools.js call system.info '{}'

# Interactive mode
node test_tools.js interactive
```

## Common Test Examples

### System Information
```bash
# Get system info
node test_tools.js call system.info '{}'

# Get CPU info
node test_tools.js call system.cpu '{}'

# Get memory info
node test_tools.js call system.memory '{}'
```

### File Operations
```bash
# List files in a directory
node test_tools.js call file.list '{"path":"C:\\temp"}'

# Read a file
node test_tools.js call file.read '{"path":"C:\\temp\\test.txt"}'

# Write a file
node test_tools.js call file.write '{"path":"C:\\temp\\test.txt","content":"Hello World"}'

# Delete a file
node test_tools.js call file.delete '{"path":"C:\\temp\\test.txt"}'

# Get file properties
node test_tools.js call file.properties '{"path":"C:\\temp\\test.txt"}'
```

### Window Management
```bash
# List all windows
node test_tools.js call window.list '{}'

# Focus a window by handle
node test_tools.js call window.focus '{"handle":"123456"}'

# Close a window
node test_tools.js call window.close '{"handle":"123456"}'
```

### Process Management
```bash
# List running processes
node test_tools.js call process.list '{}'

# Start a process
node test_tools.js call process.start '{"command":"notepad.exe"}'

# Kill a process
node test_tools.js call process.kill '{"pid":12345}'
```

### Input Simulation
```bash
# Type text
node test_tools.js call input.type '{"text":"Hello World"}'

# Press a key
node test_tools.js call input.key '{"key":"Enter"}'

# Click mouse
node test_tools.js call input.mouse_click '{"x":100,"y":100,"button":"left"}'
```

### Clipboard
```bash
# Get clipboard content
node test_tools.js call clipboard.get '{}'

# Set clipboard content
node test_tools.js call clipboard.set '{"content":"Hello World"}'
```

### Display
```bash
# List displays
node test_tools.js call display.list '{}'

# Take screenshot
node test_tools.js call display.screenshot '{"format":"png"}'
```

## Testing with HTTP Transport

Start the server in HTTP mode:
```bash
npm run start:http
```

Then use curl or any HTTP client:

```bash
# List tools
curl http://localhost:3000/tools/list

# Call a tool
curl -X POST http://localhost:3000/tools/call \
  -H "Content-Type: application/json" \
  -d '{"tool":"system.info","arguments":{}}'

# With correlation ID
curl -X POST http://localhost:3000/tools/call \
  -H "Content-Type: application/json" \
  -H "X-Correlation-Id: my-test-123" \
  -d '{"tool":"file.list","arguments":{"path":"C:\\temp"}}'
```

## Testing with Postman/Insomnia

### GET /tools/list
- Method: GET
- URL: `http://localhost:3000/tools/list`

### POST /tools/call
- Method: POST
- URL: `http://localhost:3000/tools/call`
- Headers:
  - `Content-Type: application/json`
  - `X-Correlation-Id: optional-trace-id`
- Body:
```json
{
  "tool": "system.info",
  "arguments": {}
}
```

## Tool Categories

### file (9 tools)
- `file.read` - Read file contents
- `file.write` - Write/create file
- `file.copy` - Copy file/directory
- `file.move` - Move/rename file
- `file.delete` - Delete file/directory
- `file.list` - List directory contents
- `file.search` - Search files by content
- `file.open` - Open file with default app
- `file.properties` - Get file metadata

### window (9 tools)
- `window.list` - List all windows
- `window.focus` - Focus/activate window
- `window.move` - Move window position
- `window.resize` - Resize window
- `window.minimize` - Minimize window
- `window.maximize` - Maximize window
- `window.restore` - Restore window
- `window.close` - Close window
- `window.snap` - Snap window to screen edge

### process (5 tools)
- `process.list` - List running processes
- `process.start` - Start new process
- `process.kill` - Kill process by PID
- `process.wait` - Wait for process to exit
- `process.run` - Run command and get output

### input (6 tools)
- `input.type` - Type text
- `input.key` - Press keyboard key
- `input.mouse_click` - Click mouse button
- `input.mouse_drag` - Drag mouse
- `input.mouse_scroll` - Scroll mouse wheel
- `input.hotkey` - Press key combination

### clipboard (3 tools)
- `clipboard.get` - Get clipboard text
- `clipboard.set` - Set clipboard text
- `clipboard.clear` - Clear clipboard

### display (5 tools)
- `display.list` - List displays/monitors
- `display.screenshot` - Capture screenshot
- `display.set_resolution` - Change resolution
- `display.set_dpi` - Change DPI scaling
- `display.set_brightness` - Change brightness

### registry (5 tools)
- `registry.read` - Read registry value
- `registry.write` - Write registry value
- `registry.delete` - Delete registry key/value
- `registry.list` - List registry subkeys
- `registry.export` - Export registry branch

### task (6 tools)
- `task.list` - List scheduled tasks
- `task.create` - Create scheduled task
- `task.delete` - Delete scheduled task
- `task.enable` - Enable scheduled task
- `task.disable` - Disable scheduled task
- `task.run_now` - Run task immediately

### system (7 tools)
- `system.info` - Get system information
- `system.cpu` - Get CPU information
- `system.memory` - Get memory usage
- `system.disk` - Get disk usage
- `system.network` - Get network adapters
- `system.battery` - Get battery status
- `system.services` - List Windows services

## Common Argument Patterns

### Paths (Windows)
Always use double backslashes in JSON:
```json
{"path": "C:\\Users\\Public\\test.txt"}
```

Or use forward slashes:
```json
{"path": "C:/Users/Public/test.txt"}
```

### Optional Parameters
Many tools have optional parameters with defaults:
```bash
# With defaults
node test_tools.js call file.list '{"path":"C:\\temp"}'

# With optional pattern
node test_tools.js call file.list '{"path":"C:\\temp","pattern":"*.txt"}'
```

### Boolean Flags
```json
{
  "path": "C:\\temp\\folder",
  "recursive": true
}
```

## Debugging Tips

1. **Check tool schema first**
   ```bash
   node test_tools.js schema <tool_name>
   ```

2. **Use interactive mode for exploration**
   ```bash
   node test_tools.js interactive
   ```

3. **Check correlation IDs in logs**
   - Logs include correlation IDs for tracing
   - Pass custom ID via `X-Correlation-Id` header

4. **Look for validation errors**
   - Tool will report missing required parameters
   - Invalid types will be caught early

5. **Monitor server logs**
   - Server logs show all operations with context
   - Structured JSON logs for parsing

## Error Handling

Tools return standardized error responses:

```json
{
  "success": false,
  "error": {
    "code": "PATH_NOT_FOUND",
    "message": "Path not found: \"C:\\nonexistent.txt\""
  },
  "durationMs": 2
}
```

Common error codes:
- `VALIDATION_ERROR` - Invalid arguments
- `PATH_NOT_FOUND` - File/path doesn't exist
- `ACCESS_DENIED` - Insufficient permissions
- `EXECUTION_ERROR` - Tool execution failed
- `TIMEOUT_ERROR` - Operation timed out
- `RATE_LIMIT_ERROR` - Too many requests
