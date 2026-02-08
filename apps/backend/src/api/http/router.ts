// =============================================================================
// Main HTTP Router
// =============================================================================
// Hono-based HTTP router for Project Jarvis backend

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { HTTPException } from 'hono/http-exception';
import { healthRoutes } from './routes/health.js';
import { chatRoutes } from './routes/chat.js';
import { orchestratorRoutes, getMCPClientManager, getToolRegistry } from './routes/orchestrator.js';
import { createMCPRoutes, createMCPToolsRoutes } from './routes/mcp.js';
import { MCPServerService } from '../../application/services/MCPServerService.js';
import { authRoutes } from './routes/auth.js';
import { secretsRoutes } from './routes/secrets.js';
import { toolPermissionsRoutes } from './routes/tool-permissions.js';
import { usageRoutes } from './routes/usage.js';
import { AppError } from '../../domain/errors/index.js';
import type { AuthVariables } from './middleware/auth.js';
import { tracingMiddleware } from '../../infrastructure/observability/index.js';

// =============================================================================
// App Type
// =============================================================================

/**
 * Hono app with typed context variables
 */
type AppBindings = {
  Variables: AuthVariables;
};

// =============================================================================
// Create App
// =============================================================================

/**
 * Main Hono application
 */
export const app = new Hono<AppBindings>();

// =============================================================================
// Global Middleware
// =============================================================================

/**
 * OpenTelemetry tracing middleware
 * MUST be first to capture full request lifecycle
 */
app.use('*', tracingMiddleware);

/**
 * CORS configuration
 * TODO: Restrict origins in production
 */
app.use(
  '*',
  cors({
    origin: '*', // Configure appropriately for production
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-Request-ID', 'traceparent', 'tracestate'],
    exposeHeaders: ['X-Request-ID', 'X-Trace-ID'],
    maxAge: 86400, // 24 hours
  })
);

/**
 * Request logging
 */
app.use('*', logger());

// =============================================================================
// Mount Routes
// =============================================================================

// Health check endpoints (no auth required)
app.route('/health', healthRoutes);

// API v1 routes
app.route('/api/v1/auth', authRoutes);
app.route('/api/v1/secrets', secretsRoutes);
app.route('/api/v1/tool-permissions', toolPermissionsRoutes);
app.route('/api/v1/usage', usageRoutes);
app.route('/api/v1/chat', chatRoutes);
app.route('/api/v1/orchestrator', orchestratorRoutes);

// =============================================================================
// Monitoring & Webhook Routes
// =============================================================================
// NOTE: Monitoring and webhook routes require dependency injection.
// They should be mounted in the server initialization code where services
// are instantiated. Example:
//
//   import { createWebhookRoutes } from './routes/webhooks.js';
//   import { createMonitoringRoutes } from './routes/monitoring.js';
//
//   const webhookRoutes = createWebhookRoutes({ monitoringService });
//   const monitoringRoutes = createMonitoringRoutes({ monitoringService, pushService });
//
//   app.route('/api/v1/webhooks', webhookRoutes);
//   app.route('/api/v1/monitoring', monitoringRoutes);
//
// See apps/backend/src/index.ts for the full initialization.
// =============================================================================

// MCP tools debug routes - simple direct implementation
app.get('/api/v1/mcp/tools', async (c) => {
  const mcpClientManager = getMCPClientManager();
  
  if (!mcpClientManager) {
    return c.json({ error: 'MCP client manager not available', tools: [] });
  }

  try {
    const tools = await mcpClientManager.getToolDefinitions();
    return c.json({ tools, count: tools.length });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return c.json({ error: errorMessage, tools: [] }, 500);
  }
});

app.get('/api/v1/mcp/status', async (c) => {
  const mcpClientManager = getMCPClientManager();
  
  if (!mcpClientManager) {
    return c.json({ error: 'MCP client manager not available', servers: [] });
  }

  const servers = mcpClientManager.getAllServerStatus();
  return c.json({ servers });
});

// =============================================================================
// Root Route
// =============================================================================

app.get('/', (c) => {
  return c.json({
    name: 'Project Jarvis API',
    version: '1.0.0',
    docs: '/api/v1',
    health: '/health',
  });
});

// =============================================================================
// Error Handling
// =============================================================================

/**
 * 404 handler
 */
app.notFound((c) => {
  return c.json(
    {
      error: {
        code: 'NOT_FOUND',
        message: `Route ${c.req.method} ${c.req.path} not found`,
      },
    },
    404
  );
});

/**
 * Global error handler
 * Handles AppError instances with proper status codes and formats
 */
app.onError((err, c) => {
  // Handle AppError instances (our domain errors)
  if (err instanceof AppError) {
    return c.json(err.toJSON(), err.statusCode as 400 | 401 | 403 | 404 | 409 | 429 | 500 | 502 | 503);
  }

  // Handle Hono's HTTPException
  if (err instanceof HTTPException) {
    return c.json(
      {
        error: {
          code: 'HTTP_ERROR',
          message: err.message,
        },
      },
      err.status
    );
  }

  // Log unexpected errors
  console.error('[Unhandled Error]', err);

  // Don't leak internal error details in production
  const isDev = process.env.NODE_ENV === 'development';

  return c.json(
    {
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: isDev ? err.message : 'An unexpected error occurred',
        ...(isDev && { stack: err.stack }),
      },
    },
    500
  );
});

// =============================================================================
// Export Types
// =============================================================================

export type AppType = typeof app;
