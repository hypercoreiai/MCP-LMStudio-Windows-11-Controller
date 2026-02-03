/**
 * test_tools.js
 * 
 * Interactive tool testing script for MCP Win11 Desktop Controller.
 * Run this to test individual tools and see their schemas.
 * 
 * Usage:
 *   node test_tools.js list                           # List all available tools
 *   node test_tools.js schema <tool_name>             # Show schema for a specific tool
 *   node test_tools.js call <tool_name> <args_json>   # Call a tool with arguments
 * 
 * Examples:
 *   node test_tools.js list
 *   node test_tools.js schema file.read
 *   node test_tools.js call system.info '{}'
 *   node test_tools.js call file.read '{"path":"C:\\\\temp\\\\test.txt"}'
 */

const readline = require('readline');
const { spawn } = require('child_process');

// Parse command line arguments
const command = process.argv[2];
const arg1 = process.argv[3];
const arg2 = process.argv[4];

// ANSI colors for output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
};

function printHelp() {
  console.log(`
${colors.bright}MCP Win11 Desktop Controller - Tool Testing Utility${colors.reset}

${colors.cyan}Commands:${colors.reset}
  ${colors.green}list${colors.reset}                              List all available tools
  ${colors.green}schema${colors.reset} <tool_name>                Show detailed schema for a tool
  ${colors.green}call${colors.reset} <tool_name> <args_json>      Execute a tool with JSON arguments
  ${colors.green}test${colors.reset}                              Run basic functionality tests for safe, read-only tools
  ${colors.green}interactive${colors.reset}                       Start interactive mode

${colors.cyan}Examples:${colors.reset}
  node test_tools.js list
  node test_tools.js schema file.read
  node test_tools.js schema window.list
  node test_tools.js call system.info '{}'
  node test_tools.js call file.read '{"path":"C:\\\\\\\\temp\\\\\\\\test.txt"}'
  node test_tools.js call window.list '{}'
  node test_tools.js test
  node test_tools.js interactive

${colors.cyan}Tool Categories:${colors.reset}
  ${colors.yellow}File Operations:${colors.reset}      file.read, file.write, file.delete, file.list, etc.
  ${colors.yellow}Window Management:${colors.reset}   window.list, window.focus, window.move, window.close
  ${colors.yellow}Process Control:${colors.reset}     process.list, process.start, process.kill
  ${colors.yellow}Input Simulation:${colors.reset}    input.type, input.key, input.mouse_click
  ${colors.yellow}System Info:${colors.reset}         system.info, system.cpu, system.memory
  ${colors.yellow}Clipboard:${colors.reset}           clipboard.get, clipboard.set
  ${colors.yellow}Display:${colors.reset}             display.list, display.screenshot
  ${colors.yellow}Registry:${colors.reset}            registry.read, registry.write
  ${colors.yellow}Scheduled Tasks:${colors.reset}     task.list, task.create
`);
}

// Send JSON-RPC request to stdio server
function sendJsonRpc(method, params = {}) {
  return new Promise((resolve, reject) => {
    const server = spawn('node', ['dist/core/server.js', '--transport', 'stdio'], {
      cwd: __dirname,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let responseData = '';
    let errorData = '';
    let resolved = false;
    let initResponseReceived = false;

    server.stdout.on('data', (data) => {
      responseData += data.toString();
      const lines = responseData.split('\n');
      
      // Process complete JSON lines
      for (let i = 0; i < lines.length - 1; i++) {
        const line = lines[i].trim();
        // Only process lines that look like JSON-RPC responses (have jsonrpc field)
        if (line && line.startsWith('{') && line.includes('"jsonrpc"')) {
          try {
            const response = JSON.parse(line);
            // For tools/list and tools/call, we need to skip the initialize response
            // The initialize response has protocolVersion, the real response has tools or results
            if (method === 'tools/list' && response.result && response.result.tools) {
              if (!resolved) {
                resolved = true;
                server.kill();
                resolve(response);
              }
            } else if (method === 'tools/call' && response.result && response.result.content) {
              if (!resolved) {
                resolved = true;
                server.kill();
                resolve(response);
              }
            } else if (method !== 'tools/list' && method !== 'tools/call') {
              // For other methods, resolve with any response
              if (!resolved) {
                resolved = true;
                server.kill();
                resolve(response);
              }
            }
          } catch (e) {
            // Not valid JSON, might be log output
          }
        }
      }
      responseData = lines[lines.length - 1];
    });

    server.stderr.on('data', (data) => {
      errorData += data.toString();
    });

    server.on('error', (err) => {
      if (!resolved) {
        resolved = true;
        reject(err);
      }
    });

    server.on('close', (code) => {
      if (!resolved) {
        resolved = true;
        if (code !== 0) {
          reject(new Error(`Server exited with code ${code}\n${errorData}`));
        } else {
          reject(new Error('Server closed without response'));
        }
      }
    });

    // Send initialize for MCP protocol (required before tools/list or tools/call)
    if (method === 'tools/list' || method === 'tools/call') {
      const initRequest = {
        jsonrpc: '2.0',
        id: Date.now() - 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'test_tools', version: '1.0' }
        }
      };
      server.stdin.write(JSON.stringify(initRequest) + '\n');
    }
    
    // Send the actual request
    const request = {
      jsonrpc: '2.0',
      id: Date.now(),
      method,
      params
    };
    
    server.stdin.write(JSON.stringify(request) + '\n');
    
    // Don't close stdin immediately - let the server keep running until response
    // Close stdin only after a long timeout (60 seconds) or when we get a response
    const stdinTimeout = setTimeout(() => {
      if (!resolved) {
        server.stdin.end();
      }
    }, 60000); // 60 second timeout for long-running operations
    
    // Clean up timeout when we resolve
    const originalResolve = resolve;
    resolve = (val) => {
      clearTimeout(stdinTimeout);
      originalResolve(val);
    };
  });
}

async function listTools() {
  console.log(`${colors.bright}Fetching available tools...${colors.reset}\n`);
  
  try {
    const response = await sendJsonRpc('tools/list');
    
    if (response.error) {
      console.error(`${colors.red}Error:${colors.reset}`, response.error.message);
      return;
    }

    const tools = response.result.tools;
    console.log(`${colors.green}${tools.length} tools available:${colors.reset}\n`);
    
    // Group by category (prefix before dot)
    const categories = {};
    tools.forEach(tool => {
      const [category] = tool.name.split('.');
      if (!categories[category]) categories[category] = [];
      categories[category].push(tool);
    });

    // Display by category
    Object.entries(categories).forEach(([category, categoryTools]) => {
      console.log(`${colors.yellow}${category.toUpperCase()}:${colors.reset}`);
      categoryTools.forEach(tool => {
        console.log(`  ${colors.cyan}${tool.name.padEnd(30)}${colors.reset} ${colors.dim}${tool.description.substring(0, 60)}...${colors.reset}`);
      });
      console.log();
    });

    console.log(`${colors.dim}Use 'node test_tools.js schema <tool_name>' to see details${colors.reset}`);
  } catch (err) {
    console.error(`${colors.red}Error:${colors.reset}`, err.message);
  }
}

async function showSchema(toolName) {
  console.log(`${colors.bright}Fetching schema for: ${toolName}${colors.reset}\n`);
  
  try {
    const response = await sendJsonRpc('tools/list');
    
    if (response.error) {
      console.error(`${colors.red}Error:${colors.reset}`, response.error.message);
      return;
    }

    const tool = response.result.tools.find(t => t.name === toolName);
    
    if (!tool) {
      console.error(`${colors.red}Tool not found:${colors.reset} ${toolName}`);
      console.log(`\n${colors.dim}Use 'node test_tools.js list' to see available tools${colors.reset}`);
      return;
    }

    console.log(`${colors.green}Tool:${colors.reset} ${colors.bright}${tool.name}${colors.reset}`);
    console.log(`${colors.green}Description:${colors.reset} ${tool.description}\n`);
    
    console.log(`${colors.cyan}Parameters:${colors.reset}`);
    const props = tool.inputSchema.properties;
    const required = tool.inputSchema.required || [];
    
    if (Object.keys(props).length === 0) {
      console.log(`  ${colors.dim}(no parameters required)${colors.reset}`);
    } else {
      Object.entries(props).forEach(([name, prop]) => {
        const isRequired = required.includes(name);
        const reqBadge = isRequired ? `${colors.red}*required${colors.reset}` : `${colors.dim}optional${colors.reset}`;
        console.log(`  ${colors.yellow}${name}${colors.reset} (${prop.type}) ${reqBadge}`);
        console.log(`    ${colors.dim}${prop.description}${colors.reset}`);
        if (prop.enum) {
          console.log(`    ${colors.dim}Allowed: ${prop.enum.join(', ')}${colors.reset}`);
        }
        if (prop.default !== undefined) {
          console.log(`    ${colors.dim}Default: ${JSON.stringify(prop.default)}${colors.reset}`);
        }
      });
    }

    console.log(`\n${colors.cyan}Example call:${colors.reset}`);
    const exampleArgs = {};
    Object.entries(props).forEach(([name, prop]) => {
      if (required.includes(name)) {
        if (prop.type === 'string') {
          exampleArgs[name] = prop.enum ? prop.enum[0] : `<${name}>`;
        } else if (prop.type === 'number') {
          exampleArgs[name] = 0;
        } else if (prop.type === 'boolean') {
          exampleArgs[name] = false;
        } else {
          exampleArgs[name] = null;
        }
      }
    });
    
    const argsJson = JSON.stringify(exampleArgs, null, 2).replace(/\n/g, '\\n').replace(/"/g, '\\"');
    console.log(`  node test_tools.js call ${toolName} '${JSON.stringify(exampleArgs)}'`);
    
  } catch (err) {
    console.error(`${colors.red}Error:${colors.reset}`, err.message);
  }
}

async function callTool(toolName, argsStr) {
  console.log(`${colors.bright}Calling tool: ${toolName}${colors.reset}\n`);
  
  let args;
  try {
    args = JSON.parse(argsStr);
  } catch (e) {
    console.error(`${colors.red}Invalid JSON arguments:${colors.reset}`, e.message);
    console.log(`${colors.dim}Provide arguments as JSON string, e.g.: '{"path":"C:\\\\\\\\temp\\\\\\\\file.txt"}'${colors.reset}`);
    return;
  }

  console.log(`${colors.cyan}Arguments:${colors.reset}`, JSON.stringify(args, null, 2));
  console.log();

  try {
    const response = await sendJsonRpc('tools/call', {
      tool: toolName,
      arguments: args
    });
    
    if (response.error) {
      console.error(`${colors.red}RPC Error:${colors.reset}`, response.error);
      return;
    }

    const result = response.result;
    
    if (result.content && result.content[0] && result.content[0].type === 'text') {
      // Parse the JSON string in the text
      const parsedResult = JSON.parse(result.content[0].text);
      if (parsedResult.type === 'success') {
        console.log(`${colors.green}✓ Success${colors.reset}\n`);
        parsedResult.results.forEach(r => {
          console.log(`${colors.cyan}Tool:${colors.reset} ${r.tool}`);
          console.log(`${colors.cyan}Duration:${colors.reset} ${r.result.durationMs}ms`);
          
          if (r.result.success) {
            console.log(`${colors.green}Result:${colors.reset}`);
            console.log(JSON.stringify(r.result.data, null, 2));
          } else {
            console.log(`${colors.red}Error:${colors.reset}`, r.result.error);
          }
        });
      } else if (parsedResult.type === 'error') {
        console.error(`${colors.red}Tool Error:${colors.reset}`, parsedResult.error);
      } else {
        console.log(`${colors.yellow}Result:${colors.reset}`, JSON.stringify(parsedResult, null, 2));
      }
    } else {
      console.log(`${colors.yellow}Result:${colors.reset}`, JSON.stringify(result, null, 2));
    }
    
  } catch (err) {
    console.error(`${colors.red}Error:${colors.reset}`, err.message);
  }
}

async function testAllTools() {
  console.log(`${colors.bright}Testing basic functionality of all tools...${colors.reset}\n`);
  
  // Get list of all tools
  let tools;
  try {
    const response = await sendJsonRpc('tools/list');
    if (response.error) {
      console.error(`${colors.red}Error fetching tools:${colors.reset}`, response.error.message);
      return;
    }
    tools = response.result.tools;
  } catch (err) {
    console.error(`${colors.red}Error:${colors.reset}`, err.message);
    return;
  }

  // Define test cases for each tool (safe, basic tests)
  const testCases = {
    // System info (safe)
    'system.info': {},
    'system.cpu': {},
    'system.memory': {},
    'system.disk': {},
    'system.network': {},
    'system.battery': {},
    'system.services': {},

    // File operations (safe read-only)
    'file.list': { path: '.' },
    'file.properties': { path: 'package.json' },
    'file.search': { path: '.', pattern: 'test' },

    // Window management (safe)
    'window.list': {},

    // Process management (safe)
    'process.list': {},

    // Clipboard (safe read)
    'clipboard.get': {},

    // Display (safe)
    'display.list': {},

    // Registry (safe read)
    'registry.list': { key: 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion' },

    // Tasks (safe)
    'task.list': {},

    // Internet (safe, but may require Firefox)
    'internet.search': { terms: 'test' },

    // Memory (safe read)
    'memory.list': {},

    // VD (safe)
    'vd.list': {},

    // Shell (safe command)
    'shell.execute': { command: 'echo "test"' },

    // Agent (requires LM Studio, skip for basic test)
    // 'agent.execute_query': { query: 'What is 2+2?' },

    // Input, display screenshot, file write/delete, process kill, registry write/delete, task create/delete, window close, clipboard set, internet fetch/scrape, ui click/type - skipped as potentially destructive or requiring setup
  };

  let passed = 0;
  let failed = 0;
  let skipped = 0;

  for (const tool of tools) {
    const toolName = tool.name;
    const testArgs = testCases[toolName];

    if (!testArgs) {
      console.log(`${colors.yellow}⚠ Skipped ${toolName} (no test case defined)${colors.reset}`);
      skipped++;
      continue;
    }

    console.log(`${colors.cyan}Testing ${toolName}...${colors.reset}`);
    
    try {
      const response = await sendJsonRpc('tools/call', {
        tool: toolName,
        arguments: testArgs
      });

      if (response.error) {
        console.log(`  ${colors.red}✗ RPC Error: ${response.error.message}${colors.reset}`);
        failed++;
      } else if (response.result.type === 'error') {
        console.log(`  ${colors.red}✗ Tool Error: ${response.result.error}${colors.reset}`);
        failed++;
      } else {
        console.log(`  ${colors.green}✓ Passed${colors.reset}`);
        passed++;
      }
    } catch (err) {
      console.log(`  ${colors.red}✗ Exception: ${err.message}${colors.reset}`);
      failed++;
    }
  }

  console.log(`\n${colors.bright}Test Results:${colors.reset}`);
  console.log(`${colors.green}Passed: ${passed}${colors.reset}`);
  console.log(`${colors.red}Failed: ${failed}${colors.reset}`);
  console.log(`${colors.yellow}Skipped: ${skipped}${colors.reset}`);
  console.log(`Total: ${passed + failed + skipped}`);
}

async function interactiveMode() {
  console.log(`${colors.bright}Interactive Tool Testing Mode${colors.reset}`);
  console.log(`${colors.dim}Type 'help' for commands, 'exit' to quit${colors.reset}\n`);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: `${colors.green}mcp>${colors.reset} `
  });

  rl.prompt();

  rl.on('line', async (line) => {
    const parts = line.trim().split(' ');
    const cmd = parts[0];

    if (!cmd) {
      rl.prompt();
      return;
    }

    switch (cmd) {
      case 'exit':
      case 'quit':
        console.log('Goodbye!');
        rl.close();
        process.exit(0);
        break;
      
      case 'help':
        console.log(`
${colors.cyan}Commands:${colors.reset}
  list                    - List all tools
  schema <tool>           - Show tool schema
  call <tool> <json>      - Call a tool
  help                    - Show this help
  exit                    - Exit interactive mode
`);
        break;
      
      case 'list':
        await listTools();
        break;
      
      case 'schema':
        if (parts[1]) {
          await showSchema(parts[1]);
        } else {
          console.log(`${colors.red}Usage:${colors.reset} schema <tool_name>`);
        }
        break;
      
      case 'call':
        if (parts.length >= 3) {
          const toolName = parts[1];
          const argsJson = parts.slice(2).join(' ');
          await callTool(toolName, argsJson);
        } else {
          console.log(`${colors.red}Usage:${colors.reset} call <tool_name> <json_args>`);
        }
        break;
      
      default:
        console.log(`${colors.red}Unknown command:${colors.reset} ${cmd}`);
        console.log(`${colors.dim}Type 'help' for available commands${colors.reset}`);
    }

    rl.prompt();
  });

  rl.on('close', () => {
    process.exit(0);
  });
}

// Main execution
(async () => {
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    printHelp();
  } else if (command === 'list') {
    await listTools();
  } else if (command === 'schema') {
    if (!arg1) {
      console.error(`${colors.red}Error:${colors.reset} Missing tool name`);
      console.log(`${colors.dim}Usage: node test_tools.js schema <tool_name>${colors.reset}`);
      process.exit(1);
    }
    await showSchema(arg1);
  } else if (command === 'call') {
    if (!arg1 || !arg2) {
      console.error(`${colors.red}Error:${colors.reset} Missing tool name or arguments`);
      console.log(`${colors.dim}Usage: node test_tools.js call <tool_name> <json_args>${colors.reset}`);
      process.exit(1);
    }
    await callTool(arg1, arg2);
  } else if (command === 'test') {
    await testAllTools();
  } else if (command === 'interactive') {
    await interactiveMode();
  } else {
    console.error(`${colors.red}Unknown command:${colors.reset} ${command}`);
    printHelp();
    process.exit(1);
  }
})();
