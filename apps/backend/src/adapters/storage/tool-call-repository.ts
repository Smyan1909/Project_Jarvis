// =============================================================================
// Tool Call Repository - Storage Adapter
// =============================================================================
// Handles all database operations for the tool_calls table.
// Tool calls track individual tool invocations during an agent run,
// including input, output, status, and execution duration.

import { eq, asc, sql, and } from 'drizzle-orm';
import { db } from '../../infrastructure/db/client.js';
import { toolCalls } from '../../infrastructure/db/schema.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Valid statuses for a tool call
 */
export type ToolCallStatus = 'pending' | 'success' | 'error';

/**
 * Tool call entity as returned from the database
 */
export interface ToolCall {
  id: string;
  runId: string;
  toolId: string;
  input: Record<string, unknown>;
  output: Record<string, unknown> | null;
  status: string;
  durationMs: number | null;
  createdAt: Date;
}

/**
 * Data required to create a new tool call
 */
export interface CreateToolCallData {
  runId: string;
  toolId: string;
  input: Record<string, unknown>;
}

/**
 * Data for completing a tool call successfully
 */
export interface CompleteToolCallData {
  output: Record<string, unknown>;
  durationMs: number;
}

/**
 * Data for marking a tool call as failed
 */
export interface FailToolCallData {
  error: string;
  durationMs: number;
}

// =============================================================================
// Helper
// =============================================================================

/**
 * Convert a database row to a ToolCall entity
 * Handles type casting for jsonb fields
 */
function toToolCall(row: {
  id: string;
  runId: string;
  toolId: string;
  input: unknown;
  output: unknown;
  status: string;
  durationMs: number | null;
  createdAt: Date;
}): ToolCall {
  return {
    ...row,
    input: row.input as Record<string, unknown>,
    output: row.output as Record<string, unknown> | null,
  };
}

// =============================================================================
// Repository
// =============================================================================

/**
 * Repository for tool call CRUD operations
 */
export class ToolCallRepository {
  /**
   * Create a new tool call with pending status
   */
  async create(data: CreateToolCallData): Promise<ToolCall> {
    const result = await db
      .insert(toolCalls)
      .values({
        runId: data.runId,
        toolId: data.toolId,
        input: data.input,
      })
      .returning();

    return toToolCall(result[0]);
  }

  /**
   * Find a tool call by ID
   */
  async findById(id: string): Promise<ToolCall | null> {
    const result = await db
      .select()
      .from(toolCalls)
      .where(eq(toolCalls.id, id))
      .limit(1);

    return result[0] ? toToolCall(result[0]) : null;
  }

  /**
   * Find all tool calls for a run
   * Ordered by createdAt ascending (chronological order)
   */
  async findByRun(runId: string): Promise<ToolCall[]> {
    const result = await db
      .select()
      .from(toolCalls)
      .where(eq(toolCalls.runId, runId))
      .orderBy(asc(toolCalls.createdAt));
    return result.map(toToolCall);
  }

  /**
   * Find tool calls by status for a run
   */
  async findByRunAndStatus(runId: string, status: ToolCallStatus): Promise<ToolCall[]> {
    const result = await db
      .select()
      .from(toolCalls)
      .where(and(eq(toolCalls.runId, runId), eq(toolCalls.status, status)))
      .orderBy(asc(toolCalls.createdAt));
    return result.map(toToolCall);
  }

  /**
   * Find pending tool calls for a run
   * Used to check if there are unfinished tool calls
   */
  async findPendingByRun(runId: string): Promise<ToolCall[]> {
    return this.findByRunAndStatus(runId, 'pending');
  }

  /**
   * Mark a tool call as successful
   */
  async complete(id: string, data: CompleteToolCallData): Promise<ToolCall | null> {
    const result = await db
      .update(toolCalls)
      .set({
        output: data.output,
        durationMs: data.durationMs,
        status: 'success',
      })
      .where(eq(toolCalls.id, id))
      .returning();

    return result[0] ? toToolCall(result[0]) : null;
  }

  /**
   * Mark a tool call as failed
   */
  async fail(id: string, data: FailToolCallData): Promise<ToolCall | null> {
    const result = await db
      .update(toolCalls)
      .set({
        output: { error: data.error },
        durationMs: data.durationMs,
        status: 'error',
      })
      .where(eq(toolCalls.id, id))
      .returning();

    return result[0] ? toToolCall(result[0]) : null;
  }

  /**
   * Count tool calls in a run
   */
  async countByRun(runId: string): Promise<number> {
    const result = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(toolCalls)
      .where(eq(toolCalls.runId, runId));

    return result[0]?.count || 0;
  }

  /**
   * Count tool calls by status for a run
   */
  async countByRunAndStatus(runId: string, status: ToolCallStatus): Promise<number> {
    const result = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(toolCalls)
      .where(and(eq(toolCalls.runId, runId), eq(toolCalls.status, status)));

    return result[0]?.count || 0;
  }

  /**
   * Get total duration of all tool calls in a run
   */
  async getTotalDuration(runId: string): Promise<number> {
    const result = await db
      .select({ total: sql<number>`COALESCE(SUM(${toolCalls.durationMs}), 0)::int` })
      .from(toolCalls)
      .where(eq(toolCalls.runId, runId));

    return result[0]?.total || 0;
  }

  /**
   * Find tool calls by tool ID for a run
   * Useful for analyzing which tools were used
   */
  async findByToolId(runId: string, toolId: string): Promise<ToolCall[]> {
    const result = await db
      .select()
      .from(toolCalls)
      .where(and(eq(toolCalls.runId, runId), eq(toolCalls.toolId, toolId)))
      .orderBy(asc(toolCalls.createdAt));
    return result.map(toToolCall);
  }

  /**
   * Delete a tool call
   * Returns true if tool call was deleted, false if not found
   */
  async delete(id: string): Promise<boolean> {
    const result = await db
      .delete(toolCalls)
      .where(eq(toolCalls.id, id))
      .returning({ id: toolCalls.id });

    return result.length > 0;
  }

  /**
   * Delete all tool calls for a run
   * Returns the number of deleted tool calls
   */
  async deleteByRun(runId: string): Promise<number> {
    const result = await db
      .delete(toolCalls)
      .where(eq(toolCalls.runId, runId))
      .returning({ id: toolCalls.id });

    return result.length;
  }

  /**
   * Get usage statistics for a run
   */
  async getRunStats(runId: string): Promise<{
    total: number;
    success: number;
    error: number;
    pending: number;
    totalDurationMs: number;
  }> {
    const [counts, duration] = await Promise.all([
      db
        .select({
          status: toolCalls.status,
          count: sql<number>`count(*)::int`,
        })
        .from(toolCalls)
        .where(eq(toolCalls.runId, runId))
        .groupBy(toolCalls.status),
      this.getTotalDuration(runId),
    ]);

    const stats = {
      total: 0,
      success: 0,
      error: 0,
      pending: 0,
      totalDurationMs: duration,
    };

    for (const row of counts) {
      stats.total += row.count;
      if (row.status === 'success') stats.success = row.count;
      else if (row.status === 'error') stats.error = row.count;
      else if (row.status === 'pending') stats.pending = row.count;
    }

    return stats;
  }
}
