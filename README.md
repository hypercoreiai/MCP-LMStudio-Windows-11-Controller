# MCP-LMStudio Win11 Desktop Controller

A fully modular MCP (Model Context Protocol) server that gives any OpenAI-compatible LLM full control over a Windows 11 desktop. Designed for strictly local/LAN operation with tools like LM Studio. Handles both models that emit native `<tool_call>` XML tags **and** models that produce plain text, with zero configuration required to distinguish between them.

---

## Architecture at a Glance

```
Local LLM (LM Studio)  ──►  MCP Server  ──►  Parser Router  ──►  Tool Registry  ──►  TSD Applier  ──►  Windows APIs
(e.g., Llama/GPT on LAN)     (stdio/http/sse)   (auto-detects        (78 tools          (retries, hooks,
                              with local models   tag vs text)         across 15          timeouts, rate
                                                   hybrid mode)        modules)           limits, elevation)
```

---

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Build TypeScript → dist/, then start in stdio mode (default)
npm start

# Or start as an HTTP server on port 3000
npm run start:http

# Or start as an SSE server
npm run start:sse

# For active development (no build step — ts-node runs src/ directly)
npm run dev
```

### Testing Tools

Test individual tools quickly:

```bash
# List all available tools
node test_tools.js list

# Show tool schema and required arguments
node test_tools.js schema file.read

# Call a tool
node test_tools.js call system.info '{}'
node test_tools.js call file.list '{"path":"C:\\temp"}'

# Interactive mode
node test_tools.js interactive
```

---

## LM Studio Setup (Local LLM Integration)

This project is designed for strictly local/LAN operation with LM Studio as the MCP server backend.

### 1. Install LM Studio

- Download and install [LM Studio](https://lmstudio.ai/).
- Download a compatible model (e.g., GPT-2, Llama, or any OpenAI-compatible model).

### 2. Start the Local Server

- Open LM Studio.
- Load your chosen model.
- Start the local server on `http://localhost:11000` (default port).
- Ensure the server is running and accessible.

### 3. Configure Environment Variables (Optional)

The agent tool defaults to local operation, but you can override:

```bash
# Set the local LM Studio endpoint (default: http://localhost:11000/v1)
set OPENAI_BASE_URL=http://localhost:11000/v1

# Set the model name (default: local-model)
set AGENT_MODEL=your-local-model-name

# API key is not required for local LM Studio (defaults to dummy)
```

### 4. Test the Agent

With LM Studio running, test autonomous queries:

```bash
node test_tools.js call agent.execute_query '{"query": "List the files in the current directory"}'
```

The `agent.execute_query` tool leverages your local LLM to autonomously plan and execute multi-step tasks using the available toolset.

## Qwen Integration

The agent can also use Qwen models from Alibaba Cloud via OAuth authentication. To enable Qwen:

1. Run the setup script:
```bash
node setup_qwen.js
```

2. Or manually set environment variables:
```bash
export USE_QWEN=true
export QWEN_MODEL=qwen3  # or other available models
export QWEN_BASE_URL=https://portal.qwen.ai/v1  # optional, uses default if not set
```

3. Run an agent query - it will automatically handle OAuth login on first use:
```bash
node test_tools.js call agent.execute_query '{"query": "What is the capital of France?"}'
```

On first run, the agent will:
- Open your browser to https://chat.qwen.ai/
- Prompt you to enter a device code
- Complete OAuth authentication
- Store tokens securely in the `memories/` directory
- Automatically refresh tokens when they expire

Available Qwen models include `qwen3`, `coder-model`, and `vision-model`.

---

## Prerequisites

- **Node.js 20+**
- **Windows 11** (the tool modules call Win32 APIs and PowerShell cmdlets)
- **PowerShell 5.1+** (ships with Windows — no installation needed)

For the optional low-latency input simulation path, install the native addon:
```bash
npm install ffi-napi
```
If this is skipped, `input_handler` automatically falls back to a PowerShell-based implementation.

---

## Configuration

### `config/session.json`

| Key | Type | Default | Description |
|---|---|---|---|
| `transportMode` | `"stdio"` \| `"http"` \| `"sse"` | `"stdio"` | How the server communicates. CLI `--transport` overrides this. |
| `port` | number | `3000` | Port for HTTP/SSE modes. |
| `modelSupportsToolCallTags` | `true` \| `false` \| `null` | `null` | Parser hint. `null` = hybrid auto-detect (recommended). |
| `elevationPreApproved` | boolean | `false` | Skip UAC for whitelisted tools. |
| `elevationWhitelist` | string[] | `[]` | Tool names allowed to run elevated without prompting. |
| `logLevel` | string | `"info"` | Pino log level: trace, debug, info, warn, error, fatal. |

### `config/tsds/*.json` — Task-Specific Definitions

Each file tunes one tool's runtime behaviour without touching its code:

```json
{
  "toolName": "file.delete",
  "retryPolicy": {
    "maxRetries": 2,
    "backoff": "exponential",
    "baseDelayMs": 500,
    "retryableErrors": ["ACCESS_DENIED", "FILE_IN_USE"]
  },
  "timeoutMs": 10000,
  "requiresElevation": false,
  "preHook": "backup_target",
  "postHook": "verify_deleted"
}
```

**TSD fields:**

| Field | Description |
|---|---|
| `retryPolicy` | How many times and how long to retry on retryable errors |
| `timeoutMs` | Hard wall-clock cap per attempt |
| `requiresElevation` | If `true`, the process must be running as admin |
| `preHook` | Named hook to run before execution (can mutate args) |
| `postHook` | Named hook to run after execution (can mutate result) |
| `fallbackTool` | If all retries fail, try this other tool instead |
| `rateLimits` | Calls-per-second cap with burst allowance |
| `inputValidation` | A stricter JSON Schema layered on top of the base schema |

### Path Sandboxing

Set the `FILE_MANAGER_SANDBOX` environment variable to a semicolon-separated list of allowed path prefixes. Any `file.*` operation targeting a path outside this list is rejected before any I/O runs:

```bash
set FILE_MANAGER_SANDBOX=C:\Users\MyUser;C:\Projects
```

---

## Tool Reference

### Window Manager (`window_manager`)
| Tool | Description |
|---|---|
| `window.list` | Enumerate visible windows |
| `window.focus` | Bring a window to foreground |
| `window.move` | Reposition by pixel coordinates |
| `window.resize` | Resize to given dimensions |
| `window.minimize` | Minimize |
| `window.maximize` | Maximize |
| `window.restore` | Restore from min/max |
| `window.close` | Send close message |
| `window.snap` | Snap to a Windows 11 layout slot |

### File Manager (`file_manager`)
| Tool | Description |
|---|---|
| `file.read` | Read file (text or base64) |
| `file.write` | Create/overwrite file |
| `file.copy` | Copy file or directory |
| `file.move` | Move/rename |
| `file.delete` | Delete file or directory |
| `file.list` | List directory with optional glob filter |
| `file.search` | Recursive content search (string or regex) |
| `file.open` | Open with default application |
| `file.properties` | File metadata |

### Process Manager (`process_manager`)
| Tool | Description |
|---|---|
| `process.list` | List running processes |
| `process.start` | Launch in background |
| `process.kill` | Terminate (graceful or force) |
| `process.wait` | Wait for exit |
| `process.run` | Start + wait + capture output |

### Input Handler (`input_handler`)
| Tool | Description |
|---|---|
| `input.type` | Type text |
| `input.key` | Press key with optional modifiers |
| `input.mouse_click` | Click at coordinates |
| `input.mouse_drag` | Drag with interpolated motion |
| `input.mouse_scroll` | Scroll at position |
| `input.hotkey` | Fire keyboard shortcut (e.g. `Ctrl+C`) |

### Clipboard Manager (`clipboard_manager`)
| Tool | Description |
|---|---|
| `clipboard.get` | Read clipboard (text, image, file list) |
| `clipboard.set` | Write text or image |
| `clipboard.clear` | Clear clipboard |

### Display Manager (`display_manager`)
| Tool | Description |
|---|---|
| `display.list` | List monitors |
| `display.screenshot` | Capture screen (full, monitor, or region) |
| `display.set_resolution` | Change resolution |
| `display.set_dpi` | Set DPI scaling |
| `display.set_brightness` | Set brightness (laptops) |

### Registry Manager (`registry_manager`)
| Tool | Description |
|---|---|
| `registry.read` | Read key or value |
| `registry.write` | Write value (HKLM requires elevation) |
| `registry.delete` | Delete key or value |
| `registry.list` | List subkeys and values |
| `registry.export` | Export to .reg file |

### Scheduled Tasks (`scheduled_tasks`)
| Tool | Description |
|---|---|
| `task.list` | List scheduled tasks |
| `task.create` | Create with trigger + action |
| `task.delete` | Delete by name |
| `task.enable` | Enable |
| `task.disable` | Disable |
| `task.run_now` | Trigger immediately |

### System Info (`system_info`)
| Tool | Description |
|---|---|
| `system.info` | OS, hostname, uptime |
| `system.cpu` | CPU usage per core |
| `system.memory` | RAM usage |
| `system.disk` | Disk usage per drive |
| `system.network` | Adapters + connectivity |
| `system.battery` | Battery level (laptops) |
| `system.services` | Windows services |

---

## Built-in Hooks

| Hook | Phase | What it does |
|---|---|---|
| `backup_target` | pre | Copies the target file/registry key to `.backups/` |
| `screenshot_focus` | pre | Captures a screenshot and attaches it as `_screenshot` in args |
| `verify_deleted` | post | Fails the result if the target still exists |
| `verify_exists` | post | Fails the result if the target doesn't exist |
| `log_action` | pre + post | Appends a JSON line to `audit.log` |
| `poll_for_window` | post | Waits for a new window to appear after a process launch |

---

## Adding a New Tool (4 Steps)

1. **Create** `src/tools/my_tool.ts` implementing the `ToolModule` interface
2. **Define schemas** — the OpenAI function definitions the LLM sees
3. **Write a TSD** — `config/tsds/my_tool.json` with retry/hook/timeout policies
4. **Register** — add `import './my_tool';` to `src/tools/index.ts`

No core code changes needed. The parser, registry, and transports pick it up automatically.

---

## Transport Modes

| Mode | Use when… | Command |
|---|---|---|
| `stdio` | An MCP client spawns you as a child process (Claude Desktop, VS Code) | `npm start` |
| `http` | You want a standalone API server for custom integrations | `npm run start:http` |
| `sse` | Results are large (screenshots) or you need streaming status updates | `npm run start:sse` |

---

## Security Notes

- **Elevation is gated.** Tools that set `requiresElevation: true` in their TSD will fail if the process isn't running as admin, unless the session has pre-approved them.
- **Path sandboxing** prevents file operations outside configured directories.
- **Rate limiting** is enforced per-tool via TSDs to prevent runaway loops.
- **Audit logging** via the `log_action` hook provides a full trail of every invocation.
- **Backups before destruction.** `file.delete` and `registry.write`/`registry.delete` all run `backup_target` before touching anything.

---

## Project Structure

```
mcp-win11-desktop/
├── src/
│   ├── core/
│   │   ├── server.ts            # Entry point & boot orchestrator
│   │   ├── types.ts             # All shared TypeScript types
│   │   ├── errors.ts            # Typed error taxonomy
│   │   ├── logger.ts            # Pino singleton + scoped loggers
│   │   ├── registry.ts          # Tool registry (singleton)
│   │   ├── hooks.ts             # Hook registry + built-in hooks
│   │   ├── parser/
│   │   │   ├── router.ts        # Decides embedding vs text parser
│   │   │   ├── embedding_parser.ts  # <tool_call> tag extraction
│   │   │   └── text_parser.ts   # Plain-text strategy stack
│   │   └── tsd/
│   │       ├── loader.ts        # Reads config/tsds/*.json
│   │       └── applier.ts       # Wraps execute() with TSD policies
│   ├── tools/
│   │   ├── index.ts             # Barrel — imports all tool modules
│   │   ├── window_manager.ts
│   │   ├── file_manager.ts
│   │   ├── process_manager.ts
│   │   ├── input_handler.ts
│   │   ├── clipboard_manager.ts
│   │   ├── display_manager.ts
│   │   ├── registry_manager.ts
│   │   ├── scheduled_tasks.ts
│   │   ├── system_info.ts
│   │   ├── internet_tools.ts
│   │   ├── ui_inspector.ts
│   │   ├── memory_manager.ts
│   │   ├── agent_orchestrator.ts
│   │   ├── virtual_desktop_manager.ts
│   │   └── shell_executor.ts
│   └── transports/
│       ├── http.ts              # Express HTTP server
│       ├── sse.ts               # Server-Sent Events
│       └── stdio.ts             # JSON-RPC over stdin/stdout
├── config/
│   ├── session.json             # Session defaults
│   └── tsds/                    # Per-tool TSD configs (15 files)
├── package.json
├── tsconfig.json
└── README.md
```
