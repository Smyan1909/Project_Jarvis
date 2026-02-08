// =============================================================================
// Message Repository - Storage Adapter
// =============================================================================
// Handles all database operations for the messages table.
// Messages store the conversation history for users, including
// user messages, assistant responses, system prompts, and tool results.
// Supports both run-scoped queries and user-scoped queries for continuous chat.

import { eq, asc, desc, sql, and, gt } from 'drizzle-orm';
import { db } from '../../infrastructure/db/client.js';
import { messages } from '../../infrastructure/db/schema.js';
import type { MessageMetadata, StoredToolCall } from '@project-jarvis/shared-types';

// =============================================================================
// Types
// =============================================================================

/**
 * Valid message roles
 */
export type MessageRole = 'user' | 'assistant' | 'system' | 'tool';

/**
 * Message entity as returned from the database
 */
export interface Message {
  id: string;
  userId: string;
  runId: string | null;
  role: string;
  content: string;
  toolCallId: string | null;
  toolCalls: StoredToolCall[] | null;
  metadata: MessageMetadata | null;
  createdAt: Date;
}

/**
 * Data required to create a new message
 */
export interface CreateMessageData {
  userId: string;
  runId?: string | null;
  role: MessageRole;
  content: string;
  toolCallId?: string;
  toolCalls?: StoredToolCall[];
  metadata?: MessageMetadata;
}

/**
 * Data for creating multiple messages in batch
 */
export interface BatchCreateMessageData {
  role: MessageRole;
  content: string;
  toolCallId?: string;
  toolCalls?: StoredToolCall[];
  metadata?: MessageMetadata;
}

// =============================================================================
// Repository
// =============================================================================

/**
 * Repository for message CRUD operations
 */
export class MessageRepository {
  // ===========================================================================
  // Create Operations
  // ===========================================================================

  /**
   * Create a new message
   */
  async create(data: CreateMessageData): Promise<Message> {
    const result = await db
      .insert(messages)
      .values({
        userId: data.userId,
        runId: data.runId ?? null,
        role: data.role,
        content: data.content,
        toolCallId: data.toolCallId,
        toolCalls: data.toolCalls,
        metadata: data.metadata ?? {},
      })
      .returning();

    return this.mapToMessage(result[0]);
  }

  /**
   * Create multiple messages for a user (optionally within a run)
   */
  async createMany(userId: string, data: BatchCreateMessageData[], runId?: string): Promise<Message[]> {
    if (data.length === 0) {
      return [];
    }

    const values = data.map(msg => ({
      userId,
      runId: runId ?? null,
      role: msg.role,
      content: msg.content,
      toolCallId: msg.toolCallId,
      toolCalls: msg.toolCalls,
      metadata: msg.metadata ?? {},
    }));

    const result = await db
      .insert(messages)
      .values(values)
      .returning();

    return result.map(r => this.mapToMessage(r));
  }

  // ===========================================================================
  // Read Operations - By ID
  // ===========================================================================

  /**
   * Find a message by ID
   */
  async findById(id: string): Promise<Message | null> {
    const result = await db
      .select()
      .from(messages)
      .where(eq(messages.id, id))
      .limit(1);

    return result[0] ? this.mapToMessage(result[0]) : null;
  }

  /**
   * Find a message by ID with user ownership check
   */
  async findByIdAndUser(id: string, userId: string): Promise<Message | null> {
    const result = await db
      .select()
      .from(messages)
      .where(and(eq(messages.id, id), eq(messages.userId, userId)))
      .limit(1);

    return result[0] ? this.mapToMessage(result[0]) : null;
  }

  // ===========================================================================
  // Read Operations - By Run (legacy support)
  // ===========================================================================

  /**
   * Find all messages for a run
   * Ordered by createdAt ascending (chronological order)
   */
  async findByRun(runId: string): Promise<Message[]> {
    const result = await db
      .select()
      .from(messages)
      .where(eq(messages.runId, runId))
      .orderBy(asc(messages.createdAt));

    return result.map(r => this.mapToMessage(r));
  }

  /**
   * Find messages by role for a run
   */
  async findByRunAndRole(runId: string, role: MessageRole): Promise<Message[]> {
    const result = await db
      .select()
      .from(messages)
      .where(and(eq(messages.runId, runId), eq(messages.role, role)))
      .orderBy(asc(messages.createdAt));

    return result.map(r => this.mapToMessage(r));
  }

  /**
   * Get the last N messages for a run
   */
  async findLastNByRun(runId: string, n: number): Promise<Message[]> {
    const result = await db
      .select()
      .from(messages)
      .where(eq(messages.runId, runId))
      .orderBy(desc(messages.createdAt))
      .limit(n);

    return result.reverse().map(r => this.mapToMessage(r));
  }

  /**
   * Count messages in a run
   */
  async countByRun(runId: string): Promise<number> {
    const result = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(messages)
      .where(eq(messages.runId, runId));

    return result[0]?.count || 0;
  }

  // ===========================================================================
  // Read Operations - By User (for continuous chat history)
  // ===========================================================================

  /**
   * Find recent messages for a user (for loading conversation history)
   * Ordered by createdAt ascending (chronological order)
   */
  async findRecentByUser(userId: string, limit: number = 30): Promise<Message[]> {
    // Get most recent messages in reverse order, then reverse for chronological
    const result = await db
      .select()
      .from(messages)
      .where(eq(messages.userId, userId))
      .orderBy(desc(messages.createdAt))
      .limit(limit);

    return result.reverse().map(r => this.mapToMessage(r));
  }

  /**
   * Find messages for a user after a specific message ID
   * Used for loading messages after a summarization point
   */
  async findByUserAfterMessage(userId: string, afterMessageId: string, limit: number = 100): Promise<Message[]> {
    // First get the timestamp of the reference message
    const refMessage = await this.findById(afterMessageId);
    if (!refMessage) {
      return this.findRecentByUser(userId, limit);
    }

    const result = await db
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.userId, userId),
          gt(messages.createdAt, refMessage.createdAt)
        )
      )
      .orderBy(asc(messages.createdAt))
      .limit(limit);

    return result.map(r => this.mapToMessage(r));
  }

  /**
   * Count total messages for a user
   * Used for determining when to trigger summarization
   */
  async countByUser(userId: string): Promise<number> {
    const result = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(messages)
      .where(eq(messages.userId, userId));

    return result[0]?.count || 0;
  }

  /**
   * Count messages for a user after a specific message
   * Used for determining unsummarized message count
   */
  async countByUserAfterMessage(userId: string, afterMessageId: string): Promise<number> {
    const refMessage = await this.findById(afterMessageId);
    if (!refMessage) {
      return this.countByUser(userId);
    }

    const result = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(messages)
      .where(
        and(
          eq(messages.userId, userId),
          gt(messages.createdAt, refMessage.createdAt)
        )
      );

    return result[0]?.count || 0;
  }

  /**
   * Get the last message for a user (for time gap calculation)
   */
  async findLastByUser(userId: string): Promise<Message | null> {
    const result = await db
      .select()
      .from(messages)
      .where(eq(messages.userId, userId))
      .orderBy(desc(messages.createdAt))
      .limit(1);

    return result[0] ? this.mapToMessage(result[0]) : null;
  }

  // ===========================================================================
  // Update Operations
  // ===========================================================================

  /**
   * Update message content
   */
  async updateContent(id: string, content: string): Promise<Message | null> {
    const result = await db
      .update(messages)
      .set({ content })
      .where(eq(messages.id, id))
      .returning();

    return result[0] ? this.mapToMessage(result[0]) : null;
  }

  /**
   * Update message metadata
   */
  async updateMetadata(id: string, metadata: MessageMetadata): Promise<Message | null> {
    const result = await db
      .update(messages)
      .set({ metadata })
      .where(eq(messages.id, id))
      .returning();

    return result[0] ? this.mapToMessage(result[0]) : null;
  }

  /**
   * Append content to an existing message
   * Atomic operation for streaming updates
   */
  async appendContent(id: string, additionalContent: string): Promise<Message | null> {
    const result = await db
      .update(messages)
      .set({
        content: sql`${messages.content} || ${additionalContent}`,
      })
      .where(eq(messages.id, id))
      .returning();

    return result[0] ? this.mapToMessage(result[0]) : null;
  }

  // ===========================================================================
  // Delete Operations
  // ===========================================================================

  /**
   * Delete a message by ID
   */
  async delete(id: string): Promise<boolean> {
    const result = await db
      .delete(messages)
      .where(eq(messages.id, id))
      .returning({ id: messages.id });

    return result.length > 0;
  }

  /**
   * Delete a message by ID with user ownership check
   * Used for user-controlled message deletion
   */
  async deleteByIdAndUser(id: string, userId: string): Promise<boolean> {
    const result = await db
      .delete(messages)
      .where(and(eq(messages.id, id), eq(messages.userId, userId)))
      .returning({ id: messages.id });

    return result.length > 0;
  }

  /**
   * Delete all messages for a run
   */
  async deleteByRun(runId: string): Promise<number> {
    const result = await db
      .delete(messages)
      .where(eq(messages.runId, runId))
      .returning({ id: messages.id });

    return result.length;
  }

  /**
   * Delete all messages for a user
   * Used for clearing conversation history
   */
  async deleteAllByUser(userId: string): Promise<number> {
    const result = await db
      .delete(messages)
      .where(eq(messages.userId, userId))
      .returning({ id: messages.id });

    return result.length;
  }

  // ===========================================================================
  // Tool Call Operations
  // ===========================================================================

  /**
   * Find tool result message by tool call ID
   */
  async findByToolCallId(toolCallId: string): Promise<Message | null> {
    const result = await db
      .select()
      .from(messages)
      .where(eq(messages.toolCallId, toolCallId))
      .limit(1);

    return result[0] ? this.mapToMessage(result[0]) : null;
  }

  // ===========================================================================
  // Helper Methods
  // ===========================================================================

  /**
   * Map database row to Message type
   */
  private mapToMessage(row: typeof messages.$inferSelect): Message {
    return {
      id: row.id,
      userId: row.userId,
      runId: row.runId,
      role: row.role,
      content: row.content,
      toolCallId: row.toolCallId,
      toolCalls: row.toolCalls as StoredToolCall[] | null,
      metadata: row.metadata as MessageMetadata | null,
      createdAt: row.createdAt,
    };
  }
}
