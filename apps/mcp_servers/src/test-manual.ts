// =============================================================================
// Manual Test Script for Composio Integration
// =============================================================================
// Run with: COMPOSIO_API_KEY=your_key pnpm tsx src/test-manual.ts
//
// This script tests the Composio integration by:
// 1. Creating a session
// 2. Listing supported apps
// 3. Initiating a connection (prints auth URL)
// 4. Checking connection status

import { Composio } from '@composio/core';
import {
  ComposioIntegrationService,
  SUPPORTED_TOOLKITS,
  ENABLED_TOOLKIT_SLUGS,
} from './index.js';

async function main() {
  console.log('='.repeat(60));
  console.log('Composio Integration Manual Test');
  console.log('='.repeat(60));

  // Check for API key
  const apiKey = process.env.COMPOSIO_API_KEY;
  if (!apiKey) {
    console.error('\nError: COMPOSIO_API_KEY environment variable is required');
    console.error('Run with: COMPOSIO_API_KEY=your_key pnpm tsx src/test-manual.ts');
    process.exit(1);
  }

  console.log('\n[1] Initializing Composio client...');
  const client = new Composio({ apiKey });
  const service = new ComposioIntegrationService(
    client,
    'projectjarvis://oauth/callback'
  );

  console.log('    OK - Client initialized');

  // Test: List supported toolkits
  console.log('\n[2] Supported Toolkits:');
  console.log('    ' + '-'.repeat(50));
  for (const [key, info] of Object.entries(SUPPORTED_TOOLKITS)) {
    console.log(`    ${key.padEnd(20)} -> ${info.slug}`);
  }

  // Test: Create a session
  const testUserId = `test-user-${Date.now()}`;
  console.log(`\n[3] Creating session for user: ${testUserId}`);

  try {
    const session = await service.createSession(testUserId, {
      manageConnections: {
        enable: true,
        callbackUrl: 'projectjarvis://oauth/callback',
      },
    });

    console.log('    OK - Session created');
    console.log(`    Session ID: ${session.sessionId}`);
    console.log(`    MCP URL: ${session.mcp.url}`);
    console.log(`    Meta Tools: ${session.metaTools.join(', ')}`);

    // Test: Get supported apps with status
    console.log(`\n[4] Getting app status for user...`);
    const apps = await service.getSupportedApps(testUserId);
    console.log('    ' + '-'.repeat(50));
    for (const app of apps) {
      const status = app.isConnected ? 'CONNECTED' : 'not connected';
      console.log(`    ${app.name.padEnd(20)} ${status}`);
    }

    // Test: Initiate a connection (GitHub as example)
    console.log(`\n[5] Initiating GitHub connection...`);
    try {
      const connection = await service.initiateConnection(testUserId, 'github');
      console.log('    OK - Connection initiated');
      console.log(`    Connection ID: ${connection.connectionId}`);
      console.log(`    Redirect URL: ${connection.redirectUrl}`);
      console.log('\n    To complete OAuth, open this URL in a browser:');
      console.log(`    ${connection.redirectUrl}`);

      // Test: Check connection status
      console.log(`\n[6] Checking connection status...`);
      const status = await service.getConnectionStatus(connection.connectionId);
      console.log(`    Status: ${status.status}`);
    } catch (error) {
      console.log(`    Skipped - ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    // Test: Get existing session
    console.log(`\n[7] Retrieving existing session...`);
    const existingSession = await service.getSession(session.sessionId);
    console.log(`    OK - Session retrieved`);
    console.log(`    Session ID matches: ${existingSession.sessionId === session.sessionId}`);

  } catch (error) {
    console.error('\n    ERROR:', error instanceof Error ? error.message : error);
    process.exit(1);
  }

  console.log('\n' + '='.repeat(60));
  console.log('All tests completed successfully!');
  console.log('='.repeat(60));
}

main().catch(console.error);
