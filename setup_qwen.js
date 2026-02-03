#!/usr/bin/env node

/**
 * setup_qwen.js
 *
 * Helper script to set up Qwen OAuth integration for the MCP Win11 agent.
 * This script sets the necessary environment variables and tests the setup.
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🔧 Setting up Qwen OAuth integration for MCP Win11 agent...\n');

// Check if .env file exists, create if not
const envPath = path.join(process.cwd(), '.env');
let envContent = '';

if (fs.existsSync(envPath)) {
  envContent = fs.readFileSync(envPath, 'utf-8');
  console.log('📄 Found existing .env file');
} else {
  console.log('📄 Creating new .env file');
}

// Add Qwen configuration to .env
const qwenConfig = `
# Qwen OAuth Configuration
USE_QWEN=true
QWEN_MODEL=qwen3
QWEN_BASE_URL=https://portal.qwen.ai/v1
`;

if (!envContent.includes('USE_QWEN=true')) {
  envContent += qwenConfig;
  fs.writeFileSync(envPath, envContent);
  console.log('✅ Added Qwen configuration to .env');
} else {
  console.log('✅ Qwen configuration already exists in .env');
}

console.log('\n📋 Qwen Setup Complete!');
console.log('\nTo test the integration:');
console.log('1. Run: node test_tools.js call agent.execute_query \'{"query": "What is 2+2?"}\'');
console.log('2. On first run, follow the OAuth prompts in your browser');
console.log('3. The agent will authenticate and cache tokens for future use\n');

console.log('🔑 OAuth tokens will be stored securely in memories/qwen_oauth_token.json');
console.log('🔄 Tokens auto-refresh when they expire\n');

console.log('📚 Available Qwen models:');
console.log('  - qwen3 (default)');
console.log('  - coder-model');
console.log('  - vision-model\n');