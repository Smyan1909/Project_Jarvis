// =============================================================================
// Push Token Repository - Storage Adapter
// =============================================================================
// Handles all database operations for the push_tokens table.
// Stores Expo push notification tokens for mobile devices.

import { eq, and } from 'drizzle-orm';
import { db } from '../../infrastructure/db/client.js';
import { pushTokens } from '../../infrastructure/db/schema.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Push token entity as returned from the database
 */
export interface PushToken {
  id: string;
  userId: string;
  token: string;
  platform: 'ios' | 'android';
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Data required to create/update a push token
 */
export interface UpsertPushTokenData {
  userId: string;
  token: string;
  platform: 'ios' | 'android';
}

// =============================================================================
// Repository
// =============================================================================

/**
 * Repository for push token CRUD operations
 */
export class PushTokenRepository {
  /**
   * Find a token by its ID
   */
  async findById(id: string): Promise<PushToken | null> {
    const result = await db
      .select()
      .from(pushTokens)
      .where(eq(pushTokens.id, id))
      .limit(1);

    return result[0] ? this.mapToEntity(result[0]) : null;
  }

  /**
   * Find all tokens for a user
   */
  async findByUserId(userId: string): Promise<PushToken[]> {
    const results = await db
      .select()
      .from(pushTokens)
      .where(eq(pushTokens.userId, userId))
      .orderBy(pushTokens.createdAt);

    return results.map(this.mapToEntity);
  }

  /**
   * Find a token by user and token value
   */
  async findByUserAndToken(
    userId: string,
    token: string
  ): Promise<PushToken | null> {
    const result = await db
      .select()
      .from(pushTokens)
      .where(
        and(
          eq(pushTokens.userId, userId),
          eq(pushTokens.token, token)
        )
      )
      .limit(1);

    return result[0] ? this.mapToEntity(result[0]) : null;
  }

  /**
   * Check if a token exists for a user
   */
  async exists(userId: string, token: string): Promise<boolean> {
    const result = await this.findByUserAndToken(userId, token);
    return result !== null;
  }

  /**
   * Create or update a push token
   * If the token already exists for this user, update the timestamp
   * If it's a new token, create it
   */
  async upsert(data: UpsertPushTokenData): Promise<PushToken> {
    // Check if token already exists
    const existing = await this.findByUserAndToken(data.userId, data.token);

    if (existing) {
      // Update the timestamp
      const result = await db
        .update(pushTokens)
        .set({
          platform: data.platform,
          updatedAt: new Date(),
        })
        .where(eq(pushTokens.id, existing.id))
        .returning();

      return this.mapToEntity(result[0]);
    }

    // Create new token
    const result = await db
      .insert(pushTokens)
      .values({
        userId: data.userId,
        token: data.token,
        platform: data.platform,
      })
      .returning();

    return this.mapToEntity(result[0]);
  }

  /**
   * Delete a token by ID
   * @returns true if deleted, false if not found
   */
  async delete(id: string): Promise<boolean> {
    const result = await db
      .delete(pushTokens)
      .where(eq(pushTokens.id, id))
      .returning({ id: pushTokens.id });

    return result.length > 0;
  }

  /**
   * Delete a token by user and token value
   * @returns true if deleted, false if not found
   */
  async deleteByUserAndToken(userId: string, token: string): Promise<boolean> {
    const result = await db
      .delete(pushTokens)
      .where(
        and(
          eq(pushTokens.userId, userId),
          eq(pushTokens.token, token)
        )
      )
      .returning({ id: pushTokens.id });

    return result.length > 0;
  }

  /**
   * Delete all tokens for a user
   * @returns The number of tokens deleted
   */
  async deleteAllForUser(userId: string): Promise<number> {
    const result = await db
      .delete(pushTokens)
      .where(eq(pushTokens.userId, userId))
      .returning({ id: pushTokens.id });

    return result.length;
  }

  /**
   * Get all push tokens (for bulk notifications)
   * Note: Use with caution for large user bases
   */
  async findAll(): Promise<PushToken[]> {
    const results = await db
      .select()
      .from(pushTokens)
      .orderBy(pushTokens.createdAt);

    return results.map(this.mapToEntity);
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  /**
   * Map database row to domain entity
   */
  private mapToEntity(row: typeof pushTokens.$inferSelect): PushToken {
    return {
      id: row.id,
      userId: row.userId,
      token: row.token,
      platform: row.platform as 'ios' | 'android',
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
