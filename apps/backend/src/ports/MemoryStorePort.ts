import type { MemoryItem, MemorySearchResult } from '@project-jarvis/shared-types';

// =============================================================================
// Memory Store Port
// =============================================================================

/**
 * Port interface for vector memory storage
 *
 * This port abstracts the storage and retrieval of user memories using
 * semantic similarity search. Memories are automatically embedded and
 * can be searched using natural language queries.
 */
export interface MemoryStorePort {
  /**
   * Store a new memory
   *
   * The content will be automatically embedded for semantic search.
   * Metadata can include category, source, or any custom fields.
   *
   * @param userId - The user who owns this memory
   * @param content - The text content to remember
   * @param metadata - Optional metadata for filtering/categorization
   * @returns The created memory item with ID and embedding
   */
  store(userId: string, content: string, metadata?: Record<string, unknown>): Promise<MemoryItem>;

  /**
   * Search memories by semantic similarity
   *
   * Uses vector similarity to find memories related to the query.
   * Results are ranked by similarity score.
   *
   * @param userId - The user whose memories to search
   * @param query - Natural language search query
   * @param limit - Maximum number of results (default: 10)
   * @returns Array of matching memories with similarity scores
   */
  search(userId: string, query: string, limit?: number): Promise<MemorySearchResult[]>;

  /**
   * Get recent memories
   *
   * Retrieves the most recently created memories for a user.
   * Useful for showing recent context or activity.
   *
   * @param userId - The user whose memories to retrieve
   * @param limit - Maximum number of memories (default: 10)
   * @returns Array of recent memory items, newest first
   */
  getRecent(userId: string, limit?: number): Promise<MemoryItem[]>;

  /**
   * Delete a memory
   *
   * Permanently removes a memory and its embedding.
   *
   * @param userId - The user who owns the memory (for authorization)
   * @param memoryId - The ID of the memory to delete
   * @throws NotFoundError if memory doesn't exist or doesn't belong to user
   */
  delete(userId: string, memoryId: string): Promise<void>;
}
