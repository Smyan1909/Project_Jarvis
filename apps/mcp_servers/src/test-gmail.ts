// =============================================================================
// Test Gmail Connection
// =============================================================================
// Run with: COMPOSIO_API_KEY=your_key pnpm tsx src/test-gmail.ts
//
// This script tests if Gmail OAuth is working by:
// 1. Creating a session
// 2. Searching for Gmail tools
// 3. Fetching recent emails

import { Composio } from '@composio/core';

const USER_ID = process.env.TEST_USER_ID ?? 'test-user-123';

async function main() {
  console.log('='.repeat(60));
  console.log('Gmail Connection Test');
  console.log('='.repeat(60));

  const apiKey = process.env.COMPOSIO_API_KEY;
  if (!apiKey) {
    console.error('\nError: COMPOSIO_API_KEY environment variable is required');
    process.exit(1);
  }

  console.log(`\nUsing user ID: ${USER_ID}`);

  const client = new Composio({ apiKey });

  // Step 1: Create a session
  console.log('\n[1] Creating session...');
  const session = await client.create(USER_ID, {
    manageConnections: { enable: false },
  });
  console.log(`    Session ID: ${session.sessionId}`);
  console.log(`    MCP URL: ${session.mcp.url}`);

  // Step 2: Check if Gmail is connected
  console.log('\n[2] Checking Gmail connection status...');
  const accounts = await client.connectedAccounts.list({
    userIds: [USER_ID],
    toolkitSlugs: ['gmail'],
  });

  if (!accounts.items || accounts.items.length === 0) {
    console.error('    ERROR: No Gmail account connected for this user!');
    console.error('    Please connect Gmail first using:');
    console.error(`    curl -X POST http://localhost:3001/composio/connect/gmail -H "Content-Type: application/json" -d '{"userId": "${USER_ID}"}'`);
    process.exit(1);
  }

  const gmailAccount = accounts.items[0];
  console.log(`    Gmail connected! Account ID: ${gmailAccount.id}`);
  console.log(`    Status: ${gmailAccount.status}`);

  // Step 3: Try to fetch emails using the tool
  console.log('\n[3] Fetching recent emails...');
  
  try {
    const result = await client.tools.execute('GMAIL_FETCH_EMAILS', {
      userId: USER_ID,
      arguments: {
        max_results: 5,
      },
      dangerouslySkipVersionCheck: true,
    });

    console.log('\n    SUCCESS! Recent emails:');
    console.log('    ' + '-'.repeat(50));
    
    const data = result.data as Record<string, unknown>;
    const emails = (data?.emails ?? data?.messages ?? data) as Array<Record<string, unknown>> | undefined;
    
    if (Array.isArray(emails)) {
      for (const email of emails.slice(0, 5)) {
        const subject = email.subject ?? email.Subject ?? '(no subject)';
        const from = email.from ?? email.From ?? email.sender ?? '(unknown)';
        console.log(`    - ${subject}`);
        console.log(`      From: ${from}`);
      }
    } else {
      console.log('    Raw response:');
      console.log(JSON.stringify(result.data, null, 2).split('\n').map(l => '    ' + l).join('\n'));
    }
  } catch (error) {
    console.error('\n    ERROR executing GMAIL_FETCH_EMAILS:');
    console.error('    ', error instanceof Error ? error.message : error);
    
    // Try alternative tool name
    console.log('\n[3b] Trying GMAIL_LIST_THREADS instead...');
    try {
      const result = await client.tools.execute('GMAIL_LIST_THREADS', {
        userId: USER_ID,
        arguments: {
          max_results: 5,
        },
        dangerouslySkipVersionCheck: true,
      });
      console.log('\n    SUCCESS with GMAIL_LIST_THREADS:');
      console.log(JSON.stringify(result.data, null, 2).split('\n').slice(0, 20).map(l => '    ' + l).join('\n'));
    } catch (error2) {
      console.error('    Also failed:', error2 instanceof Error ? error2.message : error2);
    }
  }

  // Step 4: List available Gmail tools
  console.log('\n[4] Available Gmail tools:');
  try {
    const tools = await client.tools.get(USER_ID, {
      toolkits: ['gmail'],
    });
    
    const toolList = tools as unknown as Array<{ name: string; description: string }>;
    if (Array.isArray(toolList)) {
      for (const tool of toolList.slice(0, 10)) {
        console.log(`    - ${tool.name}`);
      }
      if (toolList.length > 10) {
        console.log(`    ... and ${toolList.length - 10} more`);
      }
    }
  } catch (error) {
    console.log('    Could not list tools:', error instanceof Error ? error.message : error);
  }

  console.log('\n' + '='.repeat(60));
  console.log('Test completed!');
  console.log('='.repeat(60));
}

main().catch(console.error);
