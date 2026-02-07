// =============================================================================
// PostgreSQL Memory Store Adapter
// =============================================================================
// Implements MemoryStorePort using PostgreSQL with pgvector for semantic search.
// Combines MemoryRepository for storage with EmbeddingPort for vector generation.

import type { MemoryItem, MemorySearchResult } from '@project-jarvis/shared-types';
import type { MemoryStorePort } from '../../ports/MemoryStorePort.js';
import type { EmbeddingPort } from '../../ports/EmbeddingPort.js';
import { MemoryRepository } from '../storage/memory-repository.js';
import { logger } from '../../infrastructure/logging/logger.js';

/**
 * PostgreSQL implementation of MemoryStorePort
 *
 * Features:
 * - User-scoped storage with automatic embedding generation
 * - Semantic similarity search using pgvector
 * - HNSW indexing for fast approximate nearest neighbor search
 *
 * This adapter combines:
 * - MemoryRepository: Low-level storage operations
 * - EmbeddingPort: Vector embedding generation
 */
export class PgMemoryStore implements MemoryStorePort {
  constructor(
    private repository: MemoryRepository,
    private embedding: EmbeddingPort
  ) {}

  /**
   * Store a new memory with automatic embedding
   *
   * The content will be automatically embedded for semantic search.
   * Metadata can include category, source, or any custom fields.
   */
  async store(
    userId: string,
    content: string,
    metadata?: Record<string, unknown>
  ): Promise<MemoryItem> {
    const log = logger.child({ userId, operation: 'memory.store' });

    // Generate embedding for the content
    const embeddingVector = await this.embedding.embed(content);

    // Store in database
    const memory = await this.repository.create({
      userId,
      content,
      embedding: embeddingVector,
      metadata: metadata || {},
    });

    log.info('Memory stored', { memoryId: memory.id, contentLength: content.length });

    return {
      id: memory.id,
      userId: memory.userId,
      content: memory.content,
      embedding: memory.embedding || embeddingVector,
      metadata: memory.metadata,
      createdAt: memory.createdAt,
    };
  }

  /**
   * Search memories by semantic similarity
   *
   * Uses vector similarity to find memories related to the query.
   * Results are ranked by similarity score.
   */
  async search(
    userId: string,
    query: string,
    limit: number = 10
  ): Promise<MemorySearchResult[]> {
    const log = logger.child({ userId, operation: 'memory.search' });

    // Generate embedding for the query
    const queryEmbedding = await this.embedding.embed(query);

    // Search using pgvector similarity
    const results = await this.repository.searchSimilar(userId, queryEmbedding, limit);

    log.debug('Memory search completed', {
      query: query.slice(0, 50),
      resultsReturned: results.length,
    });

    return results.map((result) => ({
      id: result.id,
      content: result.content,
      metadata: result.metadata,
      similarity: result.similarity,
      createdAt: result.createdAt,
    }));
  }

  /**
   * Get recent memories
   *
   * Retrieves the most recently created memories for a user.
   * Useful for showing recent context or activity.
   */
  async getRecent(userId: string, limit: number = 10): Promise<MemoryItem[]> {
    const memories = await this.repository.findRecent(userId, limit);

    return memories.map((memory) => ({
      id: memory.id,
      userId: memory.userId,
      content: memory.content,
      embedding: memory.embedding || [],
      metadata: memory.metadata,
      createdAt: memory.createdAt,
    }));
  }

  /**
   * Delete a memory
   *
   * Permanently removes a memory and its embedding.
   */
  async delete(userId: string, memoryId: string): Promise<void> {
    const log = logger.child({ userId, memoryId, operation: 'memory.delete' });

    const deleted = await this.repository.delete(userId, memoryId);

    if (!deleted) {
      log.warn('Memory not found for deletion');
      throw new Error(`Memory ${memoryId} not found for user ${userId}`);
    }

    log.info('Memory deleted');
  }

  // =========================================================================
  // Extended methods (not in port interface)
  // =========================================================================

  /**
   * Search memories with a minimum similarity threshold
   *
   * @param userId - Owner user ID
   * @param query - Natural language search query
   * @param minSimilarity - Minimum similarity score (0-1)
   * @param limit - Maximum number of results
   * @returns Memories above the similarity threshold
   */
  async searchWithThreshold(
    userId: string,
    query: string,
    minSimilarity: number,
    limit: number = 10
  ): Promise<MemorySearchResult[]> {
    const queryEmbedding = await this.embedding.embed(query);
    const results = await this.repository.searchSimilarWithThreshold(
      userId,
      queryEmbedding,
      minSimilarity,
      limit
    );

    return results.map((result) => ({
      id: result.id,
      content: result.content,
      metadata: result.metadata,
      similarity: result.similarity,
      createdAt: result.createdAt,
    }));
  }

  /**
   * Get all memories for a user
   */
  async getAll(userId: string): Promise<MemoryItem[]> {
    const memories = await this.repository.findByUser(userId);

    return memories.map((memory) => ({
      id: memory.id,
      userId: memory.userId,
      content: memory.content,
      embedding: memory.embedding || [],
      metadata: memory.metadata,
      createdAt: memory.createdAt,
    }));
  }

  /**
   * Get a single memory by ID
   */
  async getById(userId: string, memoryId: string): Promise<MemoryItem | null> {
    const memory = await this.repository.findById(userId, memoryId);

    if (!memory) {
      return null;
    }

    return {
      id: memory.id,
      userId: memory.userId,
      content: memory.content,
      embedding: memory.embedding || [],
      metadata: memory.metadata,
      createdAt: memory.createdAt,
    };
  }

  /**
   * Update a memory's content (re-embeds automatically)
   */
  async update(
    userId: string,
    memoryId: string,
    content: string,
    metadata?: Record<string, unknown>
  ): Promise<MemoryItem> {
    const log = logger.child({ userId, memoryId, operation: 'memory.update' });

    // Generate new embedding for updated content
    const embeddingVector = await this.embedding.embed(content);

    const updated = await this.repository.update(userId, memoryId, {
      content,
      embedding: embeddingVector,
      metadata,
    });

    if (!updated) {
      throw new Error(`Memory ${memoryId} not found for user ${userId}`);
    }

    log.info('Memory updated', { memoryId });

    return {
      id: updated.id,
      userId: updated.userId,
      content: updated.content,
      embedding: updated.embedding || embeddingVector,
      metadata: updated.metadata,
      createdAt: updated.createdAt,
    };
  }

  /**
   * Count memories for a user
   */
  async count(userId: string): Promise<number> {
    return this.repository.countByUser(userId);
  }

  /**
   * Delete all memories for a user
   */
  async deleteAll(userId: string): Promise<number> {
    return this.repository.deleteByUser(userId);
  }
}
