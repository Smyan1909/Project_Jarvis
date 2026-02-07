// =============================================================================
// Project Jarvis Backend - Entry Point
// =============================================================================

// Load environment variables from .env file
import 'dotenv/config';

import { serve } from '@hono/node-server';
import { app } from './api/http/router.js';

// =============================================================================
// Configuration
// =============================================================================

const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const isDev = process.env.NODE_ENV !== 'production';

// =============================================================================
// Start Server
// =============================================================================

serve({ fetch: app.fetch, port }, (info) => {
  console.log('');
  console.log('  Project Jarvis Backend');
  console.log('  ─────────────────────────────────────');
  console.log(`  Server:    http://localhost:${info.port}`);
  console.log(`  Health:    http://localhost:${info.port}/health`);
  console.log(`  Chat API:  http://localhost:${info.port}/api/v1/chat`);
  console.log(`  Models:    http://localhost:${info.port}/api/v1/chat/models`);
  console.log('  ─────────────────────────────────────');
  console.log(`  Mode:      ${isDev ? 'development' : 'production'}`);
  console.log('');
});
