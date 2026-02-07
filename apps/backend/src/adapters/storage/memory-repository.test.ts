// =============================================================================
// Memory Repository - Integration Tests
// =============================================================================
// Tests run against the real database to verify pgvector queries work correctly.

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { db, queryClient } from '../../infrastructure/db/client.js';
import { memories, users } from '../../infrastructure/db/schema.js';
import { MemoryRepository } from './memory-repository.js';
import { UserRepository } from './user-repository.js';

describe('MemoryRepository Integration', () => {
  let repo: MemoryRepository;
  let userRepo: UserRepository;
  let testUserId: string;
  let testUserId2: string;

  // Sample embeddings for testing (1536 dimensions)
  // Creates normalized vectors with a base pattern + seed-based variation
  const createTestEmbedding = (seed: number): number[] => {
    const embedding = new Array(1536).fill(0);
    // Create a pattern based on the seed for predictable similarity
    // Use a base offset to avoid all-zero vectors when seed is 0
    for (let i = 0; i < 1536; i++) {
      embedding[i] = Math.sin((seed + 1) * (i + 1) * 0.01) + 0.5;
    }
    // Normalize the vector
    const norm = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
    return embedding.map((val) => val / norm);
  };

  // Create embeddings with small differences for high similarity
  const similarEmbedding1 = createTestEmbedding(1);
  // For similarEmbedding2, use the same base but add tiny noise for ~0.99 similarity
  const similarEmbedding2 = similarEmbedding1.map((val, i) => {
    const noise = (i % 10) * 0.0001; // Tiny deterministic noise
    return val + noise;
  });
  // Normalize similarEmbedding2
  const norm2 = Math.sqrt(similarEmbedding2.reduce((sum, val) => sum + val * val, 0));
  for (let i = 0; i < similarEmbedding2.length; i++) {
    similarEmbedding2[i] = similarEmbedding2[i] / norm2;
  }
  const differentEmbedding = createTestEmbedding(50); // Different pattern

  beforeAll(async () => {
    repo = new MemoryRepository();
    userRepo = new UserRepository();

    // Create test users
    const user = await userRepo.create({
      email: `memory-test-${Date.now()}@example.com`,
      passwordHash: 'test-hash',
      displayName: 'Memory Test User',
    });
    testUserId = user.id;

    const user2 = await userRepo.create({
      email: `memory-test-2-${Date.now()}@example.com`,
      passwordHash: 'test-hash',
      displayName: 'Memory Test User 2',
    });
    testUserId2 = user2.id;
  });

  afterEach(async () => {
    // Clean up memories from test users
    await db.delete(memories).where(sql`user_id = ${testUserId}`);
    await db.delete(memories).where(sql`user_id = ${testUserId2}`);
  });

  afterAll(async () => {
    // Clean up test users (cascades to memories)
    await db.delete(users).where(sql`id = ${testUserId}`);
    await db.delete(users).where(sql`id = ${testUserId2}`);
    await queryClient.end();
  });

  // ===========================================================================
  // create() tests
  // ===========================================================================

  describe('create()', () => {
    it('should create a memory without embedding', async () => {
      const memory = await repo.create({
        userId: testUserId,
        content: 'Remember this important fact',
      });

      expect(memory).toBeDefined();
      expect(memory.id).toBeDefined();
      expect(memory.userId).toBe(testUserId);
      expect(memory.content).toBe('Remember this important fact');
      expect(memory.embedding).toBeNull();
      expect(memory.metadata).toEqual({});
      expect(memory.createdAt).toBeInstanceOf(Date);
    });

    it('should create a memory with embedding', async () => {
      const memory = await repo.create({
        userId: testUserId,
        content: 'Memory with vector',
        embedding: similarEmbedding1,
      });

      expect(memory.embedding).toBeDefined();
      expect(memory.embedding!.length).toBe(1536);
    });

    it('should create a memory with metadata', async () => {
      const memory = await repo.create({
        userId: testUserId,
        content: 'Memory with metadata',
        metadata: { category: 'work', importance: 'high' },
      });

      expect(memory.metadata).toEqual({ category: 'work', importance: 'high' });
    });
  });

  // ===========================================================================
  // findById() tests
  // ===========================================================================

  describe('findById()', () => {
    it('should find a memory by ID', async () => {
      const created = await repo.create({
        userId: testUserId,
        content: 'Find this memory',
        embedding: similarEmbedding1,
      });

      const found = await repo.findById(testUserId, created.id);

      expect(found).toBeDefined();
      expect(found!.id).toBe(created.id);
      expect(found!.content).toBe('Find this memory');
    });

    it('should return null for non-existent ID', async () => {
      const found = await repo.findById(testUserId, '00000000-0000-0000-0000-000000000000');
      expect(found).toBeNull();
    });

    it('should not find memory belonging to different user', async () => {
      const created = await repo.create({
        userId: testUserId,
        content: 'User 1 memory',
      });

      // Try to find with different user ID
      const found = await repo.findById(testUserId2, created.id);
      expect(found).toBeNull();
    });
  });

  // ===========================================================================
  // searchSimilar() tests
  // ===========================================================================

  describe('searchSimilar()', () => {
    it('should find similar memories by vector search', async () => {
      // Create memories with embeddings
      await repo.create({
        userId: testUserId,
        content: 'Similar memory 1',
        embedding: similarEmbedding1,
      });
      await repo.create({
        userId: testUserId,
        content: 'Similar memory 2',
        embedding: similarEmbedding2,
      });
      await repo.create({
        userId: testUserId,
        content: 'Different memory',
        embedding: differentEmbedding,
      });

      // Search with embedding similar to 1 and 2
      const results = await repo.searchSimilar(testUserId, similarEmbedding1, 10);

      expect(results.length).toBe(3);
      // First result should be most similar (exact match)
      expect(results[0].content).toBe('Similar memory 1');
      expect(results[0].similarity).toBeCloseTo(1.0, 3);
      // Second should be similar embedding
      expect(results[1].content).toBe('Similar memory 2');
      expect(results[1].similarity).toBeGreaterThan(0.9);
      // Third should be different
      expect(results[2].content).toBe('Different memory');
      expect(results[2].similarity).toBeLessThan(results[1].similarity);
    });

    it('should respect limit parameter', async () => {
      // Create multiple memories
      for (let i = 0; i < 5; i++) {
        await repo.create({
          userId: testUserId,
          content: `Memory ${i}`,
          embedding: createTestEmbedding(i),
        });
      }

      const results = await repo.searchSimilar(testUserId, similarEmbedding1, 2);
      expect(results.length).toBe(2);
    });

    it('should only search user\'s own memories', async () => {
      // Create memory for user 1
      await repo.create({
        userId: testUserId,
        content: 'User 1 secret',
        embedding: similarEmbedding1,
      });

      // Create memory for user 2
      await repo.create({
        userId: testUserId2,
        content: 'User 2 secret',
        embedding: similarEmbedding1,
      });

      // User 2 searches
      const results = await repo.searchSimilar(testUserId2, similarEmbedding1, 10);

      expect(results.length).toBe(1);
      expect(results[0].content).toBe('User 2 secret');
    });

    it('should return empty array if no memories have embeddings', async () => {
      await repo.create({
        userId: testUserId,
        content: 'No embedding',
      });

      const results = await repo.searchSimilar(testUserId, similarEmbedding1, 10);
      expect(results.length).toBe(0);
    });
  });

  // ===========================================================================
  // searchSimilarWithThreshold() tests
  // ===========================================================================

  describe('searchSimilarWithThreshold()', () => {
    it('should only return memories above similarity threshold', async () => {
      await repo.create({
        userId: testUserId,
        content: 'Very similar',
        embedding: similarEmbedding1,
      });
      await repo.create({
        userId: testUserId,
        content: 'Different',
        embedding: differentEmbedding,
      });

      // Search with high threshold
      const results = await repo.searchSimilarWithThreshold(
        testUserId,
        similarEmbedding1,
        0.99, // Only very similar
        10
      );

      expect(results.length).toBe(1);
      expect(results[0].content).toBe('Very similar');
    });
  });

  // ===========================================================================
  // findRecent() tests
  // ===========================================================================

  describe('findRecent()', () => {
    it('should return memories in newest-first order', async () => {
      await repo.create({ userId: testUserId, content: 'Memory 1' });
      await repo.create({ userId: testUserId, content: 'Memory 2' });
      await repo.create({ userId: testUserId, content: 'Memory 3' });

      const recent = await repo.findRecent(testUserId, 10);

      expect(recent.length).toBe(3);
      expect(recent[0].content).toBe('Memory 3');
      expect(recent[1].content).toBe('Memory 2');
      expect(recent[2].content).toBe('Memory 1');
    });

    it('should respect limit parameter', async () => {
      for (let i = 0; i < 5; i++) {
        await repo.create({ userId: testUserId, content: `Memory ${i}` });
      }

      const recent = await repo.findRecent(testUserId, 2);
      expect(recent.length).toBe(2);
    });

    it('should only return user\'s own memories', async () => {
      await repo.create({ userId: testUserId, content: 'User 1 memory' });
      await repo.create({ userId: testUserId2, content: 'User 2 memory' });

      const recent = await repo.findRecent(testUserId, 10);

      expect(recent.length).toBe(1);
      expect(recent[0].content).toBe('User 1 memory');
    });
  });

  // ===========================================================================
  // findByUser() tests
  // ===========================================================================

  describe('findByUser()', () => {
    it('should return all memories for a user', async () => {
      await repo.create({ userId: testUserId, content: 'Memory 1' });
      await repo.create({ userId: testUserId, content: 'Memory 2' });

      const all = await repo.findByUser(testUserId);

      expect(all.length).toBe(2);
    });
  });

  // ===========================================================================
  // update() tests
  // ===========================================================================

  describe('update()', () => {
    it('should update memory content', async () => {
      const created = await repo.create({
        userId: testUserId,
        content: 'Original content',
      });

      const updated = await repo.update(testUserId, created.id, {
        content: 'Updated content',
      });

      expect(updated!.content).toBe('Updated content');
    });

    it('should update memory embedding', async () => {
      const created = await repo.create({
        userId: testUserId,
        content: 'Memory to embed',
      });

      const updated = await repo.update(testUserId, created.id, {
        embedding: similarEmbedding1,
      });

      expect(updated!.embedding).toBeDefined();
      expect(updated!.embedding!.length).toBe(1536);
    });

    it('should update memory metadata', async () => {
      const created = await repo.create({
        userId: testUserId,
        content: 'Memory with metadata',
        metadata: { old: 'value' },
      });

      const updated = await repo.update(testUserId, created.id, {
        metadata: { new: 'value' },
      });

      expect(updated!.metadata).toEqual({ new: 'value' });
    });

    it('should return null for non-existent memory', async () => {
      const updated = await repo.update(testUserId, '00000000-0000-0000-0000-000000000000', {
        content: 'New content',
      });
      expect(updated).toBeNull();
    });

    it('should not update memory belonging to different user', async () => {
      const created = await repo.create({
        userId: testUserId,
        content: 'User 1 memory',
      });

      const updated = await repo.update(testUserId2, created.id, {
        content: 'Hacked!',
      });

      expect(updated).toBeNull();

      // Verify original is unchanged
      const original = await repo.findById(testUserId, created.id);
      expect(original!.content).toBe('User 1 memory');
    });
  });

  // ===========================================================================
  // delete() tests
  // ===========================================================================

  describe('delete()', () => {
    it('should delete a memory', async () => {
      const created = await repo.create({
        userId: testUserId,
        content: 'To be deleted',
      });

      const deleted = await repo.delete(testUserId, created.id);
      expect(deleted).toBe(true);

      const found = await repo.findById(testUserId, created.id);
      expect(found).toBeNull();
    });

    it('should return false for non-existent memory', async () => {
      const deleted = await repo.delete(testUserId, '00000000-0000-0000-0000-000000000000');
      expect(deleted).toBe(false);
    });

    it('should not delete memory belonging to different user', async () => {
      const created = await repo.create({
        userId: testUserId,
        content: 'Protected memory',
      });

      const deleted = await repo.delete(testUserId2, created.id);
      expect(deleted).toBe(false);

      // Verify still exists
      const found = await repo.findById(testUserId, created.id);
      expect(found).toBeDefined();
    });
  });

  // ===========================================================================
  // deleteByUser() tests
  // ===========================================================================

  describe('deleteByUser()', () => {
    it('should delete all memories for a user', async () => {
      await repo.create({ userId: testUserId, content: 'Memory 1' });
      await repo.create({ userId: testUserId, content: 'Memory 2' });
      await repo.create({ userId: testUserId, content: 'Memory 3' });

      const count = await repo.deleteByUser(testUserId);
      expect(count).toBe(3);

      const remaining = await repo.findByUser(testUserId);
      expect(remaining.length).toBe(0);
    });

    it('should not affect other users\' memories', async () => {
      await repo.create({ userId: testUserId, content: 'User 1 memory' });
      await repo.create({ userId: testUserId2, content: 'User 2 memory' });

      await repo.deleteByUser(testUserId);

      const user2Memories = await repo.findByUser(testUserId2);
      expect(user2Memories.length).toBe(1);
    });
  });

  // ===========================================================================
  // countByUser() tests
  // ===========================================================================

  describe('countByUser()', () => {
    it('should count memories for a user', async () => {
      await repo.create({ userId: testUserId, content: 'Memory 1' });
      await repo.create({ userId: testUserId, content: 'Memory 2' });

      const count = await repo.countByUser(testUserId);
      expect(count).toBe(2);
    });

    it('should return 0 for user with no memories', async () => {
      const count = await repo.countByUser(testUserId);
      expect(count).toBe(0);
    });
  });
});
