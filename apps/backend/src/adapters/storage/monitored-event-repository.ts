// =============================================================================
// Monitored Event Repository - Storage Adapter
// =============================================================================
// Handles all database operations for the monitored_events table.
// Stores trigger events received by the monitoring agent.

import { eq, and, desc, lt } from 'drizzle-orm';
import { db } from '../../infrastructure/db/client.js';
import { monitoredEvents } from '../../infrastructure/db/schema.js';
import type {
  MonitoredEvent,
  MonitoredEventStatus,
  ParsedTriggerContext,
  TriggerType,
  MonitoringToolkit,
} from '@project-jarvis/shared-types';

// =============================================================================
// Types
// =============================================================================

/**
 * Data required to create a new monitored event
 */
export interface CreateMonitoredEventData {
  userId: string;
  subscriptionId?: string;
  triggerType: TriggerType;
  toolkit: MonitoringToolkit;
  payload: Record<string, unknown>;
  parsedContext: ParsedTriggerContext;
  requiresApproval: boolean;
  status?: MonitoredEventStatus;
}

/**
 * Data that can be updated on a monitored event
 */
export interface UpdateMonitoredEventData {
  status?: MonitoredEventStatus;
  orchestratorRunId?: string | null;
  sourceReplyId?: string | null;
  sourceReplyContent?: string | null;
  processedAt?: Date;
  approvedAt?: Date;
}

/**
 * Options for querying events
 */
export interface EventQueryOptions {
  limit?: number;
  offset?: number;
  status?: MonitoredEventStatus;
}

// =============================================================================
// Repository
// =============================================================================

/**
 * Repository for monitored event CRUD operations
 */
export class MonitoredEventRepository {
  /**
   * Find an event by its ID
   */
  async findById(id: string): Promise<MonitoredEvent | null> {
    const result = await db
      .select()
      .from(monitoredEvents)
      .where(eq(monitoredEvents.id, id))
      .limit(1);

    return result[0] ? this.mapToEntity(result[0]) : null;
  }

  /**
   * Find an event by ID and verify ownership
   */
  async findByIdAndUserId(
    id: string,
    userId: string
  ): Promise<MonitoredEvent | null> {
    const result = await db
      .select()
      .from(monitoredEvents)
      .where(
        and(
          eq(monitoredEvents.id, id),
          eq(monitoredEvents.userId, userId)
        )
      )
      .limit(1);

    return result[0] ? this.mapToEntity(result[0]) : null;
  }

  /**
   * Find all events for a user with pagination
   */
  async findByUserId(
    userId: string,
    options: EventQueryOptions = {}
  ): Promise<MonitoredEvent[]> {
    const { limit = 50, offset = 0, status } = options;

    let query = db
      .select()
      .from(monitoredEvents)
      .where(eq(monitoredEvents.userId, userId))
      .orderBy(desc(monitoredEvents.receivedAt))
      .limit(limit)
      .offset(offset);

    if (status) {
      query = db
        .select()
        .from(monitoredEvents)
        .where(
          and(
            eq(monitoredEvents.userId, userId),
            eq(monitoredEvents.status, status)
          )
        )
        .orderBy(desc(monitoredEvents.receivedAt))
        .limit(limit)
        .offset(offset);
    }

    const results = await query;
    return results.map(this.mapToEntity);
  }

  /**
   * Find pending events for a user
   */
  async findPendingByUserId(userId: string): Promise<MonitoredEvent[]> {
    const results = await db
      .select()
      .from(monitoredEvents)
      .where(
        and(
          eq(monitoredEvents.userId, userId),
          eq(monitoredEvents.status, 'pending')
        )
      )
      .orderBy(desc(monitoredEvents.receivedAt));

    return results.map(this.mapToEntity);
  }

  /**
   * Find events by orchestrator run ID
   */
  async findByOrchestratorRunId(runId: string): Promise<MonitoredEvent | null> {
    const result = await db
      .select()
      .from(monitoredEvents)
      .where(eq(monitoredEvents.orchestratorRunId, runId))
      .limit(1);

    return result[0] ? this.mapToEntity(result[0]) : null;
  }

  /**
   * Create a new monitored event
   */
  async create(data: CreateMonitoredEventData): Promise<MonitoredEvent> {
    const result = await db
      .insert(monitoredEvents)
      .values({
        userId: data.userId,
        subscriptionId: data.subscriptionId ?? null,
        triggerType: data.triggerType,
        toolkit: data.toolkit,
        status: data.status ?? 'pending',
        payload: data.payload,
        parsedContext: data.parsedContext,
        requiresApproval: data.requiresApproval,
        receivedAt: new Date(),
      })
      .returning();

    return this.mapToEntity(result[0]);
  }

  /**
   * Update a monitored event
   */
  async update(
    id: string,
    data: UpdateMonitoredEventData
  ): Promise<MonitoredEvent | null> {
    const updateData: Record<string, unknown> = {};

    if (data.status !== undefined) {
      updateData.status = data.status;
    }

    if (data.orchestratorRunId !== undefined) {
      updateData.orchestratorRunId = data.orchestratorRunId;
    }

    if (data.sourceReplyId !== undefined) {
      updateData.sourceReplyId = data.sourceReplyId;
    }

    if (data.sourceReplyContent !== undefined) {
      updateData.sourceReplyContent = data.sourceReplyContent;
    }

    if (data.processedAt !== undefined) {
      updateData.processedAt = data.processedAt;
    }

    if (data.approvedAt !== undefined) {
      updateData.approvedAt = data.approvedAt;
    }

    if (Object.keys(updateData).length === 0) {
      return this.findById(id);
    }

    const result = await db
      .update(monitoredEvents)
      .set(updateData)
      .where(eq(monitoredEvents.id, id))
      .returning();

    return result[0] ? this.mapToEntity(result[0]) : null;
  }

  /**
   * Update event status
   */
  async updateStatus(
    id: string,
    status: MonitoredEventStatus
  ): Promise<MonitoredEvent | null> {
    const updateData: Record<string, unknown> = { status };

    // Set timestamps based on status
    if (status === 'approved') {
      updateData.approvedAt = new Date();
    }

    if (['approved', 'rejected', 'auto_started', 'in_progress', 'completed', 'failed'].includes(status)) {
      updateData.processedAt = new Date();
    }

    const result = await db
      .update(monitoredEvents)
      .set(updateData)
      .where(eq(monitoredEvents.id, id))
      .returning();

    return result[0] ? this.mapToEntity(result[0]) : null;
  }

  /**
   * Delete an event by ID
   * @returns true if deleted, false if not found
   */
  async delete(id: string): Promise<boolean> {
    const result = await db
      .delete(monitoredEvents)
      .where(eq(monitoredEvents.id, id))
      .returning({ id: monitoredEvents.id });

    return result.length > 0;
  }

  /**
   * Delete events older than a specified date
   * Used for cleanup job (30-day retention)
   * @returns The number of events deleted
   */
  async deleteOlderThan(date: Date): Promise<number> {
    const result = await db
      .delete(monitoredEvents)
      .where(lt(monitoredEvents.receivedAt, date))
      .returning({ id: monitoredEvents.id });

    return result.length;
  }

  /**
   * Delete all events for a user
   * @returns The number of events deleted
   */
  async deleteAllForUser(userId: string): Promise<number> {
    const result = await db
      .delete(monitoredEvents)
      .where(eq(monitoredEvents.userId, userId))
      .returning({ id: monitoredEvents.id });

    return result.length;
  }

  /**
   * Count events by status for a user
   */
  async countByStatus(
    userId: string,
    status: MonitoredEventStatus
  ): Promise<number> {
    const results = await db
      .select()
      .from(monitoredEvents)
      .where(
        and(
          eq(monitoredEvents.userId, userId),
          eq(monitoredEvents.status, status)
        )
      );

    return results.length;
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  /**
   * Map database row to domain entity
   */
  private mapToEntity(row: typeof monitoredEvents.$inferSelect): MonitoredEvent {
    return {
      id: row.id,
      userId: row.userId,
      subscriptionId: row.subscriptionId,
      triggerType: row.triggerType as TriggerType,
      toolkit: row.toolkit as MonitoringToolkit,
      status: row.status as MonitoredEventStatus,
      payload: row.payload as Record<string, unknown>,
      parsedContext: row.parsedContext as ParsedTriggerContext,
      orchestratorRunId: row.orchestratorRunId,
      sourceReplyId: row.sourceReplyId,
      sourceReplyContent: row.sourceReplyContent,
      requiresApproval: row.requiresApproval,
      receivedAt: row.receivedAt,
      processedAt: row.processedAt,
      approvedAt: row.approvedAt,
    };
  }
}
