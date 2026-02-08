// =============================================================================
// Tool Permission Repository - Storage Adapter
// =============================================================================
// Handles all database operations for the user_tool_permissions table.
// Manages per-user, per-tool access control.

import { eq, and } from 'drizzle-orm';
import { db } from '../../infrastructure/db/client.js';
import { userToolPermissions } from '../../infrastructure/db/schema.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Tool permission entity as returned from the database
 */
export interface ToolPermission {
  id: string;
  userId: string;
  toolId: string;
  granted: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Data required to create or update a tool permission
 */
export interface UpsertPermissionData {
  userId: string;
  toolId: string;
  granted: boolean;
}

// =============================================================================
// Repository
// =============================================================================

/**
 * Repository for tool permission CRUD operations
 *
 * Permission model:
 * - By default, all tools are allowed (no entry = allowed)
 * - Explicit grant: entry exists with granted=true
 * - Explicit deny: entry exists with granted=false
 *
 * This allows for a deny-list model where most tools are available,
 * but specific tools can be restricted for certain users.
 */
export class ToolPermissionRepository {
  /**
   * Check if a user has permission to use a specific tool
   *
   * @returns true if allowed, false if explicitly denied
   *          If no permission record exists, defaults to true (allowed)
   */
  async hasPermission(userId: string, toolId: string): Promise<boolean> {
    const result = await db
      .select({ granted: userToolPermissions.granted })
      .from(userToolPermissions)
      .where(
        and(
          eq(userToolPermissions.userId, userId),
          eq(userToolPermissions.toolId, toolId)
        )
      )
      .limit(1);

    // If no explicit permission exists, default to allowed
    if (result.length === 0) {
      return true;
    }

    return result[0].granted;
  }

  /**
   * Check permissions for multiple tools at once
   * Returns a map of toolId -> granted status
   */
  async hasPermissions(
    userId: string,
    toolIds: string[]
  ): Promise<Map<string, boolean>> {
    if (toolIds.length === 0) {
      return new Map();
    }

    const results = await db
      .select({
        toolId: userToolPermissions.toolId,
        granted: userToolPermissions.granted,
      })
      .from(userToolPermissions)
      .where(eq(userToolPermissions.userId, userId));

    // Build result map, defaulting to true for tools without explicit entries
    const permissionMap = new Map<string, boolean>();
    for (const toolId of toolIds) {
      permissionMap.set(toolId, true); // Default to allowed
    }

    for (const row of results) {
      if (toolIds.includes(row.toolId)) {
        permissionMap.set(row.toolId, row.granted);
      }
    }

    return permissionMap;
  }

  /**
   * Get all permission entries for a user
   */
  async findByUser(userId: string): Promise<ToolPermission[]> {
    return db
      .select()
      .from(userToolPermissions)
      .where(eq(userToolPermissions.userId, userId))
      .orderBy(userToolPermissions.toolId);
  }

  /**
   * Get all users with permissions for a specific tool
   */
  async findByTool(toolId: string): Promise<ToolPermission[]> {
    return db
      .select()
      .from(userToolPermissions)
      .where(eq(userToolPermissions.toolId, toolId))
      .orderBy(userToolPermissions.userId);
  }

  /**
   * Find a specific permission entry
   */
  async findByUserAndTool(
    userId: string,
    toolId: string
  ): Promise<ToolPermission | null> {
    const result = await db
      .select()
      .from(userToolPermissions)
      .where(
        and(
          eq(userToolPermissions.userId, userId),
          eq(userToolPermissions.toolId, toolId)
        )
      )
      .limit(1);

    return result[0] || null;
  }

  /**
   * Grant permission for a user to use a tool
   * Creates a new entry or updates existing one
   */
  async grantPermission(userId: string, toolId: string): Promise<ToolPermission> {
    return this.upsert({ userId, toolId, granted: true });
  }

  /**
   * Revoke permission for a user to use a tool
   * Creates a new entry or updates existing one to denied
   */
  async revokePermission(userId: string, toolId: string): Promise<ToolPermission> {
    return this.upsert({ userId, toolId, granted: false });
  }

  /**
   * Upsert a permission entry
   * Creates if not exists, updates if exists
   */
  async upsert(data: UpsertPermissionData): Promise<ToolPermission> {
    const existing = await this.findByUserAndTool(data.userId, data.toolId);

    if (existing) {
      // Update existing
      const result = await db
        .update(userToolPermissions)
        .set({
          granted: data.granted,
          updatedAt: new Date(),
        })
        .where(eq(userToolPermissions.id, existing.id))
        .returning();

      return result[0];
    }

    // Create new
    const result = await db
      .insert(userToolPermissions)
      .values({
        userId: data.userId,
        toolId: data.toolId,
        granted: data.granted,
      })
      .returning();

    return result[0];
  }

  /**
   * Delete a permission entry (resets to default allowed)
   */
  async deletePermission(userId: string, toolId: string): Promise<boolean> {
    const result = await db
      .delete(userToolPermissions)
      .where(
        and(
          eq(userToolPermissions.userId, userId),
          eq(userToolPermissions.toolId, toolId)
        )
      )
      .returning({ id: userToolPermissions.id });

    return result.length > 0;
  }

  /**
   * Delete all permissions for a user
   */
  async deleteAllForUser(userId: string): Promise<number> {
    const result = await db
      .delete(userToolPermissions)
      .where(eq(userToolPermissions.userId, userId))
      .returning({ id: userToolPermissions.id });

    return result.length;
  }

  /**
   * Bulk grant permissions for a user
   */
  async bulkGrant(userId: string, toolIds: string[]): Promise<void> {
    for (const toolId of toolIds) {
      await this.grantPermission(userId, toolId);
    }
  }

  /**
   * Bulk revoke permissions for a user
   */
  async bulkRevoke(userId: string, toolIds: string[]): Promise<void> {
    for (const toolId of toolIds) {
      await this.revokePermission(userId, toolId);
    }
  }

  /**
   * Get list of denied tools for a user
   */
  async getDeniedTools(userId: string): Promise<string[]> {
    const results = await db
      .select({ toolId: userToolPermissions.toolId })
      .from(userToolPermissions)
      .where(
        and(
          eq(userToolPermissions.userId, userId),
          eq(userToolPermissions.granted, false)
        )
      );

    return results.map((r) => r.toolId);
  }

  /**
   * Get list of explicitly granted tools for a user
   * (Useful for premium/special tools that require opt-in)
   */
  async getGrantedTools(userId: string): Promise<string[]> {
    const results = await db
      .select({ toolId: userToolPermissions.toolId })
      .from(userToolPermissions)
      .where(
        and(
          eq(userToolPermissions.userId, userId),
          eq(userToolPermissions.granted, true)
        )
      );

    return results.map((r) => r.toolId);
  }
}
