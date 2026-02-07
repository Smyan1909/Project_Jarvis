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
import { orchestratorRoutes } from './routes/orchestrator.js';
import { authRoutes } from './routes/auth.js';
import { secretsRoutes } from './routes/secrets.js';
import { AppError } from '../../domain/errors/index.js';
import type { AuthVariables } from './middleware/auth.js';

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
 * CORS configuration
 * TODO: Restrict origins in production
 */
app.use(
  '*',
  cors({
    origin: '*', // Configure appropriately for production
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
    exposeHeaders: ['X-Request-ID'],
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
app.route('/api/v1/chat', chatRoutes);
app.route('/api/v1/orchestrator', orchestratorRoutes);

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
