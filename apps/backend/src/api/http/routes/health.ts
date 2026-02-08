// =============================================================================
// Health Check Routes
// =============================================================================

import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { db } from '../../../infrastructure/db/client.js';

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
healthRoutes.get('/ready', async (c) => {
  const checks: Record<string, { status: 'ok' | 'error'; latencyMs?: number; error?: string }> = {};
  
  // Database connectivity check
  const dbStart = Date.now();
  try {
    await db.execute(sql`SELECT 1`);
    checks.database = { status: 'ok', latencyMs: Date.now() - dbStart };
  } catch (error) {
    checks.database = { 
      status: 'error', 
      latencyMs: Date.now() - dbStart,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }

  const allHealthy = Object.values(checks).every(check => check.status === 'ok');

  return c.json({
    status: allHealthy ? 'ready' : 'degraded',
    timestamp: new Date().toISOString(),
    checks,
  }, allHealthy ? 200 : 503);
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
