// =============================================================================
// Trigger Subscription Repository - Storage Adapter
// =============================================================================
// Handles all database operations for the trigger_subscriptions table.
// Maps Composio triggers to users for the monitoring agent.

import { eq, and, desc } from 'drizzle-orm';
import { db } from '../../infrastructure/db/client.js';
import { triggerSubscriptions } from '../../infrastructure/db/schema.js';
import type {
  TriggerSubscription,
  TriggerType,
  MonitoringToolkit,
  TriggerConfigUpdate,
} from '@project-jarvis/shared-types';

// =============================================================================
// Types
// =============================================================================

/**
 * Data required to create a new trigger subscription
 */
export interface CreateTriggerSubscriptionData {
  userId: string;
  triggerId: string;
  triggerType: TriggerType;
  toolkit: MonitoringToolkit;
  config?: Record<string, unknown>;
  autoStart?: boolean;
}

// =============================================================================
// Repository
// =============================================================================

/**
 * Repository for trigger subscription CRUD operations
 */
export class TriggerSubscriptionRepository {
  /**
   * Find a subscription by its ID
   */
  async findById(id: string): Promise<TriggerSubscription | null> {
    const result = await db
      .select()
      .from(triggerSubscriptions)
      .where(eq(triggerSubscriptions.id, id))
      .limit(1);

    return result[0] ? this.mapToEntity(result[0]) : null;
  }

  /**
   * Find a subscription by Composio trigger ID
   * This is the primary lookup used when processing webhooks
   */
  async findByTriggerId(triggerId: string): Promise<TriggerSubscription | null> {
    const result = await db
      .select()
      .from(triggerSubscriptions)
      .where(eq(triggerSubscriptions.triggerId, triggerId))
      .limit(1);

    return result[0] ? this.mapToEntity(result[0]) : null;
  }

  /**
   * Find all subscriptions for a user
   */
  async findByUserId(userId: string): Promise<TriggerSubscription[]> {
    const results = await db
      .select()
      .from(triggerSubscriptions)
      .where(eq(triggerSubscriptions.userId, userId))
      .orderBy(desc(triggerSubscriptions.createdAt));

    return results.map(this.mapToEntity);
  }

  /**
   * Find all enabled subscriptions for a user
   */
  async findEnabledByUserId(userId: string): Promise<TriggerSubscription[]> {
    const results = await db
      .select()
      .from(triggerSubscriptions)
      .where(
        and(
          eq(triggerSubscriptions.userId, userId),
          eq(triggerSubscriptions.enabled, true)
        )
      )
      .orderBy(desc(triggerSubscriptions.createdAt));

    return results.map(this.mapToEntity);
  }

  /**
   * Find a subscription by user and trigger type
   */
  async findByUserAndType(
    userId: string,
    triggerType: TriggerType
  ): Promise<TriggerSubscription | null> {
    const result = await db
      .select()
      .from(triggerSubscriptions)
      .where(
        and(
          eq(triggerSubscriptions.userId, userId),
          eq(triggerSubscriptions.triggerType, triggerType)
        )
      )
      .limit(1);

    return result[0] ? this.mapToEntity(result[0]) : null;
  }

  /**
   * Find all subscriptions for a user and toolkit
   */
  async findByUserAndToolkit(
    userId: string,
    toolkit: MonitoringToolkit
  ): Promise<TriggerSubscription[]> {
    const results = await db
      .select()
      .from(triggerSubscriptions)
      .where(
        and(
          eq(triggerSubscriptions.userId, userId),
          eq(triggerSubscriptions.toolkit, toolkit)
        )
      )
      .orderBy(desc(triggerSubscriptions.createdAt));

    return results.map(this.mapToEntity);
  }

  /**
   * Create a new trigger subscription
   */
  async create(data: CreateTriggerSubscriptionData): Promise<TriggerSubscription> {
    const result = await db
      .insert(triggerSubscriptions)
      .values({
        userId: data.userId,
        triggerId: data.triggerId,
        triggerType: data.triggerType,
        toolkit: data.toolkit,
        config: data.config ?? {},
        autoStart: data.autoStart ?? false,
        enabled: true,
      })
      .returning();

    return this.mapToEntity(result[0]);
  }

  /**
   * Update a trigger subscription
   */
  async update(
    id: string,
    data: TriggerConfigUpdate
  ): Promise<TriggerSubscription | null> {
    const updateData: Record<string, unknown> = {
      updatedAt: new Date(),
    };

    if (data.autoStart !== undefined) {
      updateData.autoStart = data.autoStart;
    }

    if (data.enabled !== undefined) {
      updateData.enabled = data.enabled;
    }

    if (data.config !== undefined) {
      updateData.config = data.config;
    }

    const result = await db
      .update(triggerSubscriptions)
      .set(updateData)
      .where(eq(triggerSubscriptions.id, id))
      .returning();

    return result[0] ? this.mapToEntity(result[0]) : null;
  }

  /**
   * Delete a subscription by ID
   * @returns true if deleted, false if not found
   */
  async delete(id: string): Promise<boolean> {
    const result = await db
      .delete(triggerSubscriptions)
      .where(eq(triggerSubscriptions.id, id))
      .returning({ id: triggerSubscriptions.id });

    return result.length > 0;
  }

  /**
   * Delete a subscription by Composio trigger ID
   * @returns true if deleted, false if not found
   */
  async deleteByTriggerId(triggerId: string): Promise<boolean> {
    const result = await db
      .delete(triggerSubscriptions)
      .where(eq(triggerSubscriptions.triggerId, triggerId))
      .returning({ id: triggerSubscriptions.id });

    return result.length > 0;
  }

  /**
   * Delete all subscriptions for a user
   * @returns The number of subscriptions deleted
   */
  async deleteAllForUser(userId: string): Promise<number> {
    const result = await db
      .delete(triggerSubscriptions)
      .where(eq(triggerSubscriptions.userId, userId))
      .returning({ id: triggerSubscriptions.id });

    return result.length;
  }

  /**
   * Delete all subscriptions for a user and toolkit
   * @returns The number of subscriptions deleted
   */
  async deleteByUserAndToolkit(
    userId: string,
    toolkit: MonitoringToolkit
  ): Promise<number> {
    const result = await db
      .delete(triggerSubscriptions)
      .where(
        and(
          eq(triggerSubscriptions.userId, userId),
          eq(triggerSubscriptions.toolkit, toolkit)
        )
      )
      .returning({ id: triggerSubscriptions.id });

    return result.length;
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  /**
   * Map database row to domain entity
   */
  private mapToEntity(row: typeof triggerSubscriptions.$inferSelect): TriggerSubscription {
    return {
      id: row.id,
      userId: row.userId,
      triggerId: row.triggerId,
      triggerType: row.triggerType as TriggerType,
      toolkit: row.toolkit as MonitoringToolkit,
      config: row.config as Record<string, unknown>,
      autoStart: row.autoStart,
      enabled: row.enabled,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
