# Quick Testing Guide

## Using the Test Tool

The project includes `test_tools.js` for easy tool testing.

### List All Tools
```bash
node test_tools.js list
```

### Show Tool Details
```bash
node test_tools.js schema file.read
node test_tools.js schema system.info
```

### Call a Tool
```bash
# System info (no arguments)
node test_tools.js call system.info '{}'

# List files
node test_tools.js call file.list '{"path":"C:\\temp"}'

# Read a file
node test_tools.js call file.read '{"path":"C:\\temp\\test.txt"}'

# Write a file
node test_tools.js call file.write '{"path":"C:\\temp\\test.txt","content":"Hello"}'
```

## Manual Testing with JSON-RPC

Start the server in stdio mode:
```bash
npm start
```

Send JSON-RPC requests via stdin:

### List all tools:
```json
{"jsonrpc":"2.0","id":1,"method":"tools/list"}
```

### Call a tool:
```json
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"tool":"system.info","arguments":{}}}
```

### Example with file operations:
```json
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"tool":"file.list","arguments":{"path":"C:\\temp"}}}
```

## Using HTTP Mode

Start server:
```bash
npm run start:http
```

### PowerShell Examples:

List tools:
```powershell
Invoke-RestMethod -Uri http://localhost:3000/tools/list
```

Call a tool:
```powershell
$body = @{
    tool = "system.info"
    arguments = @{}
} | ConvertTo-Json

Invoke-RestMethod -Uri http://localhost:3000/tools/call -Method POST -Body $body -ContentType "application/json"
```

File operations:
```powershell
$body = @{
    tool = "file.list"
    arguments = @{
        path = "C:\temp"
    }
} | ConvertTo-Json

Invoke-RestMethod -Uri http://localhost:3000/tools/call -Method POST -Body $body -ContentType "application/json"
```

### Curl Examples:

```bash
# List tools
curl http://localhost:3000/tools/list

# Get system info
curl -X POST http://localhost:3000/tools/call \
  -H "Content-Type: application/json" \
  -d '{"tool":"system.info","arguments":{}}'

# List files
curl -X POST http://localhost:3000/tools/call \
  -H "Content-Type: application/json" \
  -d '{"tool":"file.list","arguments":{"path":"C:\\temp"}}'
```

## Quick Tool Reference

### No Arguments Required
- `system.info`, `system.cpu`, `system.memory`, `system.disk`
- `clipboard.get`, `clipboard.clear`
- `window.list`, `process.list`, `display.list`
- `task.list`, `system.services`

### Common Arguments
- **path** - File/directory path: `"C:\\temp\\file.txt"`
- **handle** - Window handle from `window.list`: `"123456"`
- **pid** - Process ID from `process.list`: `12345`
- **command** - Executable: `"notepad.exe"`
- **text** - Text content: `"Hello World"`

## Tool Categories & Examples

### System (7 tools)
```bash
node test_tools.js call system.info '{}'
node test_tools.js call system.cpu '{}'
node test_tools.js call system.memory '{}'
```

### File (9 tools)
```bash
node test_tools.js call file.list '{"path":"C:\\Users"}'
node test_tools.js call file.read '{"path":"C:\\temp\\test.txt"}'
node test_tools.js call file.write '{"path":"C:\\temp\\test.txt","content":"Test"}'
node test_tools.js call file.delete '{"path":"C:\\temp\\test.txt"}'
```

### Window (9 tools)
```bash
node test_tools.js call window.list '{}'
# Get handle from list output, then:
node test_tools.js call window.focus '{"handle":"123456"}'
node test_tools.js call window.close '{"handle":"123456"}'
```

### Process (5 tools)
```bash
node test_tools.js call process.list '{}'
node test_tools.js call process.start '{"command":"notepad.exe"}'
node test_tools.js call process.kill '{"pid":12345}'
```

### Input (6 tools)
```bash
node test_tools.js call input.type '{"text":"Hello"}'
node test_tools.js call input.key '{"key":"Enter"}'
node test_tools.js call input.mouse_click '{"x":500,"y":500,"button":"left"}'
```

### Clipboard (3 tools)
```bash
node test_tools.js call clipboard.get '{}'
node test_tools.js call clipboard.set '{"content":"Test"}'
node test_tools.js call clipboard.clear '{}'
```

### Display (5 tools)
```bash
node test_tools.js call display.list '{}'
node test_tools.js call display.screenshot '{"format":"png"}'
```

## Common Patterns

### Working with Paths
Windows paths need escaped backslashes in JSON:
```json
{"path": "C:\\Users\\Public\\test.txt"}
```

Or use forward slashes:
```json
{"path": "C:/Users/Public/test.txt"}
```

### Getting IDs for Operations
1. List resources first:
   ```bash
   node test_tools.js call window.list '{}'
   node test_tools.js call process.list '{}'
   ```

2. Use returned ID/handle in next operation:
   ```bash
   node test_tools.js call window.focus '{"handle":"<from_list>"}'
   ```

### Checking Required Arguments
Use the schema command:
```bash
node test_tools.js schema <tool_name>
```

This shows:
- All parameters
- Which are required vs optional
- Parameter types
- Descriptions
- Example usage

## Response Format

Success response:
```json
{
  "success": true,
  "data": { ... },
  "durationMs": 123
}
```

Error response:
```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Error description"
  },
  "durationMs": 45
}
```

## Troubleshooting

### "Tool not found"
- Check spelling: `node test_tools.js list`
- Tool names are case-sensitive

### "Missing required argument"
- Check schema: `node test_tools.js schema <tool_name>`
- Verify JSON syntax

### "Path not found"
- Use absolute paths
- Escape backslashes: `C:\\temp` or use forward slashes

### "Access denied"
- Some tools require admin privileges
- Run terminal as Administrator

For complete documentation, see [TESTING_GUIDE.md](TESTING_GUIDE.md)
