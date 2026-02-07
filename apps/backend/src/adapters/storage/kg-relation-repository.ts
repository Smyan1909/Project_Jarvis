// =============================================================================
// Knowledge Graph Relation Repository - Storage Adapter
// =============================================================================
// Handles all database operations for the kg_relations table.
// Relations connect entities in the knowledge graph with typed edges.

import { eq, and, or, desc, sql } from 'drizzle-orm';
import { db } from '../../infrastructure/db/client.js';
import { kgRelations, kgEntities } from '../../infrastructure/db/schema.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Knowledge graph relation as returned from the database
 */
export interface KGRelationRow {
  id: string;
  userId: string;
  sourceId: string;
  targetId: string;
  type: string;
  properties: Record<string, unknown>;
  createdAt: Date;
}

/**
 * Relation with source and target entity details
 */
export interface KGRelationWithEntities extends KGRelationRow {
  source: {
    id: string;
    type: string;
    name: string;
  };
  target: {
    id: string;
    type: string;
    name: string;
  };
}

/**
 * Data required to create a new relation
 */
export interface CreateKGRelationData {
  userId: string;
  sourceId: string;
  targetId: string;
  type: string;
  properties?: Record<string, unknown>;
}

/**
 * Data for updating a relation
 */
export interface UpdateKGRelationData {
  type?: string;
  properties?: Record<string, unknown>;
}

// =============================================================================
// Repository
// =============================================================================

/**
 * Repository for knowledge graph relation CRUD operations
 *
 * This repository provides low-level storage operations for KG relations.
 * Relations are directed edges connecting source entities to target entities.
 *
 * Key features:
 * - User-scoped data access (all queries filter by userId)
 * - Graph traversal queries (outgoing, incoming, all relations for entity)
 * - Join queries to get relations with entity details
 * - Cascade delete when entities are removed (via FK constraints)
 */
export class KGRelationRepository {
  /**
   * Create a new relation between entities
   *
   * @param data - Relation data
   * @returns The created relation
   * @throws Error if source or target entity doesn't exist
   */
  async create(data: CreateKGRelationData): Promise<KGRelationRow> {
    const result = await db
      .insert(kgRelations)
      .values({
        userId: data.userId,
        sourceId: data.sourceId,
        targetId: data.targetId,
        type: data.type,
        properties: data.properties || {},
      })
      .returning();

    return this.mapToRelation(result[0]);
  }

  /**
   * Find a relation by ID
   *
   * @param userId - Owner user ID (for authorization)
   * @param id - Relation ID
   * @returns The relation or null if not found
   */
  async findById(userId: string, id: string): Promise<KGRelationRow | null> {
    const result = await db
      .select()
      .from(kgRelations)
      .where(and(eq(kgRelations.id, id), eq(kgRelations.userId, userId)))
      .limit(1);

    return result[0] ? this.mapToRelation(result[0]) : null;
  }

  /**
   * Find a relation by ID with source and target entity details
   *
   * @param userId - Owner user ID
   * @param id - Relation ID
   * @returns The relation with entities or null
   */
  async findByIdWithEntities(
    userId: string,
    id: string
  ): Promise<KGRelationWithEntities | null> {
    const result = await db.execute(sql`
      SELECT 
        r.id,
        r.user_id,
        r.source_id,
        r.target_id,
        r.type,
        r.properties,
        r.created_at,
        s.id as source_entity_id,
        s.type as source_entity_type,
        s.name as source_entity_name,
        t.id as target_entity_id,
        t.type as target_entity_type,
        t.name as target_entity_name
      FROM kg_relations r
      JOIN kg_entities s ON r.source_id = s.id
      JOIN kg_entities t ON r.target_id = t.id
      WHERE r.id = ${id}
        AND r.user_id = ${userId}
      LIMIT 1
    `);

    if ((result as any[]).length === 0) {
      return null;
    }

    const row = (result as any[])[0];
    return {
      id: row.id,
      userId: row.user_id,
      sourceId: row.source_id,
      targetId: row.target_id,
      type: row.type,
      properties: (row.properties as Record<string, unknown>) || {},
      createdAt: new Date(row.created_at),
      source: {
        id: row.source_entity_id,
        type: row.source_entity_type,
        name: row.source_entity_name,
      },
      target: {
        id: row.target_entity_id,
        type: row.target_entity_type,
        name: row.target_entity_name,
      },
    };
  }

  /**
   * Find outgoing relations from an entity (entity is the source)
   *
   * @param userId - Owner user ID
   * @param sourceId - Source entity ID
   * @returns Relations where the entity is the source
   */
  async findBySource(userId: string, sourceId: string): Promise<KGRelationRow[]> {
    const result = await db
      .select()
      .from(kgRelations)
      .where(and(eq(kgRelations.userId, userId), eq(kgRelations.sourceId, sourceId)))
      .orderBy(desc(kgRelations.createdAt));

    return result.map((row) => this.mapToRelation(row));
  }

  /**
   * Find incoming relations to an entity (entity is the target)
   *
   * @param userId - Owner user ID
   * @param targetId - Target entity ID
   * @returns Relations where the entity is the target
   */
  async findByTarget(userId: string, targetId: string): Promise<KGRelationRow[]> {
    const result = await db
      .select()
      .from(kgRelations)
      .where(and(eq(kgRelations.userId, userId), eq(kgRelations.targetId, targetId)))
      .orderBy(desc(kgRelations.createdAt));

    return result.map((row) => this.mapToRelation(row));
  }

  /**
   * Find all relations connected to an entity (either as source or target)
   *
   * @param userId - Owner user ID
   * @param entityId - Entity ID
   * @returns All relations involving the entity
   */
  async findByEntity(userId: string, entityId: string): Promise<KGRelationRow[]> {
    const result = await db
      .select()
      .from(kgRelations)
      .where(
        and(
          eq(kgRelations.userId, userId),
          or(eq(kgRelations.sourceId, entityId), eq(kgRelations.targetId, entityId))
        )
      )
      .orderBy(desc(kgRelations.createdAt));

    return result.map((row) => this.mapToRelation(row));
  }

  /**
   * Find all relations connected to an entity with entity details
   *
   * @param userId - Owner user ID
   * @param entityId - Entity ID
   * @returns Relations with source and target entity info
   */
  async findByEntityWithEntities(
    userId: string,
    entityId: string
  ): Promise<KGRelationWithEntities[]> {
    const result = await db.execute(sql`
      SELECT 
        r.id,
        r.user_id,
        r.source_id,
        r.target_id,
        r.type,
        r.properties,
        r.created_at,
        s.id as source_entity_id,
        s.type as source_entity_type,
        s.name as source_entity_name,
        t.id as target_entity_id,
        t.type as target_entity_type,
        t.name as target_entity_name
      FROM kg_relations r
      JOIN kg_entities s ON r.source_id = s.id
      JOIN kg_entities t ON r.target_id = t.id
      WHERE r.user_id = ${userId}
        AND (r.source_id = ${entityId} OR r.target_id = ${entityId})
      ORDER BY r.created_at DESC
    `);

    return (result as any[]).map((row) => ({
      id: row.id,
      userId: row.user_id,
      sourceId: row.source_id,
      targetId: row.target_id,
      type: row.type,
      properties: (row.properties as Record<string, unknown>) || {},
      createdAt: new Date(row.created_at),
      source: {
        id: row.source_entity_id,
        type: row.source_entity_type,
        name: row.source_entity_name,
      },
      target: {
        id: row.target_entity_id,
        type: row.target_entity_type,
        name: row.target_entity_name,
      },
    }));
  }

  /**
   * Find relations by type
   *
   * @param userId - Owner user ID
   * @param type - Relation type (e.g., 'knows', 'works_at')
   * @returns Relations of the specified type
   */
  async findByType(userId: string, type: string): Promise<KGRelationRow[]> {
    const result = await db
      .select()
      .from(kgRelations)
      .where(and(eq(kgRelations.userId, userId), eq(kgRelations.type, type)))
      .orderBy(desc(kgRelations.createdAt));

    return result.map((row) => this.mapToRelation(row));
  }

  /**
   * Find a specific relation between two entities
   *
   * @param userId - Owner user ID
   * @param sourceId - Source entity ID
   * @param targetId - Target entity ID
   * @param type - Optional relation type filter
   * @returns Matching relations
   */
  async findBetween(
    userId: string,
    sourceId: string,
    targetId: string,
    type?: string
  ): Promise<KGRelationRow[]> {
    const conditions = [
      eq(kgRelations.userId, userId),
      eq(kgRelations.sourceId, sourceId),
      eq(kgRelations.targetId, targetId),
    ];

    if (type) {
      conditions.push(eq(kgRelations.type, type));
    }

    const result = await db
      .select()
      .from(kgRelations)
      .where(and(...conditions))
      .orderBy(desc(kgRelations.createdAt));

    return result.map((row) => this.mapToRelation(row));
  }

  /**
   * Find all relations for a user
   *
   * @param userId - Owner user ID
   * @returns All relations for the user
   */
  async findByUser(userId: string): Promise<KGRelationRow[]> {
    const result = await db
      .select()
      .from(kgRelations)
      .where(eq(kgRelations.userId, userId))
      .orderBy(desc(kgRelations.createdAt));

    return result.map((row) => this.mapToRelation(row));
  }

  /**
   * Update a relation
   *
   * @param userId - Owner user ID (for authorization)
   * @param id - Relation ID
   * @param data - Fields to update
   * @returns Updated relation or null if not found
   */
  async update(
    userId: string,
    id: string,
    data: UpdateKGRelationData
  ): Promise<KGRelationRow | null> {
    const updateValues: Record<string, unknown> = {};

    if (data.type !== undefined) {
      updateValues.type = data.type;
    }
    if (data.properties !== undefined) {
      updateValues.properties = data.properties;
    }

    if (Object.keys(updateValues).length === 0) {
      return this.findById(userId, id);
    }

    const result = await db
      .update(kgRelations)
      .set(updateValues)
      .where(and(eq(kgRelations.id, id), eq(kgRelations.userId, userId)))
      .returning();

    return result[0] ? this.mapToRelation(result[0]) : null;
  }

  /**
   * Merge properties with existing properties
   *
   * @param userId - Owner user ID
   * @param id - Relation ID
   * @param properties - Properties to merge
   * @returns Updated relation or null
   */
  async mergeProperties(
    userId: string,
    id: string,
    properties: Record<string, unknown>
  ): Promise<KGRelationRow | null> {
    const existing = await this.findById(userId, id);
    if (!existing) {
      return null;
    }

    const mergedProperties = {
      ...existing.properties,
      ...properties,
    };

    return this.update(userId, id, { properties: mergedProperties });
  }

  /**
   * Delete a relation
   *
   * @param userId - Owner user ID (for authorization)
   * @param id - Relation ID
   * @returns true if deleted, false if not found
   */
  async delete(userId: string, id: string): Promise<boolean> {
    const result = await db
      .delete(kgRelations)
      .where(and(eq(kgRelations.id, id), eq(kgRelations.userId, userId)))
      .returning({ id: kgRelations.id });

    return result.length > 0;
  }

  /**
   * Delete all relations for an entity (both as source and target)
   *
   * Note: This is typically handled by FK cascade when deleting entities,
   * but this method allows explicit relation cleanup.
   *
   * @param userId - Owner user ID
   * @param entityId - Entity ID
   * @returns Number of deleted relations
   */
  async deleteByEntity(userId: string, entityId: string): Promise<number> {
    const result = await db
      .delete(kgRelations)
      .where(
        and(
          eq(kgRelations.userId, userId),
          or(eq(kgRelations.sourceId, entityId), eq(kgRelations.targetId, entityId))
        )
      )
      .returning({ id: kgRelations.id });

    return result.length;
  }

  /**
   * Delete all relations for a user
   *
   * @param userId - Owner user ID
   * @returns Number of deleted relations
   */
  async deleteByUser(userId: string): Promise<number> {
    const result = await db
      .delete(kgRelations)
      .where(eq(kgRelations.userId, userId))
      .returning({ id: kgRelations.id });

    return result.length;
  }

  /**
   * Count relations for a user
   *
   * @param userId - Owner user ID
   * @param type - Optional type filter
   * @returns Number of relations
   */
  async countByUser(userId: string, type?: string): Promise<number> {
    const conditions = [eq(kgRelations.userId, userId)];
    if (type) {
      conditions.push(eq(kgRelations.type, type));
    }

    const result = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(kgRelations)
      .where(and(...conditions));

    return result[0]?.count || 0;
  }

  /**
   * Count relations for an entity (both directions)
   *
   * @param userId - Owner user ID
   * @param entityId - Entity ID
   * @returns Number of relations involving the entity
   */
  async countByEntity(userId: string, entityId: string): Promise<number> {
    const result = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(kgRelations)
      .where(
        and(
          eq(kgRelations.userId, userId),
          or(eq(kgRelations.sourceId, entityId), eq(kgRelations.targetId, entityId))
        )
      );

    return result[0]?.count || 0;
  }

  /**
   * Get related entity IDs for graph traversal
   *
   * @param userId - Owner user ID
   * @param entityId - Starting entity ID
   * @param direction - 'outgoing' | 'incoming' | 'both'
   * @returns Array of related entity IDs
   */
  async getRelatedEntityIds(
    userId: string,
    entityId: string,
    direction: 'outgoing' | 'incoming' | 'both' = 'both'
  ): Promise<string[]> {
    let conditions;
    let selectField;

    if (direction === 'outgoing') {
      conditions = and(eq(kgRelations.userId, userId), eq(kgRelations.sourceId, entityId));
      selectField = kgRelations.targetId;
    } else if (direction === 'incoming') {
      conditions = and(eq(kgRelations.userId, userId), eq(kgRelations.targetId, entityId));
      selectField = kgRelations.sourceId;
    } else {
      // For 'both', we need a union query
      const result = await db.execute(sql`
        SELECT DISTINCT target_id as related_id
        FROM kg_relations
        WHERE user_id = ${userId} AND source_id = ${entityId}
        UNION
        SELECT DISTINCT source_id as related_id
        FROM kg_relations
        WHERE user_id = ${userId} AND target_id = ${entityId}
      `);
      return (result as any[]).map((row) => row.related_id);
    }

    const result = await db
      .selectDistinct({ relatedId: selectField })
      .from(kgRelations)
      .where(conditions);

    return result.map((row) => row.relatedId);
  }

  // =============================================================================
  // Private Helpers
  // =============================================================================

  /**
   * Map database row to Relation type
   */
  private mapToRelation(row: typeof kgRelations.$inferSelect): KGRelationRow {
    return {
      id: row.id,
      userId: row.userId,
      sourceId: row.sourceId,
      targetId: row.targetId,
      type: row.type,
      properties: (row.properties as Record<string, unknown>) || {},
      createdAt: row.createdAt,
    };
  }
}
