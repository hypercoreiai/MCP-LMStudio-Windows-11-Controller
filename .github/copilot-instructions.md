# MCP-LMStudio Win11 Desktop Controller: AI Coding Agent Instructions

## Project Overview
**MCP-LMStudio Win11 Desktop Controller** is a Model Context Protocol (MCP) server enabling local LLMs (via LM Studio or Qwen) to execute system-level tasks on Windows 11 through 78 tools across 15 modules. The architecture supports three transport modes (stdio/HTTP/SSE) and features sophisticated task-specific handling with rate limiting, elevation management, and retry policies.

## Architecture

### High-Level Data Flow
```
Local LLM (stdin/HTTP/SSE) 
  → ParserRouter (embedding/text/hybrid)
  → ToolInvocation parsing
  → ToolRegistry dispatch
  → TsdApplier (rate limits → elevation → retries → hooks)
  → Tool execution (file/process/registry/window/etc)
  → Result serialization
```

### Core Components

**[../src/core/server.ts](../src/core/server.ts)**: Single entry point that:
- Loads .env variables with fallback paths (root, cwd, hardcoded)
- Parses CLI args (--transport, --port)
- Initializes logger, TSD loader, registry, parser router
- Starts the selected transport

**[../src/core/types.ts](../src/core/types.ts)**: **Single source of truth** for all shared types—every module imports from here, never defines its own DTOs.

**[../src/core/parser/router.ts](../src/core/parser/router.ts)**: Routes model output through three parser modes:
- `embedding`: Always use `<tool_call>` XML tag parser
- `text`: Always use plain-text heuristic stack
- `hybrid` (default): Try embedding first, fall through to text if no tags found

**[../src/core/registry.ts](../src/core/registry.ts)**: Central singleton holding all registered tool modules. Enforces initialization guard before dispatch. Uses tool self-registration on import.

**[../src/core/tsd/applier.ts](../src/core/tsd/applier.ts)**: Execution wrapper applying policies in order:
1. Rate limit check (sliding window, memory-safe with cleanup)
2. Elevation/UAC check
3. Input validation (stricter TSD schema on top of OpenAI schema)
4. Pre-hook execution
5. Retry loop with per-attempt timeouts
6. Post-hook execution
7. Fallback tool invocation if all retries exhausted

**[../src/core/hooks.ts](../src/core/hooks.ts)**: Named hook registry. TSDs reference hooks by string name. Hooks can preprocess args or post-process results with full error wrapping.

**[../src/tools/index.ts](../src/tools/index.ts)**: **Single import point**—tool modules register themselves on import. To add a tool: create file in `src/tools/`, add one import line here.

### Tool Module Pattern
Each tool module (e.g., [../src/tools/file_manager.ts](../src/tools/file_manager.ts)) exports:
```typescript
const toolModule: ToolModule = {
  name: 'file',
  schemas: [ ... ],  // OpenAI function schemas
  async execute(invocation: ToolInvocation): Promise<ToolResult> { ... }
};
registry.register(toolModule);
```

## Task-Specific Definitions (TSDs)

TSDs ([../config/tsds/*.json](../config/tsds/)) define per-tool execution policies:
- **rateLimits**: `{maxCallsPerSecond, burstAllowance}`
- **inputSchema**: Stricter OpenAI schema for additional validation
- **elevationRequired**: Boolean or array of whitelisted operation names
- **retryPolicy**: `{maxAttempts, retryDelayMs, backoffMultiplier, retryableErrors: [error codes]}`
- **hooks**: `{pre: HookRef, post: HookRef}`
- **fallbackTool**: Tool name to invoke if all retries fail
- **timeoutMs**: Per-attempt timeout

Example: [../config/tsds/file_write.json](../config/tsds/file_write.json) enforces write confirmation, rate limiting, and elevation checks.

## Error Handling

All errors extend [McpBaseError](../src/core/errors.ts) with typed `.code` property:
- **PARSE_ERROR**, **MALFORMED_TOOL_CALL**: Parser layer
- **VALIDATION_ERROR**, **MISSING_ARGUMENT**: Schema violations
- **UNKNOWN_TOOL**: Registry dispatch
- **EXECUTION_ERROR**, **PATH_NOT_FOUND**, **ACCESS_DENIED**: Windows API layer
- **TIMEOUT_ERROR**, **RATE_LIMIT_ERROR**, **ELEVATION_ERROR**: Policy layer

Retry policies target specific error codes. All errors include `.details` object with context.

## Security & Isolation

- **Module Whitelisting**: Transport and hook modules must be in explicit whitelist (stdio/http/sse for transport)
- **Path Sandboxing**: File operations check `FILE_MANAGER_SANDBOX` env var (semicolon-separated prefixes). If set, all paths must start with an allowed prefix
- **Elevation Pre-approval**: `SESSION_CONFIG.elevationWhitelist` can pre-approve tools for UAC bypass in automation contexts

## Development Workflows

### Build & Run
```bash
npm install                    # Install deps (note: ffi-napi must be installed manually on Windows)
npm run build                  # Compile src/ → dist/
npm start                      # Build + run in stdio mode
npm run start:http             # HTTP server on port 3000
npm run dev                    # ts-node src/ directly (hot reload, no build)
```

### Testing & Validation
```bash
node test_tools.js list                        # Show all tools & schemas
node test_tools.js schema file.read            # Show schema for single tool
node test_tools.js call system.info '{}'       # Execute tool with args
node test_tools.js interactive                 # Interactive CLI mode
node test_tools.js test                        # Verify safe read-only tools
```

### Adding a New Tool
1. Create `src/tools/my_tool.ts` with `ToolModule` export and self-registration
2. Add one import line to [../src/tools/index.ts](../src/tools/index.ts)
3. (Optional) Create `config/tsds/my_tool.json` for execution policies
4. `npm run build` and test with `node test_tools.js schema my_tool.operation`

## Integration: Transports

All transports ([../src/transports/](../src/transports/)) expose the same registry as a service:
- **stdio.ts**: MCP protocol over stdin/stdout. Default mode. Suitable for LM Studio integration.
- **http.ts**: Express server on port 3000 (or CLI --port). Endpoints: POST `/mcp/tools/list`, POST `/mcp/tools/invoke`
- **sse.ts**: Server-sent events. Streaming results for long-running tasks.

## Agent Tool Integration

[../src/tools/agent_orchestrator.ts](../src/tools/agent_orchestrator.ts) provides `agent.execute_query`: accepts natural language queries and uses a local LLM (LM Studio or Qwen/OAuth) to autonomously plan and execute multi-step tool sequences. Qwen integration is enabled by default; falls back to LM Studio if Qwen unavailable.

## Key Conventions & Patterns

1. **No DTOs defined in tool modules**—all types come from `../src/core/types.ts`
2. **Validation happens in three layers**: OpenAI schema (ingress), TSD stricter schema, pre-hook custom logic
3. **Rate limiting is per-tool, in-memory, with automatic cleanup** every 60s to prevent memory leaks
4. **Retry policies are deterministic**—error code matching, exponential backoff, per-attempt timeouts
5. **Hooks resolve via string name first, then dynamic require with whitelist fallback**
6. **All file paths are normalized** and sandboxed before I/O
7. **Tool names use dot notation** (e.g., `file.read`, `window.list`, `process.start`)

## Common Debugging Scenarios

- **Tool not found**: Check [../src/tools/index.ts](../src/tools/index.ts) has the import; verify tool module calls `registry.register()`
- **Validation failed**: Check both OpenAI schema in module and TSD's stricter `inputSchema`
- **Elevation prompts unexpectedly**: Verify tool's TSD `elevationRequired` setting and SESSION_CONFIG whitelist
- **Memory grows unbounded**: Check tool's rate limit cleanup is running (default every 60s); review rate limit cache size
- **Parser returns no invocations**: Set `modelSupportsToolCallTags` explicitly in SESSION_CONFIG (true/false) or verify model output format matches expected parser mode
- **Timeout errors on valid operations**: Increase `globalTimeoutMs` in SESSION_CONFIG or per-tool `timeoutMs` in TSD
