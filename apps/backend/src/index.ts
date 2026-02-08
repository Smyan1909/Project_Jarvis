// =============================================================================
// Project Jarvis Backend - Entry Point
// =============================================================================

// Load environment variables from .env file
import 'dotenv/config';

// IMPORTANT: Initialize OpenTelemetry tracing BEFORE any other imports
// This ensures all modules are properly instrumented
import './infrastructure/observability/tracing.js';

import { createServer } from 'http';
import { getRequestListener } from '@hono/node-server';
import { app } from './api/http/router.js';
import { SocketServer } from './api/ws/socket-server.js';
import { authService } from './services/index.js';
import { config } from './infrastructure/config/index.js';
import { shutdownTracing } from './infrastructure/observability/index.js';

// Monitoring Agent imports
import { createWebhookRoutes } from './api/http/routes/webhooks.js';
import { createMonitoringRoutes } from './api/http/routes/monitoring.js';
import { createOrchestratorService } from './api/http/routes/orchestrator.js';
import { MonitoringAgentService, type ComposioServiceInterface } from './application/services/MonitoringAgentService.js';
import { TriggerReplyService } from './application/services/TriggerReplyService.js';
import { PushNotificationService } from './application/services/PushNotificationService.js';
import { TriggerSubscriptionRepository } from './adapters/storage/trigger-subscription-repository.js';
import { MonitoredEventRepository } from './adapters/storage/monitored-event-repository.js';
import { SlackPriorityContactRepository } from './adapters/storage/slack-priority-contact-repository.js';
import { PushTokenRepository } from './adapters/storage/push-token-repository.js';
import { MessageRepository } from './adapters/storage/message-repository.js';

// Composio integration for GitHub/Slack replies
import {
  getComposioClient,
  createComposioIntegrationService,
  createComposioRoutes,
  getEnvConfig as getComposioEnvConfig,
} from '@project-jarvis/mcp-servers';
import { logger } from './infrastructure/logging/logger.js';

// Scheduled jobs
import { scheduleCleanup as scheduleEventCleanup } from './infrastructure/jobs/cleanup-monitored-events.js';

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
// Monitoring Agent Services
// =============================================================================

// Initialize repositories
const triggerSubRepo = new TriggerSubscriptionRepository();
const eventRepo = new MonitoredEventRepository();
const priorityContactRepo = new SlackPriorityContactRepository();
const pushTokenRepo = new PushTokenRepository();
const messageRepo = new MessageRepository();

// Initialize services
const replyService = new TriggerReplyService();
const pushService = new PushNotificationService(pushTokenRepo, {
  enabled: config.NODE_ENV === 'production', // Only send in production
});

// Initialize ComposioService for GitHub/Slack replies
// If COMPOSIO_API_KEY is not set, replies will be disabled but monitoring still works
let composioService: ComposioServiceInterface | null = null;
try {
  const composioClient = getComposioClient();
  const composioEnvConfig = getComposioEnvConfig();
  composioService = createComposioIntegrationService(
    composioClient,
    composioEnvConfig.callbackScheme
  );
  logger.info('ComposioService initialized for monitoring agent');
} catch (error) {
  logger.warn('ComposioService not available - GitHub/Slack replies disabled', {
    error: error instanceof Error ? error.message : String(error),
  });
}

const monitoringService = new MonitoringAgentService(
  triggerSubRepo,
  eventRepo,
  priorityContactRepo,
  messageRepo,
  replyService,
  pushService,
  socketServer,
  createOrchestratorService, // Factory function for creating orchestrator instances
  composioService,
  { webhookUrl: config.COMPOSIO_WEBHOOK_URL || `http://localhost:${port}/api/v1/webhooks/composio` }
);

// Mount monitoring routes
const webhookRoutes = createWebhookRoutes({ monitoringService });
const monitoringRoutes = createMonitoringRoutes({ monitoringService, pushService });
app.route('/api/v1/webhooks', webhookRoutes);
app.route('/api/v1/monitoring', monitoringRoutes);

// Mount Composio routes for OAuth integrations (if service is available)
if (composioService) {
  // Cast to any since createComposioRoutes expects the full ComposioIntegrationService
  // but we have the interface type. At runtime this is the same object.
  const composioRoutes = createComposioRoutes({ composioService: composioService as any });
  app.route('/api/v1/composio', composioRoutes);
  logger.info('Composio routes mounted at /api/v1/composio');
}

// Schedule cleanup jobs
scheduleEventCleanup();

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
  
  // Shutdown OpenTelemetry (flush pending spans)
  await shutdownTracing();
  
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
