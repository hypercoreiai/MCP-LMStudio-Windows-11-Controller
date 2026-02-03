# MCP-LMStudio Win11 Desktop Controller (V2)

An advanced Model Context Protocol (MCP) server that provides high-fidelity Windows 11 desktop automation. This version is specifically optimized for a tiered AI architecture where a powerful remote model (e.g., Qwen3 200B+) generates complex tool-chain strategies that are then executed by a local agent (8B-20B GGUF).

---

## 🚀 High-Fidelity Automation Architecture

Version 2 introduces a "Visual Grounding" and "Native Bridge" pattern to overcome the traditionally brittle nature of desktop automation.

```
Remote Planner (200B+) ──► Strategy ──► Local Executor (8B-20B)
                                          │
    ┌─────────────────────────────────────┴─────────────────────────────────────┐
    │                                                                           │
    ▼                                     ▼                                     ▼
Visual Grounding                      Native Bridges                        Core OS Tools
(Annotated Screenshots)               (Firefox RDP, JS Injection)           (Processes, Files, UIA)
```

### Key Upgraded Features

#### 1. Firefox RDP Bridge (`firefox_bridge`)
Bypasses the limitations of the Windows Accessibility Tree (UIA) by connecting directly to Firefox via the **Remote Debugging Protocol (Port 9222)**.
- **Direct JS Injection**: Execute raw JavaScript to fill forms, click obfuscated buttons, or scrape dynamic SPAs.
- **DOM Grounding**: Retrieve exact coordinates of web elements directly from the browser's rendering engine.

#### 2. Visual Grounding (`display.screenshot.annotated`)
Provides "eyes" for the planning model.
- **Overlay Annotations**: Automatically draws red bounding boxes over UI elements discovered via UIA or the Firefox Bridge.
- **Safety Loop**: Allows the AI to verify that its target coordinates match the visual reality before committing to a click.

#### 3. Sophisticated Strategy Orchestration
The `agent.execute_query` tool has been upgraded to utilize a **"Think-Seek-Act-Verify"** loop:
- **Think**: Logical task decomposition.
- **Seek**: Element discovery through multiple discovery layers (UIA, JS, Scraping).
- **Act**: Precise interaction using native input simulation or JS injection.
- **Verify**: Post-action validation via fresh screenshots or state checks.

---

## 🛠 Core Components

- **[Parser Router](src/core/parser/router.ts)**: Auto-detects model output formats (XML `<tool_call>` tags vs. heuristic text).
- **[TSD Applier](src/core/tsd/applier.ts)**: Enforces per-tool execution policies including rate limiting, automatic UAC elevation, and deterministic retries with exponential backoff.
- **[Tool Registry](src/core/registry.ts)**: A centralized, self-registering singleton holding 78+ tools across 15 modules.
- **[Hook System](src/core/hooks.ts)**: Pre- and post-execution hooks for tasks like automatic backups before file deletion or visual confirmation of window focus.

---

## 📦 Comprehensive Toolset

| Module | Capabilities |
| :--- | :--- |
| **Firefox Bridge** | `execute_js`, `get_elements` |
| **UI Inspector** | `list_elements`, `click_element`, `type_into_element` |
| **Display** | `list`, `screenshot.annotated`, `set_resolution`, `set_dpi` |
| **Window** | `list`, `focus`, `move`, `snap`, `maximize`, `minimize` |
| **Input** | `type`, `key`, `mouse_click`, `mouse_drag`, `hotkey` |
| **Process** | `list`, `start`, `kill`, `wait`, `run` |
| **File Systems** | `read`, `write`, `copy`, `move`, `delete`, `search` |
| **And More** | Registry, Clipboard, Memory, Virtual Desktops, System Info |

---

## 🚦 Quick Start

### 1. Requirements
- Windows 11
- Node.js >= 20.0.0
- **Firefox**: Must be closed or started with `--remote-debugging-port=9222` for the bridge to work.
- **LM Studio**: Running locally (default: `http://localhost:11000/v1`).

### 2. Installation
```bash
npm install
npm run build
```

### 3. Execution
```bash
# Default (stdio) mode for direct integration
npm start

# HTTP server for remote access
npm run start:http
```

### 4. Interactive Testing
Use the built-in test utility to verify individual tools:
```bash
node test_tools.js list
node test_tools.js call display.screenshot '{"format":"png"}'
node test_tools.js interactive
```

---

## 🛡 Security & Isolation
- **Path Sandboxing**: Restrict file operations to specific directories via `FILE_MANAGER_SANDBOX`.
- **Elevation Whitelisting**: Pre-approve specific tools for UAC elevation in `session.json`.
- **Module Whitelisting**: Tight control over allowed transport and hook modules to prevent RCE.

---

## 📝 Development
To extend the server with a new tool:
1. Create a module in `src/tools/` implementing the `ToolModule` interface.
2. Call `registry.register(yourModule)` at the end of the file.
3. Import the module in `src/tools/index.ts`.
4. (Optional) Define a Task-Specific Definition in `config/tsds/` for retry/timeout policies.
