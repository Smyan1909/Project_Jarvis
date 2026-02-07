// =============================================================================
// Agent Run Repository - Storage Adapter
// =============================================================================
// Handles all database operations for the agent_runs table.
// Agent runs track individual agent execution sessions with their status,
// token usage, and cost metrics.

import { eq, desc, and, sql } from 'drizzle-orm';
import { db } from '../../infrastructure/db/client.js';
import { agentRuns } from '../../infrastructure/db/schema.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Valid statuses for an agent run
 */
export type AgentRunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

/**
 * Agent run entity as returned from the database
 */
export interface AgentRun {
  id: string;
  userId: string;
  status: string;
  totalTokens: number;
  totalCost: number;
  startedAt: Date;
  completedAt: Date | null;
}

/**
 * Data for updating agent run status
 */
export interface UpdateStatusData {
  status: AgentRunStatus;
  totalTokens?: number;
  totalCost?: number;
}

/**
 * Options for listing agent runs
 */
export interface ListAgentRunsOptions {
  limit?: number;
  offset?: number;
  status?: AgentRunStatus;
}

// =============================================================================
// Repository
// =============================================================================

/**
 * Repository for agent run CRUD operations
 */
export class AgentRunRepository {
  /**
   * Create a new agent run
   * Starts with 'pending' status by default
   */
  async create(userId: string): Promise<AgentRun> {
    const result = await db
      .insert(agentRuns)
      .values({ userId })
      .returning();

    return result[0];
  }

  /**
   * Find an agent run by ID
   */
  async findById(id: string): Promise<AgentRun | null> {
    const result = await db
      .select()
      .from(agentRuns)
      .where(eq(agentRuns.id, id))
      .limit(1);

    return result[0] || null;
  }

  /**
   * Find an agent run by ID with user ownership check
   * Returns null if run doesn't exist or doesn't belong to user
   */
  async findByIdAndUser(id: string, userId: string): Promise<AgentRun | null> {
    const result = await db
      .select()
      .from(agentRuns)
      .where(and(eq(agentRuns.id, id), eq(agentRuns.userId, userId)))
      .limit(1);

    return result[0] || null;
  }

  /**
   * List agent runs for a user with pagination
   * Ordered by startedAt descending (most recent first)
   */
  async findByUser(userId: string, options: ListAgentRunsOptions = {}): Promise<AgentRun[]> {
    const { limit = 20, offset = 0, status } = options;

    let query = db
      .select()
      .from(agentRuns)
      .where(eq(agentRuns.userId, userId))
      .orderBy(desc(agentRuns.startedAt))
      .limit(limit)
      .offset(offset);

    if (status) {
      query = db
        .select()
        .from(agentRuns)
        .where(and(eq(agentRuns.userId, userId), eq(agentRuns.status, status)))
        .orderBy(desc(agentRuns.startedAt))
        .limit(limit)
        .offset(offset);
    }

    return query;
  }

  /**
   * Update agent run status
   * Automatically sets completedAt when status is terminal (completed/failed/cancelled)
   */
  async updateStatus(id: string, data: UpdateStatusData): Promise<AgentRun | null> {
    const updateData: Record<string, unknown> = {
      status: data.status,
    };

    // Set completedAt for terminal statuses
    if (data.status === 'completed' || data.status === 'failed' || data.status === 'cancelled') {
      updateData.completedAt = new Date();
    }

    // Update token and cost metrics if provided
    if (data.totalTokens !== undefined) {
      updateData.totalTokens = data.totalTokens;
    }

    if (data.totalCost !== undefined) {
      updateData.totalCost = data.totalCost;
    }

    const result = await db
      .update(agentRuns)
      .set(updateData)
      .where(eq(agentRuns.id, id))
      .returning();

    return result[0] || null;
  }

  /**
   * Increment token and cost counters atomically
   * Used during streaming to track usage in real-time
   */
  async incrementUsage(id: string, tokens: number, cost: number): Promise<AgentRun | null> {
    const result = await db
      .update(agentRuns)
      .set({
        totalTokens: sql`${agentRuns.totalTokens} + ${tokens}`,
        totalCost: sql`${agentRuns.totalCost} + ${cost}`,
      })
      .where(eq(agentRuns.id, id))
      .returning();

    return result[0] || null;
  }

  /**
   * Count total runs for a user
   */
  async countByUser(userId: string): Promise<number> {
    const result = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(agentRuns)
      .where(eq(agentRuns.userId, userId));

    return result[0]?.count || 0;
  }

  /**
   * Count active (pending/running) runs for a user
   * Used for rate limiting concurrent runs
   */
  async countActiveByUser(userId: string): Promise<number> {
    const result = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(agentRuns)
      .where(
        and(
          eq(agentRuns.userId, userId),
          sql`${agentRuns.status} IN ('pending', 'running')`
        )
      );

    return result[0]?.count || 0;
  }

  /**
   * Delete an agent run
   * Returns true if run was deleted, false if not found
   */
  async delete(id: string): Promise<boolean> {
    const result = await db
      .delete(agentRuns)
      .where(eq(agentRuns.id, id))
      .returning({ id: agentRuns.id });

    return result.length > 0;
  }

  /**
   * Cancel all active runs for a user
   * Used for emergency stop functionality
   */
  async cancelAllActive(userId: string): Promise<number> {
    const result = await db
      .update(agentRuns)
      .set({
        status: 'cancelled',
        completedAt: new Date(),
      })
      .where(
        and(
          eq(agentRuns.userId, userId),
          sql`${agentRuns.status} IN ('pending', 'running')`
        )
      )
      .returning({ id: agentRuns.id });

    return result.length;
  }
}
