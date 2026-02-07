// =============================================================================
// Knowledge Graph Entity Repository - Storage Adapter
// =============================================================================
// Handles all database operations for the kg_entities table with pgvector support.
// This is a low-level storage adapter that works with pre-computed embeddings.
// For the full KnowledgeGraphPort implementation that generates embeddings,
// see the higher-level adapter that combines this repository with EmbeddingPort.

import { eq, and, desc, sql, inArray } from 'drizzle-orm';
import { db } from '../../infrastructure/db/client.js';
import { kgEntities } from '../../infrastructure/db/schema.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Knowledge graph entity as returned from the database
 */
export interface KGEntityRow {
  id: string;
  userId: string;
  type: string;
  name: string;
  properties: Record<string, unknown>;
  embedding: number[] | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Entity with similarity score from vector search
 */
export interface KGEntityWithSimilarity extends KGEntityRow {
  similarity: number;
}

/**
 * Data required to create a new entity
 */
export interface CreateKGEntityData {
  userId: string;
  type: string;
  name: string;
  properties?: Record<string, unknown>;
  embedding?: number[];
}

/**
 * Data for updating an entity
 */
export interface UpdateKGEntityData {
  type?: string;
  name?: string;
  properties?: Record<string, unknown>;
  embedding?: number[];
}

// =============================================================================
// Repository
// =============================================================================

/**
 * Repository for knowledge graph entity CRUD operations with pgvector similarity search
 *
 * This repository provides low-level storage operations for KG entities.
 * It accepts pre-computed embedding vectors and performs similarity
 * searches using PostgreSQL's pgvector extension.
 *
 * Key features:
 * - User-scoped data access (all queries filter by userId)
 * - Vector similarity search using cosine distance
 * - Type filtering for entity categorization
 * - HNSW index for fast approximate nearest neighbor search
 */
export class KGEntityRepository {
  /**
   * Create a new entity
   *
   * @param data - Entity data including optional embedding
   * @returns The created entity
   */
  async create(data: CreateKGEntityData): Promise<KGEntityRow> {
    const result = await db
      .insert(kgEntities)
      .values({
        userId: data.userId,
        type: data.type,
        name: data.name,
        properties: data.properties || {},
        embedding: data.embedding,
      })
      .returning();

    return this.mapToEntity(result[0]);
  }

  /**
   * Find an entity by ID
   *
   * @param userId - Owner user ID (for authorization)
   * @param id - Entity ID
   * @returns The entity or null if not found
   */
  async findById(userId: string, id: string): Promise<KGEntityRow | null> {
    const result = await db
      .select()
      .from(kgEntities)
      .where(and(eq(kgEntities.id, id), eq(kgEntities.userId, userId)))
      .limit(1);

    return result[0] ? this.mapToEntity(result[0]) : null;
  }

  /**
   * Find entities by type
   *
   * @param userId - Owner user ID
   * @param type - Entity type (e.g., 'person', 'place', 'organization')
   * @returns Entities of the specified type
   */
  async findByType(userId: string, type: string): Promise<KGEntityRow[]> {
    const result = await db
      .select()
      .from(kgEntities)
      .where(and(eq(kgEntities.userId, userId), eq(kgEntities.type, type)))
      .orderBy(desc(kgEntities.updatedAt));

    return result.map((row) => this.mapToEntity(row));
  }

  /**
   * Find entities by name (exact match)
   *
   * @param userId - Owner user ID
   * @param name - Entity name to find
   * @param type - Optional type filter
   * @returns Matching entities
   */
  async findByName(
    userId: string,
    name: string,
    type?: string
  ): Promise<KGEntityRow[]> {
    const conditions = [eq(kgEntities.userId, userId), eq(kgEntities.name, name)];

    if (type) {
      conditions.push(eq(kgEntities.type, type));
    }

    const result = await db
      .select()
      .from(kgEntities)
      .where(and(...conditions))
      .orderBy(desc(kgEntities.updatedAt));

    return result.map((row) => this.mapToEntity(row));
  }

  /**
   * Search entities by vector similarity using cosine distance
   *
   * Uses pgvector's <=> operator for cosine distance.
   * Similarity score = 1 - distance (ranges from 0 to 1, higher is more similar)
   *
   * @param userId - Owner user ID
   * @param embedding - Query embedding vector (1536 dimensions for OpenAI)
   * @param type - Optional entity type filter
   * @param limit - Maximum number of results (default: 10)
   * @returns Entities sorted by similarity (highest first)
   */
  async searchSimilar(
    userId: string,
    embedding: number[],
    type?: string,
    limit: number = 10
  ): Promise<KGEntityWithSimilarity[]> {
    const vectorStr = `[${embedding.join(',')}]`;

    // Build query with optional type filter
    const typeFilter = type
      ? sql`AND type = ${type}`
      : sql``;

    const result = await db.execute(sql`
      SELECT 
        id,
        user_id,
        type,
        name,
        properties,
        embedding,
        created_at,
        updated_at,
        1 - (embedding <=> ${vectorStr}::vector) as similarity
      FROM kg_entities
      WHERE user_id = ${userId}
        AND embedding IS NOT NULL
        ${typeFilter}
      ORDER BY embedding <=> ${vectorStr}::vector
      LIMIT ${limit}
    `);

    return (result as any[]).map((row) => ({
      id: row.id,
      userId: row.user_id,
      type: row.type,
      name: row.name,
      properties: (row.properties as Record<string, unknown>) || {},
      embedding: row.embedding ? this.parseVector(row.embedding) : null,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      similarity: Number(row.similarity),
    }));
  }

  /**
   * Search entities with minimum similarity threshold
   *
   * @param userId - Owner user ID
   * @param embedding - Query embedding vector
   * @param minSimilarity - Minimum similarity score (0-1)
   * @param type - Optional entity type filter
   * @param limit - Maximum number of results
   * @returns Entities above the similarity threshold
   */
  async searchSimilarWithThreshold(
    userId: string,
    embedding: number[],
    minSimilarity: number,
    type?: string,
    limit: number = 10
  ): Promise<KGEntityWithSimilarity[]> {
    const vectorStr = `[${embedding.join(',')}]`;
    const maxDistance = 1 - minSimilarity;

    const typeFilter = type
      ? sql`AND type = ${type}`
      : sql``;

    const result = await db.execute(sql`
      SELECT 
        id,
        user_id,
        type,
        name,
        properties,
        embedding,
        created_at,
        updated_at,
        1 - (embedding <=> ${vectorStr}::vector) as similarity
      FROM kg_entities
      WHERE user_id = ${userId}
        AND embedding IS NOT NULL
        AND (embedding <=> ${vectorStr}::vector) <= ${maxDistance}
        ${typeFilter}
      ORDER BY embedding <=> ${vectorStr}::vector
      LIMIT ${limit}
    `);

    return (result as any[]).map((row) => ({
      id: row.id,
      userId: row.user_id,
      type: row.type,
      name: row.name,
      properties: (row.properties as Record<string, unknown>) || {},
      embedding: row.embedding ? this.parseVector(row.embedding) : null,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      similarity: Number(row.similarity),
    }));
  }

  /**
   * Find all entities for a user
   *
   * @param userId - Owner user ID
   * @returns All entities for the user
   */
  async findByUser(userId: string): Promise<KGEntityRow[]> {
    const result = await db
      .select()
      .from(kgEntities)
      .where(eq(kgEntities.userId, userId))
      .orderBy(desc(kgEntities.updatedAt));

    return result.map((row) => this.mapToEntity(row));
  }

  /**
   * Update an entity
   *
   * @param userId - Owner user ID (for authorization)
   * @param id - Entity ID
   * @param data - Fields to update
   * @returns Updated entity or null if not found
   */
  async update(
    userId: string,
    id: string,
    data: UpdateKGEntityData
  ): Promise<KGEntityRow | null> {
    const updateValues: Record<string, unknown> = {
      updatedAt: new Date(),
    };

    if (data.type !== undefined) {
      updateValues.type = data.type;
    }
    if (data.name !== undefined) {
      updateValues.name = data.name;
    }
    if (data.properties !== undefined) {
      updateValues.properties = data.properties;
    }
    if (data.embedding !== undefined) {
      updateValues.embedding = data.embedding;
    }

    const result = await db
      .update(kgEntities)
      .set(updateValues)
      .where(and(eq(kgEntities.id, id), eq(kgEntities.userId, userId)))
      .returning();

    return result[0] ? this.mapToEntity(result[0]) : null;
  }

  /**
   * Merge properties with existing properties (partial update)
   *
   * @param userId - Owner user ID
   * @param id - Entity ID
   * @param properties - Properties to merge
   * @returns Updated entity or null if not found
   */
  async mergeProperties(
    userId: string,
    id: string,
    properties: Record<string, unknown>
  ): Promise<KGEntityRow | null> {
    // First get existing entity
    const existing = await this.findById(userId, id);
    if (!existing) {
      return null;
    }

    // Merge properties
    const mergedProperties = {
      ...existing.properties,
      ...properties,
    };

    return this.update(userId, id, { properties: mergedProperties });
  }

  /**
   * Delete an entity
   *
   * Note: This will cascade delete all relations where this entity
   * is the source or target (due to foreign key constraints).
   *
   * @param userId - Owner user ID (for authorization)
   * @param id - Entity ID
   * @returns true if deleted, false if not found
   */
  async delete(userId: string, id: string): Promise<boolean> {
    const result = await db
      .delete(kgEntities)
      .where(and(eq(kgEntities.id, id), eq(kgEntities.userId, userId)))
      .returning({ id: kgEntities.id });

    return result.length > 0;
  }

  /**
   * Delete all entities for a user
   *
   * @param userId - Owner user ID
   * @returns Number of deleted entities
   */
  async deleteByUser(userId: string): Promise<number> {
    const result = await db
      .delete(kgEntities)
      .where(eq(kgEntities.userId, userId))
      .returning({ id: kgEntities.id });

    return result.length;
  }

  /**
   * Count entities for a user
   *
   * @param userId - Owner user ID
   * @param type - Optional type filter
   * @returns Number of entities
   */
  async countByUser(userId: string, type?: string): Promise<number> {
    const conditions = [eq(kgEntities.userId, userId)];
    if (type) {
      conditions.push(eq(kgEntities.type, type));
    }

    const result = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(kgEntities)
      .where(and(...conditions));

    return result[0]?.count || 0;
  }

  /**
   * Find multiple entities by IDs
   *
   * @param userId - Owner user ID
   * @param ids - Array of entity IDs
   * @returns Found entities (may be fewer than requested if some don't exist)
   */
  async findByIds(userId: string, ids: string[]): Promise<KGEntityRow[]> {
    if (ids.length === 0) {
      return [];
    }

    const result = await db
      .select()
      .from(kgEntities)
      .where(
        and(
          eq(kgEntities.userId, userId),
          inArray(kgEntities.id, ids)
        )
      );

    return result.map((row) => this.mapToEntity(row));
  }

  // =============================================================================
  // Private Helpers
  // =============================================================================

  /**
   * Map database row to Entity type
   */
  private mapToEntity(row: typeof kgEntities.$inferSelect): KGEntityRow {
    return {
      id: row.id,
      userId: row.userId,
      type: row.type,
      name: row.name,
      properties: (row.properties as Record<string, unknown>) || {},
      embedding: row.embedding || null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  /**
   * Parse pgvector string format to number array
   */
  private parseVector(vectorStr: string | number[]): number[] {
    if (Array.isArray(vectorStr)) {
      return vectorStr;
    }
    const cleaned = vectorStr.replace(/^\[|\]$/g, '');
    return cleaned.split(',').map(Number);
  }
}
