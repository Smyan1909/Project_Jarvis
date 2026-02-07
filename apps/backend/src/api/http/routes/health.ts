// =============================================================================
// Health Check Routes
// =============================================================================

import { Hono } from 'hono';

export const healthRoutes = new Hono();

/**
 * GET /health
 * Basic health check endpoint
 */
healthRoutes.get('/', (c) => {
  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
  });
});

/**
 * GET /health/ready
 * Readiness check - indicates if the service is ready to accept requests
 */
healthRoutes.get('/ready', (c) => {
  // TODO: Add checks for database, external services, etc.
  return c.json({
    status: 'ready',
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /health/live
 * Liveness check - indicates if the service is alive
 */
healthRoutes.get('/live', (c) => {
  return c.json({
    status: 'alive',
    timestamp: new Date().toISOString(),
  });
});
