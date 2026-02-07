// =============================================================================
// Memory Repository - Storage Adapter
// =============================================================================
// Handles all database operations for the memories table with pgvector support.
// This is a low-level storage adapter that works with pre-computed embeddings.
// For the full MemoryStorePort implementation that generates embeddings,
// see the higher-level adapter that combines this repository with EmbeddingPort.

import { eq, and, desc, sql } from 'drizzle-orm';
import { db } from '../../infrastructure/db/client.js';
import { memories } from '../../infrastructure/db/schema.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Memory entity as returned from the database
 */
export interface Memory {
  id: string;
  userId: string;
  content: string;
  embedding: number[] | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

/**
 * Memory with similarity score from vector search
 */
export interface MemoryWithSimilarity extends Memory {
  similarity: number;
}

/**
 * Data required to create a new memory
 */
export interface CreateMemoryData {
  userId: string;
  content: string;
  embedding?: number[];
  metadata?: Record<string, unknown>;
}

/**
 * Data for updating a memory
 */
export interface UpdateMemoryData {
  content?: string;
  embedding?: number[];
  metadata?: Record<string, unknown>;
}

// =============================================================================
// Repository
// =============================================================================

/**
 * Repository for memory CRUD operations with pgvector similarity search
 *
 * This repository provides low-level storage operations for memories.
 * It accepts pre-computed embedding vectors and performs similarity
 * searches using PostgreSQL's pgvector extension.
 *
 * Key features:
 * - User-scoped data access (all queries filter by userId)
 * - Vector similarity search using cosine distance
 * - HNSW index for fast approximate nearest neighbor search
 */
export class MemoryRepository {
  /**
   * Create a new memory
   *
   * @param data - Memory data including optional embedding
   * @returns The created memory
   */
  async create(data: CreateMemoryData): Promise<Memory> {
    const result = await db
      .insert(memories)
      .values({
        userId: data.userId,
        content: data.content,
        embedding: data.embedding,
        metadata: data.metadata || {},
      })
      .returning();

    return this.mapToMemory(result[0]);
  }

  /**
   * Find a memory by ID
   *
   * @param userId - Owner user ID (for authorization)
   * @param id - Memory ID
   * @returns The memory or null if not found
   */
  async findById(userId: string, id: string): Promise<Memory | null> {
    const result = await db
      .select()
      .from(memories)
      .where(and(eq(memories.id, id), eq(memories.userId, userId)))
      .limit(1);

    return result[0] ? this.mapToMemory(result[0]) : null;
  }

  /**
   * Search memories by vector similarity using cosine distance
   *
   * Uses pgvector's <=> operator for cosine distance.
   * Similarity score = 1 - distance (ranges from 0 to 1, higher is more similar)
   *
   * @param userId - Owner user ID
   * @param embedding - Query embedding vector (1536 dimensions for OpenAI)
   * @param limit - Maximum number of results (default: 10)
   * @returns Memories sorted by similarity (highest first)
   */
  async searchSimilar(
    userId: string,
    embedding: number[],
    limit: number = 10
  ): Promise<MemoryWithSimilarity[]> {
    // Convert embedding array to pgvector format
    const vectorStr = `[${embedding.join(',')}]`;

    // Raw SQL query for pgvector similarity search
    // The <=> operator computes cosine distance (0 = identical, 2 = opposite)
    // We convert to similarity: 1 - distance
    const result = await db.execute(sql`
      SELECT 
        id,
        user_id,
        content,
        embedding,
        metadata,
        created_at,
        1 - (embedding <=> ${vectorStr}::vector) as similarity
      FROM memories
      WHERE user_id = ${userId}
        AND embedding IS NOT NULL
      ORDER BY embedding <=> ${vectorStr}::vector
      LIMIT ${limit}
    `);

    return (result as any[]).map((row) => ({
      id: row.id,
      userId: row.user_id,
      content: row.content,
      embedding: row.embedding ? this.parseVector(row.embedding) : null,
      metadata: (row.metadata as Record<string, unknown>) || {},
      createdAt: new Date(row.created_at),
      similarity: Number(row.similarity),
    }));
  }

  /**
   * Search memories with minimum similarity threshold
   *
   * @param userId - Owner user ID
   * @param embedding - Query embedding vector
   * @param minSimilarity - Minimum similarity score (0-1)
   * @param limit - Maximum number of results
   * @returns Memories above the similarity threshold
   */
  async searchSimilarWithThreshold(
    userId: string,
    embedding: number[],
    minSimilarity: number,
    limit: number = 10
  ): Promise<MemoryWithSimilarity[]> {
    const vectorStr = `[${embedding.join(',')}]`;
    // Convert similarity threshold to distance threshold
    // similarity = 1 - distance, so distance = 1 - similarity
    const maxDistance = 1 - minSimilarity;

    const result = await db.execute(sql`
      SELECT 
        id,
        user_id,
        content,
        embedding,
        metadata,
        created_at,
        1 - (embedding <=> ${vectorStr}::vector) as similarity
      FROM memories
      WHERE user_id = ${userId}
        AND embedding IS NOT NULL
        AND (embedding <=> ${vectorStr}::vector) <= ${maxDistance}
      ORDER BY embedding <=> ${vectorStr}::vector
      LIMIT ${limit}
    `);

    return (result as any[]).map((row) => ({
      id: row.id,
      userId: row.user_id,
      content: row.content,
      embedding: row.embedding ? this.parseVector(row.embedding) : null,
      metadata: (row.metadata as Record<string, unknown>) || {},
      createdAt: new Date(row.created_at),
      similarity: Number(row.similarity),
    }));
  }

  /**
   * Find recent memories for a user
   *
   * @param userId - Owner user ID
   * @param limit - Maximum number of results (default: 10)
   * @returns Memories sorted by creation date (newest first)
   */
  async findRecent(userId: string, limit: number = 10): Promise<Memory[]> {
    const result = await db
      .select()
      .from(memories)
      .where(eq(memories.userId, userId))
      .orderBy(desc(memories.createdAt))
      .limit(limit);

    return result.map((row) => this.mapToMemory(row));
  }

  /**
   * Find all memories for a user
   *
   * @param userId - Owner user ID
   * @returns All memories for the user
   */
  async findByUser(userId: string): Promise<Memory[]> {
    const result = await db
      .select()
      .from(memories)
      .where(eq(memories.userId, userId))
      .orderBy(desc(memories.createdAt));

    return result.map((row) => this.mapToMemory(row));
  }

  /**
   * Update a memory
   *
   * @param userId - Owner user ID (for authorization)
   * @param id - Memory ID
   * @param data - Fields to update
   * @returns Updated memory or null if not found
   */
  async update(
    userId: string,
    id: string,
    data: UpdateMemoryData
  ): Promise<Memory | null> {
    const updateValues: Record<string, unknown> = {};

    if (data.content !== undefined) {
      updateValues.content = data.content;
    }
    if (data.embedding !== undefined) {
      updateValues.embedding = data.embedding;
    }
    if (data.metadata !== undefined) {
      updateValues.metadata = data.metadata;
    }

    if (Object.keys(updateValues).length === 0) {
      // Nothing to update, return current state
      return this.findById(userId, id);
    }

    const result = await db
      .update(memories)
      .set(updateValues)
      .where(and(eq(memories.id, id), eq(memories.userId, userId)))
      .returning();

    return result[0] ? this.mapToMemory(result[0]) : null;
  }

  /**
   * Delete a memory
   *
   * @param userId - Owner user ID (for authorization)
   * @param id - Memory ID
   * @returns true if deleted, false if not found
   */
  async delete(userId: string, id: string): Promise<boolean> {
    const result = await db
      .delete(memories)
      .where(and(eq(memories.id, id), eq(memories.userId, userId)))
      .returning({ id: memories.id });

    return result.length > 0;
  }

  /**
   * Delete all memories for a user
   *
   * @param userId - Owner user ID
   * @returns Number of deleted memories
   */
  async deleteByUser(userId: string): Promise<number> {
    const result = await db
      .delete(memories)
      .where(eq(memories.userId, userId))
      .returning({ id: memories.id });

    return result.length;
  }

  /**
   * Count memories for a user
   *
   * @param userId - Owner user ID
   * @returns Number of memories
   */
  async countByUser(userId: string): Promise<number> {
    const result = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(memories)
      .where(eq(memories.userId, userId));

    return result[0]?.count || 0;
  }

  // =============================================================================
  // Private Helpers
  // =============================================================================

  /**
   * Map database row to Memory type
   */
  private mapToMemory(row: typeof memories.$inferSelect): Memory {
    return {
      id: row.id,
      userId: row.userId,
      content: row.content,
      embedding: row.embedding || null,
      metadata: (row.metadata as Record<string, unknown>) || {},
      createdAt: row.createdAt,
    };
  }

  /**
   * Parse pgvector string format to number array
   * pgvector returns vectors as strings like "[0.1,0.2,0.3]"
   */
  private parseVector(vectorStr: string | number[]): number[] {
    if (Array.isArray(vectorStr)) {
      return vectorStr;
    }
    // Handle string format from raw SQL queries
    const cleaned = vectorStr.replace(/^\[|\]$/g, '');
    return cleaned.split(',').map(Number);
  }
}
