// =============================================================================
// Test HTTP Server for Composio Integration
// =============================================================================
// Run with: COMPOSIO_API_KEY=your_key pnpm tsx src/test-server.ts
//
// This starts a local HTTP server on port 3001 with the Composio routes.
// You can then test with curl or your mobile app.

import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { cors } from 'hono/cors';
import { createComposioModule } from './index.js';

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3001;

async function main() {
  // Check for API key
  const apiKey = process.env.COMPOSIO_API_KEY;
  if (!apiKey) {
    console.error('Error: COMPOSIO_API_KEY environment variable is required');
    console.error('Run with: COMPOSIO_API_KEY=your_key pnpm tsx src/test-server.ts');
    process.exit(1);
  }

  const app = new Hono();

  // Middleware
  app.use('*', logger());
  app.use('*', cors());

  // Health check
  app.get('/health', (c) => c.json({ status: 'ok' }));

  // Mount Composio routes
  app.route('/composio', createComposioModule());

  console.log('='.repeat(60));
  console.log('Composio Integration Test Server');
  console.log('='.repeat(60));
  console.log(`\nServer starting on http://localhost:${PORT}`);
  console.log('\nAvailable endpoints:');
  console.log('  GET  /health                     - Health check');
  console.log('  POST /composio/session           - Create session');
  console.log('  GET  /composio/session/:id       - Get session');
  console.log('  GET  /composio/apps?userId=      - List apps with status');
  console.log('  GET  /composio/apps/supported    - List supported apps');
  console.log('  POST /composio/connect/:app      - Initiate OAuth');
  console.log('  GET  /composio/status/:id        - Check connection status');
  console.log('  GET  /composio/accounts?userId=  - List connected accounts');
  console.log('  DELETE /composio/accounts/:id    - Disconnect account');
  console.log('  POST /composio/accounts/:id/refresh - Refresh tokens');
  console.log('  GET  /composio/toolkits?userId=  - Get toolkit status');
  console.log('\nExample requests:');
  console.log(`
  # List supported apps
  curl http://localhost:${PORT}/composio/apps/supported

  # Create a session
  curl -X POST http://localhost:${PORT}/composio/session \\
    -H "Content-Type: application/json" \\
    -d '{"userId": "test-user-123"}'

  # Get apps with connection status
  curl "http://localhost:${PORT}/composio/apps?userId=test-user-123"

  # Initiate GitHub connection
  curl -X POST http://localhost:${PORT}/composio/connect/github \\
    -H "Content-Type: application/json" \\
    -d '{"userId": "test-user-123"}'
`);
  console.log('='.repeat(60));

  serve({
    fetch: app.fetch,
    port: PORT,
  });
}

main().catch(console.error);
