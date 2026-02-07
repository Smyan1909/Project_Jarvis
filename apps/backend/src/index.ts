// =============================================================================
// Project Jarvis Backend - Entry Point
// =============================================================================

// Load environment variables from .env file
import 'dotenv/config';

import { createServer } from 'http';
import { getRequestListener } from '@hono/node-server';
import { app } from './api/http/router.js';
import { SocketServer } from './api/ws/socket-server.js';
import { authService } from './services/index.js';
import { config } from './infrastructure/config/index.js';

// =============================================================================
// Configuration
// =============================================================================

const port = config.PORT;
const isDev = config.NODE_ENV !== 'production';

// =============================================================================
// Create HTTP Server
// =============================================================================

// Create a request listener from the Hono app
const requestListener = getRequestListener(app.fetch);

// Create a Node.js HTTP server
const httpServer = createServer(requestListener);

// =============================================================================
// WebSocket Server
// =============================================================================

// Attach Socket.io to the HTTP server
const socketServer = new SocketServer(httpServer, authService, {
  corsOrigin: config.CORS_ORIGIN,
  pingInterval: config.WS_PING_INTERVAL,
  pingTimeout: config.WS_PING_TIMEOUT,
});

// =============================================================================
// Start Server
// =============================================================================

httpServer.listen(port, () => {
  console.log('');
  console.log('  Project Jarvis Backend');
  console.log('  ─────────────────────────────────────');
  console.log(`  Server:    http://localhost:${port}`);
  console.log(`  Health:    http://localhost:${port}/health`);
  console.log(`  WebSocket: ws://localhost:${port}`);
  console.log(`  Chat API:  http://localhost:${port}/api/v1/chat`);
  console.log('  ─────────────────────────────────────');
  console.log(`  Mode:      ${isDev ? 'development' : 'production'}`);
  console.log('');
});

// =============================================================================
// Graceful Shutdown
// =============================================================================

const shutdown = async () => {
  console.log('\n  Shutting down gracefully...');
  
  // Close WebSocket connections
  await socketServer.close();
  
  // Close HTTP server
  httpServer.close(() => {
    console.log('  Server closed');
    process.exit(0);
  });
  
  // Force exit after timeout
  setTimeout(() => {
    console.error('  Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// =============================================================================
// Export for testing
// =============================================================================

export { httpServer, socketServer };
