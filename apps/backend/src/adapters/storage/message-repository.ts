// =============================================================================
// Message Repository - Storage Adapter
// =============================================================================
// Handles all database operations for the messages table.
// Messages store the conversation history within an agent run, including
// user messages, assistant responses, system prompts, and tool results.

import { eq, asc, sql, and } from 'drizzle-orm';
import { db } from '../../infrastructure/db/client.js';
import { messages } from '../../infrastructure/db/schema.js';

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
  runId: string;
  role: string;
  content: string;
  toolCallId: string | null;
  createdAt: Date;
}

/**
 * Data required to create a new message
 */
export interface CreateMessageData {
  runId: string;
  role: MessageRole;
  content: string;
  toolCallId?: string;
}

/**
 * Data for creating multiple messages in batch
 */
export interface BatchCreateMessageData {
  role: MessageRole;
  content: string;
  toolCallId?: string;
}

// =============================================================================
// Repository
// =============================================================================

/**
 * Repository for message CRUD operations
 */
export class MessageRepository {
  /**
   * Create a new message
   */
  async create(data: CreateMessageData): Promise<Message> {
    const result = await db
      .insert(messages)
      .values({
        runId: data.runId,
        role: data.role,
        content: data.content,
        toolCallId: data.toolCallId,
      })
      .returning();

    return result[0];
  }

  /**
   * Create multiple messages for a run
   * Useful for initializing a run with system message and user message
   */
  async createMany(runId: string, data: BatchCreateMessageData[]): Promise<Message[]> {
    if (data.length === 0) {
      return [];
    }

    const values = data.map(msg => ({
      runId,
      role: msg.role,
      content: msg.content,
      toolCallId: msg.toolCallId,
    }));

    const result = await db
      .insert(messages)
      .values(values)
      .returning();

    return result;
  }

  /**
   * Find a message by ID
   */
  async findById(id: string): Promise<Message | null> {
    const result = await db
      .select()
      .from(messages)
      .where(eq(messages.id, id))
      .limit(1);

    return result[0] || null;
  }

  /**
   * Find all messages for a run
   * Ordered by createdAt ascending (chronological order)
   */
  async findByRun(runId: string): Promise<Message[]> {
    return db
      .select()
      .from(messages)
      .where(eq(messages.runId, runId))
      .orderBy(asc(messages.createdAt));
  }

  /**
   * Find messages by role for a run
   */
  async findByRunAndRole(runId: string, role: MessageRole): Promise<Message[]> {
    return db
      .select()
      .from(messages)
      .where(and(eq(messages.runId, runId), eq(messages.role, role)))
      .orderBy(asc(messages.createdAt));
  }

  /**
   * Get the last N messages for a run
   * Useful for context window management
   */
  async findLastN(runId: string, n: number): Promise<Message[]> {
    // Get messages in reverse order then reverse the result
    const result = await db
      .select()
      .from(messages)
      .where(eq(messages.runId, runId))
      .orderBy(sql`${messages.createdAt} DESC`)
      .limit(n);

    // Reverse to get chronological order
    return result.reverse();
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

  /**
   * Delete a message
   * Returns true if message was deleted, false if not found
   */
  async delete(id: string): Promise<boolean> {
    const result = await db
      .delete(messages)
      .where(eq(messages.id, id))
      .returning({ id: messages.id });

    return result.length > 0;
  }

  /**
   * Delete all messages for a run
   * Returns the number of deleted messages
   */
  async deleteByRun(runId: string): Promise<number> {
    const result = await db
      .delete(messages)
      .where(eq(messages.runId, runId))
      .returning({ id: messages.id });

    return result.length;
  }

  /**
   * Find tool result message by tool call ID
   */
  async findByToolCallId(toolCallId: string): Promise<Message | null> {
    const result = await db
      .select()
      .from(messages)
      .where(eq(messages.toolCallId, toolCallId))
      .limit(1);

    return result[0] || null;
  }

  /**
   * Update message content
   * Used for streaming - appending tokens to assistant messages
   */
  async updateContent(id: string, content: string): Promise<Message | null> {
    const result = await db
      .update(messages)
      .set({ content })
      .where(eq(messages.id, id))
      .returning();

    return result[0] || null;
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

    return result[0] || null;
  }
}
