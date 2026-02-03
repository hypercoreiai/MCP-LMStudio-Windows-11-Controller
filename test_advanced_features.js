/**
 * test_advanced_features.js
 * 
 * Focused regression testing for V2 features:
 * 1. Firefox RDP Bridge (JS Injection & Node Discovery)
 * 2. Annotated Screenshots (Visual Grounding)
 * 3. Strategic Planning (Agent Orchestrator)
 */

const { spawn } = require('child_process');
const path = require('path');

// ANSI colors
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  red: '\x1b[31m',
  cyan: '\x1b[36m'
};

function log(msg, color = colors.reset) {
  console.log(`${color}${msg}${colors.reset}`);
}

async function sendJsonRpc(method, params = {}) {
  return new Promise((resolve, reject) => {
    const server = spawn('node', ['dist/core/server.js', '--transport', 'stdio'], {
      cwd: __dirname,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let responseData = '';
    let timeout = setTimeout(() => {
      server.kill();
      reject(new Error('RPC Timeout'));
    }, 45000); // Higher timeout for complex tools

    server.stdout.on('data', (data) => {
      responseData += data.toString();
      const lines = responseData.split('\n');
      for (const line of lines) {
        if (line.includes('"result"') || line.includes('"error"')) {
          try {
            const resp = JSON.parse(line);
            if (resp.id || resp.jsonrpc) {
              // Extract the actual result from the MCP envelope if necessary
              if (resp.result && resp.result.content && resp.result.content[0]) {
                const inner = JSON.parse(resp.result.content[0].text);
                if (inner.success === true || inner.success === false) {
                  clearTimeout(timeout);
                  server.kill();
                  resolve(inner);
                  return;
                }
              }
              // Normal MCP results or Errors
              if (resp.result || resp.error) {
                 // Keep looking if it's just the init response
                 if (resp.result && resp.result.protocolVersion) continue;
                 clearTimeout(timeout);
                 server.kill();
                 resolve(resp);
                 return;
              }
            }
          } catch (e) {}
        }
      }
    });

    server.stdin.write(JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: method,
      params: params
    }) + '\n');
  });
}

async function runTests() {
  log('Starting Advanced Feature Validation (V2 Architecture)\n', colors.bright);

  let passed = 0;
  let total = 0;

  const runTest = async (name, tool, args, validator) => {
    total++;
    log(`[TEST ${total}] ${name}...`, colors.cyan);
    try {
      const result = await sendJsonRpc('tools/call', { tool, arguments: args });
      if (validator(result)) {
        log('  ✓ PASSED', colors.green);
        passed++;
      } else {
        log('  ✗ FAILED', colors.red);
        console.log(JSON.stringify(result, null, 2));
      }
    } catch (e) {
      log(`  ✗ ERROR: ${e.message}`, colors.red);
    }
  };

  // 1. Firefox RDP Validation
  log('\n--- Firefox RDP Bridge ---', colors.yellow);
  await runTest(
    'Launch Firefox with RDP',
    'internet.fetch',
    { url: 'https://www.google.com' },
    (r) => r.success === true
  );

  await runTest(
    'DOM Element Discovery',
    'firefox.get_elements',
    { selector: 'input' },
    (r) => r.success === true
  );

  // 2. Visual Grounding Validation
  log('\n--- Visual Grounding ---', colors.yellow);
  await runTest(
    'Annotated Screenshot Generation',
    'display.screenshot.annotated',
    { 
      elements: [{ x: 100, y: 100, width: 50, height: 50, name: 'Test Box' }],
      format: 'png'
    },
    (r) => r.success === true && r.data?.imageBase64?.length > 1000
  );

  // 3. Orchestration Strategy Validation
  log('\n--- Agent Orchestrator ---', colors.yellow);
  await runTest(
    'Complex Strategy Generation',
    'agent.execute_query',
    { query: 'Sign into my bank, fill the username "user1" and verify the password field is visible.' },
    (r) => r.success === true && 
           r.data?.strategy?.includes('STRATEGY') && 
           r.data?.strategy?.includes('firefox.get_elements') &&
           !r.data?.strategy?.includes('ui.list_elements')
  );

  log(`\nAdvanced Validation Results: ${passed}/${total} suites passed.`, passed === total ? colors.green : colors.red);
}

runTests().catch(e => log(`FATAL: ${e.message}`, colors.red));
