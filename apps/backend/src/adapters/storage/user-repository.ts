// =============================================================================
// User Repository - Storage Adapter
// =============================================================================
// Handles all database operations for the users table.

import { eq } from 'drizzle-orm';
import { db } from '../../infrastructure/db/client.js';
import { users } from '../../infrastructure/db/schema.js';

// =============================================================================
// Types
// =============================================================================

/**
 * User entity as returned from the database
 */
export interface User {
  id: string;
  email: string;
  passwordHash: string;
  displayName: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Data required to create a new user
 */
export interface CreateUserData {
  email: string;
  passwordHash: string;
  displayName?: string;
}

/**
 * Data that can be updated on a user
 */
export interface UpdateUserData {
  email?: string;
  displayName?: string | null;
  passwordHash?: string;
}

// =============================================================================
// Repository
// =============================================================================

/**
 * Repository for user CRUD operations
 */
export class UserRepository {
  /**
   * Find a user by their ID
   */
  async findById(id: string): Promise<User | null> {
    const result = await db
      .select()
      .from(users)
      .where(eq(users.id, id))
      .limit(1);

    return result[0] || null;
  }

  /**
   * Find a user by their email address
   * Email comparison is case-insensitive
   */
  async findByEmail(email: string): Promise<User | null> {
    const normalizedEmail = email.toLowerCase().trim();
    const result = await db
      .select()
      .from(users)
      .where(eq(users.email, normalizedEmail))
      .limit(1);

    return result[0] || null;
  }

  /**
   * Create a new user
   * Email is normalized to lowercase before storage
   */
  async create(data: CreateUserData): Promise<User> {
    const result = await db
      .insert(users)
      .values({
        email: data.email.toLowerCase().trim(),
        passwordHash: data.passwordHash,
        displayName: data.displayName,
      })
      .returning();

    return result[0];
  }

  /**
   * Update an existing user
   * Returns null if user not found
   */
  async update(id: string, data: UpdateUserData): Promise<User | null> {
    const updateData: Record<string, unknown> = {
      ...data,
      updatedAt: new Date(),
    };

    // Normalize email if provided
    if (data.email) {
      updateData.email = data.email.toLowerCase().trim();
    }

    const result = await db
      .update(users)
      .set(updateData)
      .where(eq(users.id, id))
      .returning();

    return result[0] || null;
  }

  /**
   * Delete a user by ID
   * Returns true if user was deleted, false if not found
   */
  async delete(id: string): Promise<boolean> {
    const result = await db
      .delete(users)
      .where(eq(users.id, id))
      .returning({ id: users.id });

    return result.length > 0;
  }

  /**
   * Check if an email is already registered
   */
  async emailExists(email: string): Promise<boolean> {
    const user = await this.findByEmail(email);
    return user !== null;
  }
}
