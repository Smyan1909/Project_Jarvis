// =============================================================================
// PgMemoryStore - Integration Tests
// =============================================================================
// Tests the full memory store with embedding generation and pgvector search.

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { db, queryClient } from '../../infrastructure/db/client.js';
import { memories, users } from '../../infrastructure/db/schema.js';
import { PgMemoryStore } from './PgMemoryStore.js';
import { MemoryRepository } from '../storage/memory-repository.js';
import { UserRepository } from '../storage/user-repository.js';
import type { EmbeddingPort } from '../../ports/EmbeddingPort.js';

/**
 * Mock embedding adapter for testing
 * Creates deterministic embeddings based on text content
 */
class MockEmbeddingAdapter implements EmbeddingPort {
  private callCount = 0;

  /**
   * Generate a deterministic embedding based on text content
   * Uses a simple hash-like approach for predictable similarity
   */
  async embed(text: string): Promise<number[]> {
    this.callCount++;
    return this.textToEmbedding(text);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map((t) => this.embed(t)));
  }

  getDimension(): number {
    return 1536;
  }

  getModel(): string {
    return 'mock-embedding-model';
  }

  getCallCount(): number {
    return this.callCount;
  }

  resetCallCount(): void {
    this.callCount = 0;
  }

  /**
   * Create a normalized embedding vector from text
   * Similar texts will produce similar vectors
   */
  private textToEmbedding(text: string): number[] {
    const embedding = new Array(1536).fill(0);

    // Use character codes to create a pattern
    for (let i = 0; i < text.length && i < 1536; i++) {
      const charCode = text.charCodeAt(i);
      embedding[i] = Math.sin(charCode * 0.1);
      // Spread influence to nearby dimensions
      if (i > 0) embedding[i - 1] += Math.cos(charCode * 0.05) * 0.5;
      if (i < 1535) embedding[i + 1] += Math.cos(charCode * 0.05) * 0.5;
    }

    // Add some base signal based on text length
    for (let i = 0; i < 1536; i++) {
      embedding[i] += Math.sin((i + text.length) * 0.01) * 0.3;
    }

    // Normalize
    const norm = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
    return embedding.map((val) => (norm > 0 ? val / norm : 0));
  }
}

describe('PgMemoryStore Integration', () => {
  let store: PgMemoryStore;
  let repository: MemoryRepository;
  let userRepo: UserRepository;
  let mockEmbedding: MockEmbeddingAdapter;
  let testUserId: string;
  let testUserId2: string;

  beforeAll(async () => {
    repository = new MemoryRepository();
    userRepo = new UserRepository();
    mockEmbedding = new MockEmbeddingAdapter();
    store = new PgMemoryStore(repository, mockEmbedding);

    // Create test users
    const user = await userRepo.create({
      email: `pg-memory-store-test-${Date.now()}@example.com`,
      passwordHash: 'test-hash',
      displayName: 'PgMemoryStore Test User',
    });
    testUserId = user.id;

    const user2 = await userRepo.create({
      email: `pg-memory-store-test-2-${Date.now()}@example.com`,
      passwordHash: 'test-hash',
      displayName: 'PgMemoryStore Test User 2',
    });
    testUserId2 = user2.id;
  });

  afterEach(async () => {
    await db.delete(memories).where(sql`user_id = ${testUserId}`);
    await db.delete(memories).where(sql`user_id = ${testUserId2}`);
    mockEmbedding.resetCallCount();
  });

  afterAll(async () => {
    await db.delete(users).where(sql`id = ${testUserId}`);
    await db.delete(users).where(sql`id = ${testUserId2}`);
    await queryClient.end();
  });

  // ===========================================================================
  // store() tests
  // ===========================================================================

  describe('store()', () => {
    it('should store a memory with automatic embedding', async () => {
      const memory = await store.store(testUserId, 'Remember this important fact');

      expect(memory).toBeDefined();
      expect(memory.id).toBeDefined();
      expect(memory.userId).toBe(testUserId);
      expect(memory.content).toBe('Remember this important fact');
      expect(memory.embedding).toBeDefined();
      expect(memory.embedding.length).toBe(1536);
      expect(memory.createdAt).toBeInstanceOf(Date);
      expect(mockEmbedding.getCallCount()).toBe(1);
    });

    it('should store a memory with metadata', async () => {
      const memory = await store.store(testUserId, 'Important meeting notes', {
        category: 'work',
        importance: 'high',
      });

      expect(memory.metadata).toEqual({ category: 'work', importance: 'high' });
    });
  });

  // ===========================================================================
  // search() tests
  // ===========================================================================

  describe('search()', () => {
    it('should find memories by semantic similarity', async () => {
      // Store some memories
      await store.store(testUserId, 'The quick brown fox jumps over the lazy dog');
      await store.store(testUserId, 'A fast brown fox leaps over a sleepy dog');
      await store.store(testUserId, 'Programming is fun and educational');

      // Search for fox-related content
      const results = await store.search(testUserId, 'fox jumping over dog', 10);

      expect(results.length).toBe(3);
      // Results should include similarity scores
      expect(results[0].similarity).toBeDefined();
      expect(results[0].similarity).toBeGreaterThan(0);
    });

    it('should respect limit parameter', async () => {
      for (let i = 0; i < 5; i++) {
        await store.store(testUserId, `Memory number ${i}`);
      }

      const results = await store.search(testUserId, 'memory', 2);
      expect(results.length).toBe(2);
    });

    it('should only search user\'s own memories', async () => {
      await store.store(testUserId, 'User 1 secret information');
      await store.store(testUserId2, 'User 2 secret information');

      const results = await store.search(testUserId2, 'secret information', 10);

      expect(results.length).toBe(1);
      expect(results[0].content).toBe('User 2 secret information');
    });

    it('should return empty array if no memories exist', async () => {
      const results = await store.search(testUserId, 'anything', 10);
      expect(results).toEqual([]);
    });
  });

  // ===========================================================================
  // searchWithThreshold() tests
  // ===========================================================================

  describe('searchWithThreshold()', () => {
    it('should filter by minimum similarity', async () => {
      await store.store(testUserId, 'Exact match content here');
      await store.store(testUserId, 'Completely different unrelated topic');

      // Search with high threshold
      const results = await store.searchWithThreshold(
        testUserId,
        'Exact match content here',
        0.99,
        10
      );

      // Should only return very similar results
      expect(results.length).toBe(1);
      expect(results[0].similarity).toBeGreaterThan(0.99);
    });
  });

  // ===========================================================================
  // getRecent() tests
  // ===========================================================================

  describe('getRecent()', () => {
    it('should return memories in newest-first order', async () => {
      await store.store(testUserId, 'First memory');
      await store.store(testUserId, 'Second memory');
      await store.store(testUserId, 'Third memory');

      const recent = await store.getRecent(testUserId, 10);

      expect(recent.length).toBe(3);
      expect(recent[0].content).toBe('Third memory');
      expect(recent[1].content).toBe('Second memory');
      expect(recent[2].content).toBe('First memory');
    });

    it('should respect limit parameter', async () => {
      for (let i = 0; i < 5; i++) {
        await store.store(testUserId, `Memory ${i}`);
      }

      const recent = await store.getRecent(testUserId, 2);
      expect(recent.length).toBe(2);
    });
  });

  // ===========================================================================
  // delete() tests
  // ===========================================================================

  describe('delete()', () => {
    it('should delete a memory', async () => {
      const memory = await store.store(testUserId, 'To be deleted');

      await store.delete(testUserId, memory.id);

      const found = await store.getById(testUserId, memory.id);
      expect(found).toBeNull();
    });

    it('should throw error for non-existent memory', async () => {
      await expect(
        store.delete(testUserId, '00000000-0000-0000-0000-000000000000')
      ).rejects.toThrow(/not found/);
    });

    it('should not delete memory belonging to different user', async () => {
      const memory = await store.store(testUserId, 'Protected memory');

      await expect(store.delete(testUserId2, memory.id)).rejects.toThrow(/not found/);

      // Verify still exists
      const found = await store.getById(testUserId, memory.id);
      expect(found).toBeDefined();
    });
  });

  // ===========================================================================
  // getById() tests
  // ===========================================================================

  describe('getById()', () => {
    it('should get a memory by ID', async () => {
      const memory = await store.store(testUserId, 'Find this memory');

      const found = await store.getById(testUserId, memory.id);

      expect(found).toBeDefined();
      expect(found!.id).toBe(memory.id);
      expect(found!.content).toBe('Find this memory');
    });

    it('should return null for non-existent memory', async () => {
      const found = await store.getById(testUserId, '00000000-0000-0000-0000-000000000000');
      expect(found).toBeNull();
    });
  });

  // ===========================================================================
  // update() tests
  // ===========================================================================

  describe('update()', () => {
    it('should update memory content with new embedding', async () => {
      const memory = await store.store(testUserId, 'Original content');
      const originalEmbedding = memory.embedding;

      mockEmbedding.resetCallCount();

      const updated = await store.update(testUserId, memory.id, 'Updated content');

      expect(updated.content).toBe('Updated content');
      expect(mockEmbedding.getCallCount()).toBe(1); // Should re-embed
      // Embeddings should be different since content changed
      expect(updated.embedding).not.toEqual(originalEmbedding);
    });

    it('should throw error for non-existent memory', async () => {
      await expect(
        store.update(testUserId, '00000000-0000-0000-0000-000000000000', 'New content')
      ).rejects.toThrow(/not found/);
    });
  });

  // ===========================================================================
  // getAll() tests
  // ===========================================================================

  describe('getAll()', () => {
    it('should return all memories for a user', async () => {
      await store.store(testUserId, 'Memory 1');
      await store.store(testUserId, 'Memory 2');
      await store.store(testUserId, 'Memory 3');

      const all = await store.getAll(testUserId);

      expect(all.length).toBe(3);
    });

    it('should only return user\'s own memories', async () => {
      await store.store(testUserId, 'User 1 memory');
      await store.store(testUserId2, 'User 2 memory');

      const all = await store.getAll(testUserId);

      expect(all.length).toBe(1);
      expect(all[0].content).toBe('User 1 memory');
    });
  });

  // ===========================================================================
  // count() tests
  // ===========================================================================

  describe('count()', () => {
    it('should count memories for a user', async () => {
      await store.store(testUserId, 'Memory 1');
      await store.store(testUserId, 'Memory 2');

      const count = await store.count(testUserId);
      expect(count).toBe(2);
    });

    it('should return 0 for user with no memories', async () => {
      const count = await store.count(testUserId);
      expect(count).toBe(0);
    });
  });

  // ===========================================================================
  // deleteAll() tests
  // ===========================================================================

  describe('deleteAll()', () => {
    it('should delete all memories for a user', async () => {
      await store.store(testUserId, 'Memory 1');
      await store.store(testUserId, 'Memory 2');
      await store.store(testUserId, 'Memory 3');

      const count = await store.deleteAll(testUserId);
      expect(count).toBe(3);

      const remaining = await store.getAll(testUserId);
      expect(remaining.length).toBe(0);
    });

    it('should not affect other users\' memories', async () => {
      await store.store(testUserId, 'User 1 memory');
      await store.store(testUserId2, 'User 2 memory');

      await store.deleteAll(testUserId);

      const user2Memories = await store.getAll(testUserId2);
      expect(user2Memories.length).toBe(1);
    });
  });
});
