/**
 * tools/agent_orchestrator.ts
 *
 * Provides strategic planning for desktop automation tasks.
 * Converts natural language queries into detailed execution strategies
 * that a local LLM can follow using available MCP tools.
 *
 * Uses Qwen LLM for strategy generation. Does NOT execute tools directly.
 */

import { ToolModule, ToolResult, OpenAIFunctionSchema } from '../core/types';
import { registry } from '../core/registry';
import { ExecutionError } from '../core/errors';
import { scopedLogger } from '../core/logger';
import { promises as fs } from 'fs';
import { join } from 'path';
import { createHash, randomBytes, randomUUID } from 'crypto';

const log = scopedLogger('tools/agent_orchestrator');

// ---------------------------------------------------------------------------
// LLM Integration
// ---------------------------------------------------------------------------

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'dummy'; // Not required for local LM Studio
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || 'http://localhost:11000/v1'; // Default to LM Studio local endpoint
const MODEL = process.env.AGENT_MODEL || 'local-model'; // Default to a local model name

// Qwen OAuth configuration
const QWEN_BASE_URL = process.env.QWEN_BASE_URL || 'https://portal.qwen.ai/v1';
const QWEN_MODEL = process.env.QWEN_MODEL || 'coder-model';
const QWEN_CLIENT_ID = 'f0304373b74a44d2b584a3fb70ca9e56';
const QWEN_OAUTH_BASE_URL = 'https://chat.qwen.ai';
const QWEN_DEVICE_CODE_ENDPOINT = `${QWEN_OAUTH_BASE_URL}/api/v1/oauth2/device/code`;
const QWEN_TOKEN_ENDPOINT = `${QWEN_OAUTH_BASE_URL}/api/v1/oauth2/token`;
const QWEN_SCOPE = 'openid profile email model.completion';
const QWEN_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:device_code';

// Use Qwen if explicitly enabled - default to true if USE_QWEN not set
const USE_QWEN = process.env.USE_QWEN !== 'false'; // Default to true

log.info({ 
  USE_QWEN, 
  QWEN_MODEL, 
  QWEN_BASE_URL,
  envVars: {
    USE_QWEN: process.env.USE_QWEN,
    QWEN_MODEL: process.env.QWEN_MODEL,
    QWEN_BASE_URL: process.env.QWEN_BASE_URL
  }
}, 'Agent orchestrator initialized');

interface QwenOAuthToken {
  access: string;
  refresh: string;
  expires: number;
  resourceUrl?: string;
}

interface QwenPendingAuth {
  verifier: string;
  deviceAuth: any;
  expiresAt: number;
}

interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

// ---------------------------------------------------------------------------
// Qwen OAuth Functions
// ---------------------------------------------------------------------------

const MEMORY_DIR = join(process.cwd(), 'memories');
const QWEN_TOKEN_KEY = 'qwen_oauth_token';
const QWEN_PENDING_AUTH_KEY = 'qwen_pending_auth';

async function ensureMemoryDir(): Promise<void> {
  try {
    await fs.mkdir(MEMORY_DIR, { recursive: true });
  } catch (e) {
    log.warn({ error: e }, 'Failed to create memories directory');
  }
}

async function loadQwenToken(): Promise<QwenOAuthToken | null> {
  try {
    await ensureMemoryDir();
    const filePath = join(MEMORY_DIR, `${QWEN_TOKEN_KEY}.json`);
    const data = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(data);
  } catch {
    return null;
  }
}

async function saveQwenToken(token: QwenOAuthToken): Promise<void> {
  try {
    await ensureMemoryDir();
    const filePath = join(MEMORY_DIR, `${QWEN_TOKEN_KEY}.json`);
    await fs.writeFile(filePath, JSON.stringify(token, null, 2));
  } catch (e) {
    log.error({ error: e }, 'Failed to save Qwen token');
  }
}

async function loadPendingAuth(): Promise<QwenPendingAuth | null> {
  try {
    await ensureMemoryDir();
    const filePath = join(MEMORY_DIR, `${QWEN_PENDING_AUTH_KEY}.json`);
    const data = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(data);
  } catch {
    return null;
  }
}

async function savePendingAuth(pending: QwenPendingAuth): Promise<void> {
  try {
    await ensureMemoryDir();
    const filePath = join(MEMORY_DIR, `${QWEN_PENDING_AUTH_KEY}.json`);
    await fs.writeFile(filePath, JSON.stringify(pending, null, 2));
  } catch (e) {
    log.error({ error: e }, 'Failed to save pending auth');
  }
}

async function clearPendingAuth(): Promise<void> {
  try {
    const filePath = join(MEMORY_DIR, `${QWEN_PENDING_AUTH_KEY}.json`);
    await fs.unlink(filePath);
  } catch {
    // Ignore if file doesn't exist
  }
}

function toFormUrlEncoded(data: Record<string, string>): string {
  return Object.entries(data)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
}

function generatePkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

async function requestDeviceCode(challenge: string): Promise<any> {
  const response = await fetch(QWEN_DEVICE_CODE_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      'x-request-id': randomUUID(),
    },
    body: toFormUrlEncoded({
      client_id: QWEN_CLIENT_ID,
      scope: QWEN_SCOPE,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new ExecutionError('agent_orchestrator', `Qwen device authorization failed: ${text || response.statusText}`);
  }

  const payload: any = await response.json();
  if (!payload.device_code || !payload.user_code || !payload.verification_uri) {
    throw new ExecutionError('agent_orchestrator', 'Qwen device authorization returned incomplete payload');
  }
  return payload;
}

async function pollDeviceToken(deviceCode: string, verifier: string): Promise<QwenOAuthToken | null> {
  const response = await fetch(QWEN_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: toFormUrlEncoded({
      grant_type: QWEN_GRANT_TYPE,
      client_id: QWEN_CLIENT_ID,
      device_code: deviceCode,
      code_verifier: verifier,
    }),
  });

  if (!response.ok) {
    const payload: any = await response.json().catch(() => ({}));
    if (payload.error === 'authorization_pending') {
      return null; // Still waiting
    }
    if (payload.error === 'slow_down') {
      return null; // Still waiting, slow down
    }
    throw new ExecutionError('agent_orchestrator', `Qwen OAuth failed: ${payload.error_description || payload.error || response.statusText}`);
  }

  const tokenPayload: any = await response.json();
  if (!tokenPayload.access_token || !tokenPayload.refresh_token || !tokenPayload.expires_in) {
    throw new ExecutionError('agent_orchestrator', 'Qwen OAuth returned incomplete token payload');
  }

  return {
    access: tokenPayload.access_token,
    refresh: tokenPayload.refresh_token,
    expires: Date.now() + tokenPayload.expires_in * 1000,
    resourceUrl: tokenPayload.resource_url,
  };
}

async function refreshQwenToken(refreshToken: string): Promise<QwenOAuthToken | null> {
  const response = await fetch(QWEN_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: toFormUrlEncoded({
      grant_type: 'refresh_token',
      client_id: QWEN_CLIENT_ID,
      refresh_token: refreshToken,
    }),
  });

  if (!response.ok) {
    log.warn({ status: response.status }, 'Qwen token refresh failed');
    return null;
  }

  const tokenPayload: any = await response.json();
  if (!tokenPayload.access_token || !tokenPayload.refresh_token || !tokenPayload.expires_in) {
    log.warn('Qwen refresh returned incomplete token payload');
    return null;
  }

  return {
    access: tokenPayload.access_token,
    refresh: tokenPayload.refresh_token,
    expires: Date.now() + tokenPayload.expires_in * 1000,
    resourceUrl: tokenPayload.resource_url,
  };
}

async function getValidQwenToken(): Promise<QwenOAuthToken | null> {
  let token = await loadQwenToken();

  if (!token) {
    const now = Date.now();
    let verifier: string;
    let deviceAuth: any;

    const pendingAuth = await loadPendingAuth();
    if (pendingAuth && pendingAuth.expiresAt > now) {
      ({ verifier, deviceAuth } = pendingAuth);
      log.info('Reusing pending Qwen OAuth device code...');
    } else {
      log.info('No Qwen token found, starting OAuth flow...');
      const pkce = generatePkce();
      verifier = pkce.verifier;
      deviceAuth = await requestDeviceCode(pkce.challenge);
      const newPending = {
        verifier,
        deviceAuth,
        expiresAt: now + (deviceAuth.expires_in ?? 600) * 1000,
      };
      await savePendingAuth(newPending);
    }

    // Check immediately if already authorized (fast path)
    token = await pollDeviceToken(deviceAuth.device_code, verifier);
    if (token) {
      await saveQwenToken(token!);
      await clearPendingAuth();
      log.info('Qwen OAuth successful (already authorized)');
    } else {
      // Not authorized yet - return pending message without blocking
      throw new ExecutionError(
        'agent_orchestrator',
        `Qwen OAuth pending. Please:\n` +
          `1. Open this URL: ${deviceAuth.verification_uri_complete || deviceAuth.verification_uri}\n` +
          `2. Enter this code: ${deviceAuth.user_code}\n` +
          `3. Run the query again after authorization\n` +
          `\nThis device code will remain valid for ${Math.floor((deviceAuth.expires_in ?? 600) / 60)} minutes.`,
      );
    }
  }

  // Check if token is expired or will expire soon (within 5 minutes)
  if (token.expires < Date.now() + 5 * 60 * 1000) {
    log.info('Qwen token expired or expiring soon, refreshing...');
    const refreshedToken = await refreshQwenToken(token.refresh);
    if (refreshedToken) {
      token = refreshedToken;
      await saveQwenToken(token);
    } else {
      // Refresh failed, clear token and try OAuth again
      await saveQwenToken({} as any); // Clear invalid token
      return getValidQwenToken(); // Recursive call to restart OAuth
    }
  }

  return token;
}

async function callLLM(messages: LLMMessage[], tools: OpenAIFunctionSchema[]): Promise<{ content: string; toolCalls: ToolCall[] }> {
  if (USE_QWEN) {
    // Use Qwen API
    log.debug({ USE_QWEN }, 'Qwen enabled, getting token');
    
    const token = await getValidQwenToken();
    if (!token) {
      throw new ExecutionError('agent_orchestrator', 'Failed to obtain Qwen OAuth token');
    }

    log.debug({ token: { access: token.access?.substring(0, 20), resourceUrl: token.resourceUrl, expires: token.expires } }, 'Token retrieved');

    let baseUrl = QWEN_BASE_URL;
    if (token.resourceUrl) {
      const resourceUrl = token.resourceUrl.startsWith('http') 
        ? token.resourceUrl 
        : `https://${token.resourceUrl}`;
      baseUrl = `${resourceUrl}/v1`;
      log.debug({ baseUrl }, 'Using resourceUrl-based URL');
    }

    const url = `${baseUrl}/chat/completions`;
    log.info({ url, model: QWEN_MODEL, tokenExpires: new Date(token.expires).toISOString() }, 'Calling Qwen API');

    // Retry logic for transient network failures
    let lastError: any;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        log.debug({ url, attempt }, 'Fetch attempt');
        
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

        const requestBody: any = {
          model: QWEN_MODEL,
          messages,
          max_tokens: 4096,
        };

        // Only include tools if provided and non-empty
        if (tools && tools.length > 0) {
          requestBody.tools = tools.map(tool => ({
            type: 'function',
            function: tool,
          }));
          requestBody.tool_choice = 'auto';
        }

        log.debug({ bodySize: JSON.stringify(requestBody).length }, 'Request body prepared');

        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token.access}`,
          },
          body: JSON.stringify(requestBody),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const errorText = await response.text();
          throw new ExecutionError('agent_orchestrator', `Qwen API error: ${response.status} ${response.statusText} - ${errorText}`);
        }

        const data: any = await response.json();
        const choice = data.choices[0];
        const content = choice.message.content || '';
        const toolCalls = choice.message.tool_calls || [];

        log.info({ contentLength: content.length, toolCallCount: toolCalls.length }, 'Qwen API response received');

        return { content, toolCalls };
      } catch (error: any) {
        lastError = error;
        if (error.name === 'AbortError') {
          log.warn({ attempt }, 'Qwen API request timed out');
          if (attempt < 3) {
            await new Promise(resolve => setTimeout(resolve, 1000 * attempt)); // Exponential backoff
            continue;
          }
          throw new ExecutionError('agent_orchestrator', 'Qwen API request timed out after 30 seconds (all retries exhausted)');
        }
        
        log.warn({ attempt, error: error.message }, 'Network error, will retry');
        if (attempt < 3) {
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt)); // Exponential backoff
          continue;
        }
      }
    }
    
    // All retries failed
    log.error({ lastError, errorMessage: lastError?.message }, 'All fetch attempts failed');
    throw new ExecutionError('agent_orchestrator', `Qwen API network error after 3 attempts: ${lastError?.message}`);
  } else {
    // Use OpenAI-compatible API (local LM Studio or similar)
    log.info({ OPENAI_BASE_URL, MODEL }, 'Using OpenAI-compatible API');
    
    let lastError: any;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const response = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(OPENAI_API_KEY && OPENAI_API_KEY !== 'dummy' && { 'Authorization': `Bearer ${OPENAI_API_KEY}` }),
          },
          body: JSON.stringify({
            model: MODEL,
            messages,
            tools: tools.map(tool => ({
              type: 'function',
              function: tool,
            })),
            tool_choice: 'auto',
            max_tokens: 4096,
          }),
        });

        if (!response.ok) {
          const errorText = await response.text().catch(() => 'Unknown error');
          throw new ExecutionError('agent_orchestrator', `LLM API error: ${response.status} ${response.statusText} - ${errorText}`);
        }

        const data: any = await response.json();
        const choice = data.choices[0];
        const content = choice.message.content || '';
        const toolCalls = choice.message.tool_calls || [];

        return { content, toolCalls };
      } catch (error: any) {
        lastError = error;
        log.warn({ attempt, error: error.message }, 'OpenAI-compatible API error, will retry');
        if (attempt < 3) {
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt)); // Exponential backoff
          continue;
        }
      }
    }
    
    const errorMsg = lastError?.message || 'Unknown error';
    throw new ExecutionError('agent_orchestrator', 
      `LLM API unavailable after 3 attempts: ${errorMsg}. Ensure either: 1) Qwen OAuth is configured (USE_QWEN=true), or 2) LM Studio is running at ${OPENAI_BASE_URL}`);
  }
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `
You are a strategic planning AI that converts natural language task requests into detailed, step-by-step execution strategies for Windows 11 desktop automation. 

Your role is NOT to execute tools directly, but to generate a clear plan that a local LLM can follow using available MCP tools.

## Your Task

Given a user request, generate a detailed strategy document with:

1. **Task Analysis**: What the user wants to accomplish
2. **Step-by-Step Plan**: Sequential instructions the local LLM should follow
3. **Tool Recommendations**: Which specific tools to use for each step
4. **Expected Outcomes**: What should happen at each step
5. **Error Handling**: Alternative approaches if a step fails

## Available Tool Categories

**Window Management**: window.list, window.focus, window.move, window.resize, window.close, window.snap, window.minimize, window.maximize, window.restore
**File Operations**: file.read, file.write, file.copy, file.move, file.delete, file.list, file.search, file.open, file.properties
**Process Control**: process.list, process.start, process.kill, process.wait, process.run
**Input Simulation**: input.type, input.key, input.mouse_click, input.mouse_drag, input.mouse_scroll, input.hotkey
**Clipboard**: clipboard.get, clipboard.set, clipboard.clear
**Display**: display.list, display.screenshot, display.set_resolution, display.set_dpi, display.set_brightness
**Registry**: registry.read, registry.write, registry.delete, registry.list, registry.export
**System Info**: system.info, system.cpu, system.memory, system.disk, system.network, system.battery, system.services
**Internet**: internet.fetch, internet.search, internet.scrape, internet.scrape.visual
**UI Automation**: ui.list_elements, ui.get_element, ui.click_element, ui.type_into_element
**Memory**: memory.save, memory.load, memory.list, memory.delete
**Virtual Desktop**: vdm.create, vdm.remove, vdm.switch, vdm.list
**Shell**: shell.execute

## Output Format

Provide your strategy in this structure:

### TASK: [Brief description of what needs to be accomplished]

### STRATEGY:
Step 1: [Action description]
- Tool: [tool.name]
- Parameters: { "key": "value" }
- Expected Result: [What should happen]

Step 2: [Action description]
- Tool: [tool.name]
- Parameters: { "key": "value" }
- Expected Result: [What should happen]

[Continue for all steps...]

### ALTERNATIVES:
- If [specific condition], then [alternative approach]

### SUCCESS CRITERIA:
[How to verify the task completed successfully]

## Example

User Request: "Open Notepad and write a short story"

### TASK: Launch Notepad application and enter creative text content

### STRATEGY:
Step 1: Launch Notepad application
- Tool: process.start
- Parameters: { "command": "notepad.exe" }
- Expected Result: Notepad window appears in foreground

Step 2: Wait for application to be ready
- Tool: process.wait
- Parameters: { "processName": "notepad", "timeout": 5000 }
- Expected Result: Notepad is fully loaded and responsive

Step 3: Focus Notepad window
- Tool: window.focus
- Parameters: { "title": "Untitled - Notepad" }
- Expected Result: Notepad becomes active window

Step 4: Type the story content
- Tool: input.type
- Parameters: { "text": "Once upon a time in a digital realm, an AI learned to help humans accomplish their tasks with precision and care. The end." }
- Expected Result: Text appears in Notepad

### ALTERNATIVES:
- If Notepad doesn't launch, use process.run with full path: C:\\Windows\\System32\\notepad.exe
- If window focus fails, use input.hotkey with "Alt+Tab" to cycle to Notepad

### SUCCESS CRITERIA:
- Notepad application is running (visible in process.list)
- Story text is visible in the Notepad window
- No error messages or crashes occurred

Remember: You are generating instructions for another AI to follow, not executing them yourself. Be specific, clear, and comprehensive in your planning.
`;

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

async function handleAgentExecuteQuery(args: Record<string, unknown>): Promise<ToolResult> {
  const query = args.query as string;

  if (!query) {
    throw new ExecutionError('agent_orchestrator', 'Query is required');
  }

  log.info({ query }, 'Generating strategy for query');

  // Build context about available tools
  const allTools = registry.list();
  const toolList = allTools.map(t => `- ${t.name}: ${t.description}`).join('\n');

  const messages: LLMMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: `Available Tools:\n${toolList}\n\nUser Request: ${query}\n\nPlease generate a detailed execution strategy.` },
  ];

  // Call LLM to generate strategy (without tool definitions - we don't want it to make tool calls)
  const { content } = await callLLM(messages, []);

  log.info('Strategy generated successfully');

  return { 
    success: true, 
    data: { 
      strategy: content,
      query: query
    }, 
    durationMs: 0 
  };
}

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

const agentOrchestrator: ToolModule = {
  name: 'agent_orchestrator',

  tools: [
    {
      name: 'agent.execute_query',
      description: 'Convert a natural language task request into a detailed execution strategy that a local LLM can follow. Returns step-by-step instructions with tool recommendations, not direct execution.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Natural language description of the task to plan' }
        },
        required: ['query']
      }
    }
  ],

  async execute(toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
    log.debug({ toolName, args }, 'Executing');

    switch (toolName) {
      case 'agent.execute_query': return handleAgentExecuteQuery(args);
      default:
        throw new ExecutionError('agent_orchestrator', `Unknown tool: ${toolName}`);
    }
  }
};

// Self-register
registry.register(agentOrchestrator);

export default agentOrchestrator;