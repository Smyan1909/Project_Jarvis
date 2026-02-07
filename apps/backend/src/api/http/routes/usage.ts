// =============================================================================
// Usage Routes
// =============================================================================
// API endpoints for viewing user usage statistics and cost aggregation.
// All endpoints require authentication.

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { eq, and, gte, lte, sql } from 'drizzle-orm';
import { db } from '../../../infrastructure/db/client.js';
import { agentRuns } from '../../../infrastructure/db/schema.js';
import { authMiddleware, type AuthVariables } from '../middleware/auth.js';

// =============================================================================
// Request Schemas
// =============================================================================

/**
 * Query parameters for usage endpoint
 */
const usageQuerySchema = z.object({
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
});

// =============================================================================
// Types
// =============================================================================

interface UsageSummary {
  totalRuns: number;
  completedRuns: number;
  failedRuns: number;
  cancelledRuns: number;
  totalTokens: number;
  totalCost: number;
  periodStart: string | null;
  periodEnd: string | null;
}

interface DailyUsage {
  date: string;
  runCount: number;
  tokens: number;
  cost: number;
}

// =============================================================================
// Routes
// =============================================================================

export const usageRoutes = new Hono<{ Variables: AuthVariables }>();

// All routes require authentication
usageRoutes.use('*', authMiddleware);

/**
 * GET /api/v1/usage
 * Get aggregated usage statistics for the current user
 *
 * Query params (optional):
 * - startDate: ISO datetime (defaults to 30 days ago)
 * - endDate: ISO datetime (defaults to now)
 *
 * Response:
 * - data: UsageSummary
 */
usageRoutes.get('/', zValidator('query', usageQuerySchema), async (c) => {
  const userId = c.get('userId');
  const { startDate, endDate } = c.req.valid('query');

  // Default to last 30 days
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const periodStart = startDate ? new Date(startDate) : thirtyDaysAgo;
  const periodEnd = endDate ? new Date(endDate) : now;

  // Aggregate query
  const result = await db
    .select({
      totalRuns: sql<number>`count(*)::int`,
      completedRuns: sql<number>`count(*) filter (where ${agentRuns.status} = 'completed')::int`,
      failedRuns: sql<number>`count(*) filter (where ${agentRuns.status} = 'failed')::int`,
      cancelledRuns: sql<number>`count(*) filter (where ${agentRuns.status} = 'cancelled')::int`,
      totalTokens: sql<number>`coalesce(sum(${agentRuns.totalTokens}), 0)::int`,
      totalCost: sql<number>`coalesce(sum(${agentRuns.totalCost}), 0)::real`,
    })
    .from(agentRuns)
    .where(
      and(
        eq(agentRuns.userId, userId),
        gte(agentRuns.startedAt, periodStart),
        lte(agentRuns.startedAt, periodEnd)
      )
    );

  const stats = result[0];

  const summary: UsageSummary = {
    totalRuns: stats.totalRuns || 0,
    completedRuns: stats.completedRuns || 0,
    failedRuns: stats.failedRuns || 0,
    cancelledRuns: stats.cancelledRuns || 0,
    totalTokens: stats.totalTokens || 0,
    totalCost: Number((stats.totalCost || 0).toFixed(6)),
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString(),
  };

  return c.json({
    data: summary,
  });
});

/**
 * GET /api/v1/usage/daily
 * Get daily usage breakdown for the current user
 *
 * Query params (optional):
 * - startDate: ISO datetime (defaults to 30 days ago)
 * - endDate: ISO datetime (defaults to now)
 *
 * Response:
 * - data: Array of { date, runCount, tokens, cost }
 */
usageRoutes.get('/daily', zValidator('query', usageQuerySchema), async (c) => {
  const userId = c.get('userId');
  const { startDate, endDate } = c.req.valid('query');

  // Default to last 30 days
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const periodStart = startDate ? new Date(startDate) : thirtyDaysAgo;
  const periodEnd = endDate ? new Date(endDate) : now;

  // Daily aggregate query
  const result = await db
    .select({
      date: sql<string>`date_trunc('day', ${agentRuns.startedAt})::date::text`,
      runCount: sql<number>`count(*)::int`,
      tokens: sql<number>`coalesce(sum(${agentRuns.totalTokens}), 0)::int`,
      cost: sql<number>`coalesce(sum(${agentRuns.totalCost}), 0)::real`,
    })
    .from(agentRuns)
    .where(
      and(
        eq(agentRuns.userId, userId),
        gte(agentRuns.startedAt, periodStart),
        lte(agentRuns.startedAt, periodEnd)
      )
    )
    .groupBy(sql`date_trunc('day', ${agentRuns.startedAt})`)
    .orderBy(sql`date_trunc('day', ${agentRuns.startedAt})`);

  const dailyUsage: DailyUsage[] = result.map((row) => ({
    date: row.date,
    runCount: row.runCount || 0,
    tokens: row.tokens || 0,
    cost: Number((row.cost || 0).toFixed(6)),
  }));

  return c.json({
    data: dailyUsage,
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString(),
  });
});

/**
 * GET /api/v1/usage/current-month
 * Get usage summary for the current calendar month
 *
 * Response:
 * - data: UsageSummary
 */
usageRoutes.get('/current-month', async (c) => {
  const userId = c.get('userId');

  // Current month bounds
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

  // Aggregate query
  const result = await db
    .select({
      totalRuns: sql<number>`count(*)::int`,
      completedRuns: sql<number>`count(*) filter (where ${agentRuns.status} = 'completed')::int`,
      failedRuns: sql<number>`count(*) filter (where ${agentRuns.status} = 'failed')::int`,
      cancelledRuns: sql<number>`count(*) filter (where ${agentRuns.status} = 'cancelled')::int`,
      totalTokens: sql<number>`coalesce(sum(${agentRuns.totalTokens}), 0)::int`,
      totalCost: sql<number>`coalesce(sum(${agentRuns.totalCost}), 0)::real`,
    })
    .from(agentRuns)
    .where(
      and(
        eq(agentRuns.userId, userId),
        gte(agentRuns.startedAt, startOfMonth),
        lte(agentRuns.startedAt, endOfMonth)
      )
    );

  const stats = result[0];

  const summary: UsageSummary = {
    totalRuns: stats.totalRuns || 0,
    completedRuns: stats.completedRuns || 0,
    failedRuns: stats.failedRuns || 0,
    cancelledRuns: stats.cancelledRuns || 0,
    totalTokens: stats.totalTokens || 0,
    totalCost: Number((stats.totalCost || 0).toFixed(6)),
    periodStart: startOfMonth.toISOString(),
    periodEnd: endOfMonth.toISOString(),
  };

  return c.json({
    data: summary,
  });
});

/**
 * GET /api/v1/usage/runs
 * Get recent runs with usage details
 *
 * Query params:
 * - limit: number (default 20, max 100)
 * - offset: number (default 0)
 *
 * Response:
 * - data: Array of run summaries
 */
usageRoutes.get('/runs', async (c) => {
  const userId = c.get('userId');
  const limit = Math.min(parseInt(c.req.query('limit') || '20', 10), 100);
  const offset = parseInt(c.req.query('offset') || '0', 10);

  const runs = await db
    .select({
      id: agentRuns.id,
      status: agentRuns.status,
      totalTokens: agentRuns.totalTokens,
      totalCost: agentRuns.totalCost,
      startedAt: agentRuns.startedAt,
      completedAt: agentRuns.completedAt,
    })
    .from(agentRuns)
    .where(eq(agentRuns.userId, userId))
    .orderBy(sql`${agentRuns.startedAt} DESC`)
    .limit(limit)
    .offset(offset);

  return c.json({
    data: runs.map((r) => ({
      id: r.id,
      status: r.status,
      totalTokens: r.totalTokens,
      totalCost: Number(r.totalCost.toFixed(6)),
      startedAt: r.startedAt.toISOString(),
      completedAt: r.completedAt?.toISOString() || null,
      durationMs: r.completedAt
        ? r.completedAt.getTime() - r.startedAt.getTime()
        : null,
    })),
    pagination: {
      limit,
      offset,
    },
  });
});
