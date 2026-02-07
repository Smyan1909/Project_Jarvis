// =============================================================================
// Slack Priority Contact Repository - Storage Adapter
// =============================================================================
// Handles all database operations for the slack_priority_contacts table.
// Stores Slack users whose messages should be prioritized by the monitoring agent.

import { eq, and } from 'drizzle-orm';
import { db } from '../../infrastructure/db/client.js';
import { slackPriorityContacts } from '../../infrastructure/db/schema.js';
import type {
  SlackPriorityContact,
  PriorityLevel,
  PriorityContactInput,
} from '@project-jarvis/shared-types';

// =============================================================================
// Types
// =============================================================================

/**
 * Data required to create a new priority contact
 */
export interface CreatePriorityContactData {
  userId: string;
  slackUserId: string;
  slackUserName?: string;
  priority?: PriorityLevel;
  autoStart?: boolean;
}

// =============================================================================
// Repository
// =============================================================================

/**
 * Repository for Slack priority contact CRUD operations
 */
export class SlackPriorityContactRepository {
  /**
   * Find a contact by its ID
   */
  async findById(id: string): Promise<SlackPriorityContact | null> {
    const result = await db
      .select()
      .from(slackPriorityContacts)
      .where(eq(slackPriorityContacts.id, id))
      .limit(1);

    return result[0] ? this.mapToEntity(result[0]) : null;
  }

  /**
   * Find a contact by ID and verify ownership
   */
  async findByIdAndUserId(
    id: string,
    userId: string
  ): Promise<SlackPriorityContact | null> {
    const result = await db
      .select()
      .from(slackPriorityContacts)
      .where(
        and(
          eq(slackPriorityContacts.id, id),
          eq(slackPriorityContacts.userId, userId)
        )
      )
      .limit(1);

    return result[0] ? this.mapToEntity(result[0]) : null;
  }

  /**
   * Find all priority contacts for a user
   */
  async findByUserId(userId: string): Promise<SlackPriorityContact[]> {
    const results = await db
      .select()
      .from(slackPriorityContacts)
      .where(eq(slackPriorityContacts.userId, userId))
      .orderBy(slackPriorityContacts.createdAt);

    return results.map(this.mapToEntity);
  }

  /**
   * Find a contact by user and Slack user ID
   * Used when processing Slack messages to check priority
   */
  async findByUserAndSlackUserId(
    userId: string,
    slackUserId: string
  ): Promise<SlackPriorityContact | null> {
    const result = await db
      .select()
      .from(slackPriorityContacts)
      .where(
        and(
          eq(slackPriorityContacts.userId, userId),
          eq(slackPriorityContacts.slackUserId, slackUserId)
        )
      )
      .limit(1);

    return result[0] ? this.mapToEntity(result[0]) : null;
  }

  /**
   * Check if a Slack user is a priority contact
   */
  async isPriorityContact(
    userId: string,
    slackUserId: string
  ): Promise<boolean> {
    const result = await this.findByUserAndSlackUserId(userId, slackUserId);
    return result !== null;
  }

  /**
   * Check if a Slack user is a high-priority contact
   */
  async isHighPriorityContact(
    userId: string,
    slackUserId: string
  ): Promise<boolean> {
    const contact = await this.findByUserAndSlackUserId(userId, slackUserId);
    return contact?.priority === 'high';
  }

  /**
   * Get priority info for a Slack user
   */
  async getPriorityInfo(
    userId: string,
    slackUserId: string
  ): Promise<{ isPriority: boolean; priority: PriorityLevel | null; autoStart: boolean }> {
    const contact = await this.findByUserAndSlackUserId(userId, slackUserId);
    
    if (!contact) {
      return { isPriority: false, priority: null, autoStart: false };
    }

    return {
      isPriority: true,
      priority: contact.priority,
      autoStart: contact.autoStart,
    };
  }

  /**
   * Create a new priority contact
   */
  async create(data: CreatePriorityContactData): Promise<SlackPriorityContact> {
    const result = await db
      .insert(slackPriorityContacts)
      .values({
        userId: data.userId,
        slackUserId: data.slackUserId,
        slackUserName: data.slackUserName ?? null,
        priority: data.priority ?? 'normal',
        autoStart: data.autoStart ?? false,
      })
      .returning();

    return this.mapToEntity(result[0]);
  }

  /**
   * Update a priority contact
   */
  async update(
    id: string,
    data: Partial<PriorityContactInput>
  ): Promise<SlackPriorityContact | null> {
    const updateData: Record<string, unknown> = {};

    if (data.slackUserName !== undefined) {
      updateData.slackUserName = data.slackUserName;
    }

    if (data.priority !== undefined) {
      updateData.priority = data.priority;
    }

    if (data.autoStart !== undefined) {
      updateData.autoStart = data.autoStart;
    }

    if (Object.keys(updateData).length === 0) {
      return this.findById(id);
    }

    const result = await db
      .update(slackPriorityContacts)
      .set(updateData)
      .where(eq(slackPriorityContacts.id, id))
      .returning();

    return result[0] ? this.mapToEntity(result[0]) : null;
  }

  /**
   * Delete a contact by ID
   * @returns true if deleted, false if not found
   */
  async delete(id: string): Promise<boolean> {
    const result = await db
      .delete(slackPriorityContacts)
      .where(eq(slackPriorityContacts.id, id))
      .returning({ id: slackPriorityContacts.id });

    return result.length > 0;
  }

  /**
   * Delete all contacts for a user
   * @returns The number of contacts deleted
   */
  async deleteAllForUser(userId: string): Promise<number> {
    const result = await db
      .delete(slackPriorityContacts)
      .where(eq(slackPriorityContacts.userId, userId))
      .returning({ id: slackPriorityContacts.id });

    return result.length;
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  /**
   * Map database row to domain entity
   */
  private mapToEntity(
    row: typeof slackPriorityContacts.$inferSelect
  ): SlackPriorityContact {
    return {
      id: row.id,
      userId: row.userId,
      slackUserId: row.slackUserId,
      slackUserName: row.slackUserName,
      priority: row.priority as PriorityLevel,
      autoStart: row.autoStart,
      createdAt: row.createdAt,
    };
  }
}
