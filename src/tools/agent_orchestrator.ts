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
# MASTER AUTOMATION ARCHITECT: FIREFOX DOMAIN STRATEGY
You are the planner for a Windows 11 agent. You MUST follow these architectural rules or the strategy will CRASH.

## 🛑 THE LETHAL ERROR: NATIVE UI ON WEBSITES
Native Windows UI tools (ui.list_elements, ui.get_element, etc.) are **STRUCTURALLY BLIND** to website content.
- If you use 'ui.list_elements' on a browser window, you get 0 elements.
- If you use 'ui.get_element' on a web button, it returns PATH_NOT_FOUND.
- This is because Firefox/Chrome use custom rendering engines that bypass the Windows Accessibility API.

### ⚓ THE "WEB-VISION" PROTOCOL (MANDATORY)
To interact with a website (e.g., bank, search engine, login form, twitter/X):
1. **NAVIGATE**: Use 'internet.fetch' or 'internet.search'.
2. **SEE**: Use 'firefox.get_elements' with a CSS selector (e.g., "input[type='password']", "button[aria-label='Like']"). 
   - This is the ONLY tool that sees site elements and interactive buttons.
   - Use it to find coordinates for ANY action (liking, commenting, clicking).
3. **CLICK/TYPE**:
   - Get [x, y] from 'firefox.get_elements'.
   - Use 'input.mouse_click' or 'input.type_into_element' using those EXACT coordinates.

## 🦅 COMPLEX SOCIAL INTERACTIONS (LIKING/COMMENTING)
You can perform ANY action on a website (Twitter/X, Facebook, etc.) by finding the button's coordinates first.
- To **Like a tweet**: Find the "Like" button using 'firefox.get_elements' -> click coordinates.
- To **Comment/Reply**: Find the reply field -> click coordinates -> 'input.type'.
- To **Upvote**: Find the upvote arrow -> click coordinates.

### ❌ FORBIDDEN COMBINATIONS
- Browser + ui.list_elements = CRITICAL FAILURE
- Website + ui.get_element = CRITICAL FAILURE
- Firefox + ui.click_element = CRITICAL FAILURE

### ✅ ALLOWED COMBINATIONS
- Browser + firefox.get_elements = SUCCESS
- Browser + internet.scrape = SUCCESS
- Native App (Notepad/Calc) + ui.list_elements = SUCCESS

## OUTPUT FORMAT
### TASK: [Task Summary]
### STRATEGY:
Step 1: [Action]
- Tool: [tool.name]
- Parameters: { ... }
...
### SUCCESS CRITERIA:
[Confirmation steps]
`;

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

async function handleAgentExecuteQuery(args: Record<string, unknown>): Promise<ToolResult> {
  const query = (args.query as string).toLowerCase();

  if (!query) {
    throw new ExecutionError('agent_orchestrator', 'Query is required');
  }

  log.info({ query }, 'Generating strategy for query');

  // SMART FILTER: Detect if this is likely a browser/web task
  const isWebTask = query.includes('http') || 
                    query.includes('www.') || 
                    query.includes('website') || 
                    query.includes('url') || 
                    query.includes('bank') || 
                    query.includes('login') || 
                    query.includes('sign in') ||
                    query.includes('search') ||
                    query.includes('internet') ||
                    query.includes('browser') ||
                    query.includes('firefox') ||
                    query.includes('chrome') ||
                    query.includes('twitter') ||
                    query.includes(' x ') ||
                    query.includes('x.com') ||
                    query.includes('facebook') ||
                    query.includes('reddit') ||
                    query.includes('social media');

  // Build context about available tools with explicit categorization
  const allTools = registry.list();
  
  const browserTools = allTools.filter(t => t.name.startsWith('firefox.') || t.name.startsWith('internet.'));
  const windowTools = allTools.filter(t => t.name.startsWith('window.'));
  const nativeUiTools = allTools.filter(t => t.name.startsWith('ui.'));
  const inputTools = allTools.filter(t => t.name.startsWith('input.'));
  const otherTools = allTools.filter(t => 
    !t.name.startsWith('firefox.') && 
    !t.name.startsWith('internet.') && 
    !t.name.startsWith('ui.') && 
    !t.name.startsWith('window.') &&
    !t.name.startsWith('input.')
  );

  log.info({ 
    isWebTask,
    browserToolCount: browserTools.length, 
    nativeUiCount: nativeUiTools.length 
  }, 'Tools categorized for agent');

  // PHYSICAL LOGGING FOR DEBUGGING
  if (isWebTask) {
    console.log(`[AGENT] Web Task Detected: "${query}"`);
  }

  // Helper to format tools for the text prompt
  const formatTool = (t: OpenAIFunctionSchema) => {
    const params = Object.keys(t.parameters.properties || {}).join(', ');
    return `- ${t.name}(${params}): ${t.description}`;
  };

  let toolList = [
    "=== CATEGORY A: WEBPAGE INTERACTION (MANDATORY FOR SITE CONTENT) ===",
    ...browserTools.map(formatTool),
    
    "\n=== CATEGORY B: WINDOW MANAGEMENT (FOR FINDING THE BROWSER WINDOW) ===",
    ...windowTools.map(formatTool),

    "\n=== CATEGORY C: GLOBAL INPUT (FOR TYPING/CLICKING COORDINATES) ===",
    ...inputTools.map(formatTool),

    "\n=== CATEGORY D: SYSTEM UTILITIES ===",
    ...otherTools.map(formatTool)
  ];

  // If it's a web task, we aggressively warn or even hide native UI tools
  if (isWebTask) {
    toolList.push("\n### 🛑 ARCHITECTURAL BLOCKER: NATIVE UI TOOLS REMOVED ###");
    toolList.push("The 'ui.*' tools (like ui.list_elements) have been PHYSICALLY REMOVED from the available toolset for this task because they cannot see inside browsers.");
    toolList.push("YOU MUST USE 'firefox.get_elements' to find coordinates on websites.");
    // We don't even map the native tools here anymore
  } else {
    toolList.push("\n=== CATEGORY E: NATIVE UI TOOLS (ONLY FOR LOCAL WINDOWS APPS) ===");
    toolList.push(...nativeUiTools.map(formatTool));
  }

  const toolListStr = toolList.join('\n');

  const messages: LLMMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: `Task: ${query}\n\nList of Available Tools:\n${toolListStr}\n\nRemember: If you need to "see" a button on a website, you MUST use firefox.get_elements to get its [x,y], then input.mouse_click to click it. ui.get_element will FAIL.` },
  ];

  // Call LLM to generate strategy
  let { content } = await callLLM(messages, []);

  // HARD ENFORCEMENT: Loop up to 2 times to strip out hallucinations
  let retryCount = 0;
  while (retryCount < 2 && isWebTask && /ui\.(list_elements|get_element|click_element|type_into_element|wait_for_element)/i.test(content)) {
    console.log(`[AGENT] Detected UI tool hallucination in web task. Attempting correction ${retryCount + 1}...`);
    log.warn({ retryCount, content: content.substring(0, 500) }, 'LLM hallucinated native UI tools for a web task. Retrying with explicit correction.');
    
    const retryMessages: LLMMessage[] = [
      ...messages,
      { role: 'assistant', content: content },
      { 
        role: 'user', 
        content: "CRITICAL REJECTION: Your strategy uses 'ui.*' tools (like ui.list_elements). These tools CANNOT see inside the browser. They will fail. You MUST rewrite the entire strategy using 'firefox.get_elements' to find coordinates, and 'input.mouse_click' or 'input.type_into_element' to interact with the page. Coordinates are the only way. Do not use any 'ui.' tools."
      }
    ];
    
    const retryResult = await callLLM(retryMessages, []);
    content = retryResult.content;
    retryCount++;
  }

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