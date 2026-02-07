// =============================================================================
// Conversation Summary Repository - Storage Adapter
// =============================================================================
// Handles database operations for the conversation_summaries table.
// Stores rolling summaries of older conversation messages to enable
// efficient context loading for continuous chat.

import { eq } from 'drizzle-orm';
import { db } from '../../infrastructure/db/client.js';
import { conversationSummaries } from '../../infrastructure/db/schema.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Conversation summary entity as returned from the database
 */
export interface ConversationSummary {
  id: string;
  userId: string;
  content: string;
  summarizedMessageCount: number;
  summarizedUpToMessageId: string | null;
  originalTokenCount: number;
  summaryTokenCount: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Data required to create or update a conversation summary
 */
export interface UpsertSummaryData {
  content: string;
  summarizedMessageCount: number;
  summarizedUpToMessageId: string | null;
  originalTokenCount: number;
  summaryTokenCount: number;
}

// =============================================================================
// Repository
// =============================================================================

/**
 * Repository for conversation summary CRUD operations.
 * Each user has at most one summary (the latest rolling summary).
 */
export class ConversationSummaryRepository {
  /**
   * Find the conversation summary for a user
   */
  async findByUser(userId: string): Promise<ConversationSummary | null> {
    const result = await db
      .select()
      .from(conversationSummaries)
      .where(eq(conversationSummaries.userId, userId))
      .limit(1);

    return result[0] || null;
  }

  /**
   * Create or update the conversation summary for a user.
   * Uses INSERT ... ON CONFLICT for atomic upsert.
   */
  async upsert(userId: string, data: UpsertSummaryData): Promise<ConversationSummary> {
    const result = await db
      .insert(conversationSummaries)
      .values({
        userId,
        content: data.content,
        summarizedMessageCount: data.summarizedMessageCount,
        summarizedUpToMessageId: data.summarizedUpToMessageId,
        originalTokenCount: data.originalTokenCount,
        summaryTokenCount: data.summaryTokenCount,
      })
      .onConflictDoUpdate({
        target: conversationSummaries.userId,
        set: {
          content: data.content,
          summarizedMessageCount: data.summarizedMessageCount,
          summarizedUpToMessageId: data.summarizedUpToMessageId,
          originalTokenCount: data.originalTokenCount,
          summaryTokenCount: data.summaryTokenCount,
          updatedAt: new Date(),
        },
      })
      .returning();

    return result[0];
  }

  /**
   * Delete the conversation summary for a user.
   * Used when clearing conversation history.
   */
  async deleteByUser(userId: string): Promise<boolean> {
    const result = await db
      .delete(conversationSummaries)
      .where(eq(conversationSummaries.userId, userId))
      .returning({ id: conversationSummaries.id });

    return result.length > 0;
  }

  /**
   * Check if a user has a conversation summary
   */
  async existsByUser(userId: string): Promise<boolean> {
    const result = await db
      .select({ id: conversationSummaries.id })
      .from(conversationSummaries)
      .where(eq(conversationSummaries.userId, userId))
      .limit(1);

    return result.length > 0;
  }
}
