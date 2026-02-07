// =============================================================================
// In-Memory Memory Store Adapter
// =============================================================================
// Implements MemoryStorePort using in-memory storage with embeddings
// Designed for easy swap to Postgres/pgvector later

import { v4 as uuidv4 } from 'uuid';
import type { MemoryItem, MemorySearchResult } from '@project-jarvis/shared-types';
import type { MemoryStorePort } from '../../ports/MemoryStorePort.js';
import type { EmbeddingPort } from '../../ports/EmbeddingPort.js';
import { logger } from '../../infrastructure/logging/logger.js';

/**
 * Compute cosine similarity between two vectors
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error('Vectors must have the same length');
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  if (magnitude === 0) return 0;

  return dotProduct / magnitude;
}

/**
 * In-memory implementation of MemoryStorePort
 *
 * Features:
 * - User-scoped storage (each user has separate memories)
 * - Semantic similarity search using embeddings
 * - Cosine similarity for ranking
 *
 * Note: This is a development/testing implementation.
 * Production should use PostgreSQL with pgvector extension.
 */
export class InMemoryMemoryStore implements MemoryStorePort {
  // Map<userId, Map<memoryId, MemoryItem>>
  private memories: Map<string, Map<string, MemoryItem>> = new Map();

  constructor(private embedding: EmbeddingPort) {}

  /**
   * Store a new memory with automatic embedding
   */
  async store(
    userId: string,
    content: string,
    metadata?: Record<string, unknown>
  ): Promise<MemoryItem> {
    const log = logger.child({ userId, operation: 'memory.store' });

    // Generate embedding for the content
    const embeddingVector = await this.embedding.embed(content);

    const memory: MemoryItem = {
      id: uuidv4(),
      userId,
      content,
      embedding: embeddingVector,
      metadata: metadata || {},
      createdAt: new Date(),
    };

    // Get or create user's memory map
    if (!this.memories.has(userId)) {
      this.memories.set(userId, new Map());
    }
    this.memories.get(userId)!.set(memory.id, memory);

    log.info('Memory stored', { memoryId: memory.id, contentLength: content.length });
    return memory;
  }

  /**
   * Search memories by semantic similarity
   */
  async search(
    userId: string,
    query: string,
    limit: number = 10
  ): Promise<MemorySearchResult[]> {
    const log = logger.child({ userId, operation: 'memory.search' });
    const userMemories = this.memories.get(userId);

    if (!userMemories || userMemories.size === 0) {
      log.debug('No memories found for user');
      return [];
    }

    // Generate embedding for the query
    const queryEmbedding = await this.embedding.embed(query);

    // Calculate similarity scores for all memories
    const results: Array<{ memory: MemoryItem; similarity: number }> = [];

    for (const memory of userMemories.values()) {
      const similarity = cosineSimilarity(queryEmbedding, memory.embedding);
      results.push({ memory, similarity });
    }

    // Sort by similarity (descending) and take top N
    results.sort((a, b) => b.similarity - a.similarity);
    const topResults = results.slice(0, limit);

    log.debug('Memory search completed', {
      query: query.slice(0, 50),
      totalMemories: userMemories.size,
      resultsReturned: topResults.length,
    });

    return topResults.map(({ memory, similarity }) => ({
      id: memory.id,
      content: memory.content,
      metadata: memory.metadata,
      similarity,
      createdAt: memory.createdAt,
    }));
  }

  /**
   * Get recent memories (newest first)
   */
  async getRecent(userId: string, limit: number = 10): Promise<MemoryItem[]> {
    const userMemories = this.memories.get(userId);

    if (!userMemories || userMemories.size === 0) {
      return [];
    }

    // Convert to array and sort by createdAt descending
    const sorted = Array.from(userMemories.values()).sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
    );

    return sorted.slice(0, limit);
  }

  /**
   * Delete a specific memory
   */
  async delete(userId: string, memoryId: string): Promise<void> {
    const log = logger.child({ userId, memoryId, operation: 'memory.delete' });
    const userMemories = this.memories.get(userId);

    if (!userMemories || !userMemories.has(memoryId)) {
      log.warn('Memory not found for deletion');
      throw new Error(`Memory ${memoryId} not found for user ${userId}`);
    }

    userMemories.delete(memoryId);
    log.info('Memory deleted');
  }

  // =========================================================================
  // Test/Debug helpers (not part of port interface)
  // =========================================================================

  /**
   * Clear all memories for a user (useful for testing)
   */
  clearUser(userId: string): void {
    this.memories.delete(userId);
  }

  /**
   * Clear all memories (useful for testing)
   */
  clearAll(): void {
    this.memories.clear();
  }

  /**
   * Get count of memories for a user
   */
  getCount(userId: string): number {
    return this.memories.get(userId)?.size || 0;
  }
}
