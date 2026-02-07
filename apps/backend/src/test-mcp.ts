#!/usr/bin/env tsx
// =============================================================================
// MCP Integration Test Script
// =============================================================================
// Run with: pnpm tsx src/test-mcp.ts

import 'dotenv/config';
import { MCPClientAdapter } from './adapters/mcp/MCPClientAdapter.js';
import type { MCPServerConfig } from '@project-jarvis/shared-types';

async function testMCPConnection() {
  console.log('='.repeat(60));
  console.log('MCP Integration Test');
  console.log('='.repeat(60));

  // Get config from environment
  const url = process.env.MCP_SERVER_1_URL;
  const name = process.env.MCP_SERVER_1_NAME || 'test-server';
  const transport = (process.env.MCP_SERVER_1_TRANSPORT || 'streamable-http') as 'streamable-http' | 'sse';
  const apiKey = process.env.MCP_SERVER_1_API_KEY;

  if (!url) {
    console.error('ERROR: MCP_SERVER_1_URL not configured in .env');
    process.exit(1);
  }

  console.log('\nConfiguration:');
  console.log(`  URL: ${url}`);
  console.log(`  Name: ${name}`);
  console.log(`  Transport: ${transport}`);
  console.log(`  Auth: ${apiKey ? 'API Key configured' : 'No auth'}`);

  // Create config
  const config: MCPServerConfig = {
    id: 'test-server-1',
    name,
    url,
    transport,
    authType: apiKey ? 'api-key' : 'none',
    authConfig: apiKey
      ? {
          type: 'api-key',
          apiKey: {
            apiKey,
            headerName: 'Authorization',
            headerPrefix: 'Bearer',
          },
        }
      : { type: 'none' },
    enabled: true,
    priority: 1,
    connectionTimeoutMs: 30000,
    requestTimeoutMs: 60000,
    maxRetries: 3,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  // Create client
  const client = new MCPClientAdapter(config);

  try {
    // Test 1: Connect
    console.log('\n[1/3] Connecting to MCP server...');
    await client.connect();
    console.log('  SUCCESS: Connected!');

    // Get server info
    const serverInfo = client.getServerInfo();
    if (serverInfo) {
      console.log('\n  Server Info:');
      console.log(`    Name: ${serverInfo.name}`);
      console.log(`    Version: ${serverInfo.version}`);
    }

    // Test 2: List tools
    console.log('\n[2/3] Listing available tools...');
    const tools = await client.listTools();
    console.log(`  SUCCESS: Found ${tools.length} tools`);

    if (tools.length > 0) {
      console.log('\n  Available Tools:');
      for (const tool of tools.slice(0, 10)) {
        console.log(`    - ${tool.name}: ${tool.description?.slice(0, 60) || 'No description'}...`);
      }
      if (tools.length > 10) {
        console.log(`    ... and ${tools.length - 10} more`);
      }
    }

    // Test 3: Call a tool (if available)
    console.log('\n[3/3] Testing tool call...');
    if (tools.length > 0) {
      // Try to find a simple tool to test
      const testTool = tools.find(t => 
        t.name.toLowerCase().includes('list') || 
        t.name.toLowerCase().includes('get') ||
        t.name.toLowerCase().includes('search')
      ) || tools[0];

      console.log(`  Attempting to call: ${testTool.name}`);
      
      try {
        // Try calling with empty args first
        const result = await client.callTool(testTool.name, {});
        console.log('  SUCCESS: Tool call completed!');
        console.log('  Result preview:', JSON.stringify(result).slice(0, 200) + '...');
      } catch (toolError) {
        console.log(`  SKIPPED: Tool call failed (may require specific arguments)`);
        console.log(`  Error: ${toolError instanceof Error ? toolError.message : String(toolError)}`);
      }
    } else {
      console.log('  SKIPPED: No tools available to test');
    }

    // Get status
    const status = client.getStatus();
    console.log('\n  Client Status:');
    console.log(`    Connected: ${status.connected}`);
    console.log(`    Tool Count: ${status.toolCount}`);
    console.log(`    Total Requests: ${status.totalRequests}`);
    console.log(`    Successful Requests: ${status.successfulRequests}`);

    // Disconnect
    console.log('\nDisconnecting...');
    await client.disconnect();
    console.log('Disconnected.');

    console.log('\n' + '='.repeat(60));
    console.log('TEST PASSED: MCP integration is working!');
    console.log('='.repeat(60));

  } catch (error) {
    console.error('\nERROR:', error instanceof Error ? error.message : String(error));
    if (error instanceof Error && error.stack) {
      console.error('\nStack trace:');
      console.error(error.stack);
    }
    process.exit(1);
  }
}

testMCPConnection();
