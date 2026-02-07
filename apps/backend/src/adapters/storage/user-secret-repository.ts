// =============================================================================
// User Secret Repository - Storage Adapter
// =============================================================================
// Handles all database operations for the user_secrets table.
// Stores encrypted API keys and tokens for users.

import { eq, and } from 'drizzle-orm';
import { db } from '../../infrastructure/db/client.js';
import { userSecrets } from '../../infrastructure/db/schema.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Valid provider types for secrets
 */
export type SecretProvider = 'openai' | 'anthropic' | 'composio' | 'github' | 'custom';

/**
 * User secret entity as returned from the database
 */
export interface UserSecret {
  id: string;
  userId: string;
  provider: string;
  name: string;
  encryptedValue: string;
  iv: string;
  authTag: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Data required to create a new user secret
 */
export interface CreateSecretData {
  userId: string;
  provider: SecretProvider;
  name: string;
  encryptedValue: string;
  iv: string;
  authTag: string;
}

/**
 * Data that can be updated on a user secret
 */
export interface UpdateSecretData {
  name?: string;
  encryptedValue?: string;
  iv?: string;
  authTag?: string;
}

// =============================================================================
// Repository
// =============================================================================

/**
 * Repository for user secret CRUD operations
 */
export class UserSecretRepository {
  /**
   * Find a secret by its ID
   */
  async findById(id: string): Promise<UserSecret | null> {
    const result = await db
      .select()
      .from(userSecrets)
      .where(eq(userSecrets.id, id))
      .limit(1);

    return result[0] || null;
  }

  /**
   * Find all secrets for a user
   */
  async findByUserId(userId: string): Promise<UserSecret[]> {
    return db
      .select()
      .from(userSecrets)
      .where(eq(userSecrets.userId, userId))
      .orderBy(userSecrets.createdAt);
  }

  /**
   * Find a secret by user and provider
   * Since there's one secret per provider per user, this is the primary lookup
   */
  async findByUserAndProvider(
    userId: string,
    provider: SecretProvider
  ): Promise<UserSecret | null> {
    const result = await db
      .select()
      .from(userSecrets)
      .where(
        and(
          eq(userSecrets.userId, userId),
          eq(userSecrets.provider, provider)
        )
      )
      .limit(1);

    return result[0] || null;
  }

  /**
   * Check if a secret exists for a user and provider
   */
  async existsByUserAndProvider(
    userId: string,
    provider: SecretProvider
  ): Promise<boolean> {
    const result = await this.findByUserAndProvider(userId, provider);
    return result !== null;
  }

  /**
   * Create a new user secret
   * @throws Error if a secret for this provider already exists for the user
   */
  async create(data: CreateSecretData): Promise<UserSecret> {
    const result = await db
      .insert(userSecrets)
      .values({
        userId: data.userId,
        provider: data.provider,
        name: data.name,
        encryptedValue: data.encryptedValue,
        iv: data.iv,
        authTag: data.authTag,
      })
      .returning();

    return result[0];
  }

  /**
   * Update a user secret
   */
  async update(id: string, data: UpdateSecretData): Promise<UserSecret | null> {
    const updateData: Record<string, unknown> = {
      updatedAt: new Date(),
    };

    if (data.name !== undefined) {
      updateData.name = data.name;
    }

    if (data.encryptedValue !== undefined) {
      updateData.encryptedValue = data.encryptedValue;
    }

    if (data.iv !== undefined) {
      updateData.iv = data.iv;
    }

    if (data.authTag !== undefined) {
      updateData.authTag = data.authTag;
    }

    const result = await db
      .update(userSecrets)
      .set(updateData)
      .where(eq(userSecrets.id, id))
      .returning();

    return result[0] || null;
  }

  /**
   * Delete a secret by ID
   * @returns true if a secret was deleted, false if not found
   */
  async delete(id: string): Promise<boolean> {
    const result = await db
      .delete(userSecrets)
      .where(eq(userSecrets.id, id))
      .returning({ id: userSecrets.id });

    return result.length > 0;
  }

  /**
   * Delete all secrets for a user
   * @returns The number of secrets deleted
   */
  async deleteAllForUser(userId: string): Promise<number> {
    const result = await db
      .delete(userSecrets)
      .where(eq(userSecrets.userId, userId))
      .returning({ id: userSecrets.id });

    return result.length;
  }
}
