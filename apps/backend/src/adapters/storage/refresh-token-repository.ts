// =============================================================================
// Refresh Token Repository - Storage Adapter
// =============================================================================
// Handles all database operations for refresh tokens.
// Tokens are stored as SHA-256 hashes for security.

import { eq, lt } from 'drizzle-orm';
import { db } from '../../infrastructure/db/client.js';
import { refreshTokens } from '../../infrastructure/db/schema.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Refresh token entity as returned from the database
 */
export interface RefreshToken {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  createdAt: Date;
}

/**
 * Data required to create a new refresh token
 */
export interface CreateRefreshTokenData {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
}

// =============================================================================
// Repository
// =============================================================================

/**
 * Repository for refresh token operations
 */
export class RefreshTokenRepository {
  /**
   * Create a new refresh token
   */
  async create(data: CreateRefreshTokenData): Promise<RefreshToken> {
    const result = await db
      .insert(refreshTokens)
      .values({
        userId: data.userId,
        tokenHash: data.tokenHash,
        expiresAt: data.expiresAt,
      })
      .returning();

    return result[0];
  }

  /**
   * Find a refresh token by its hash
   */
  async findByHash(tokenHash: string): Promise<RefreshToken | null> {
    const result = await db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, tokenHash))
      .limit(1);

    return result[0] || null;
  }

  /**
   * Find a refresh token by ID
   */
  async findById(id: string): Promise<RefreshToken | null> {
    const result = await db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.id, id))
      .limit(1);

    return result[0] || null;
  }

  /**
   * Delete a refresh token by ID
   */
  async delete(id: string): Promise<boolean> {
    const result = await db
      .delete(refreshTokens)
      .where(eq(refreshTokens.id, id))
      .returning({ id: refreshTokens.id });

    return result.length > 0;
  }

  /**
   * Delete a refresh token by its hash
   */
  async deleteByHash(tokenHash: string): Promise<boolean> {
    const result = await db
      .delete(refreshTokens)
      .where(eq(refreshTokens.tokenHash, tokenHash))
      .returning({ id: refreshTokens.id });

    return result.length > 0;
  }

  /**
   * Delete all refresh tokens for a user
   * Used for "logout from all devices" functionality
   */
  async deleteAllForUser(userId: string): Promise<number> {
    const result = await db
      .delete(refreshTokens)
      .where(eq(refreshTokens.userId, userId))
      .returning({ id: refreshTokens.id });

    return result.length;
  }

  /**
   * Delete all expired tokens
   * Should be called periodically for cleanup
   * Returns the number of tokens deleted
   */
  async deleteExpired(): Promise<number> {
    const now = new Date();
    const result = await db
      .delete(refreshTokens)
      .where(lt(refreshTokens.expiresAt, now))
      .returning({ id: refreshTokens.id });

    return result.length;
  }

  /**
   * Count active tokens for a user
   * Useful for session management
   */
  async countByUser(userId: string): Promise<number> {
    const result = await db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.userId, userId));

    return result.length;
  }
}
