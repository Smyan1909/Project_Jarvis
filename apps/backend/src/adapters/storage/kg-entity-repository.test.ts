// =============================================================================
// KG Entity Repository - Integration Tests
// =============================================================================
// Tests run against the real database to verify pgvector queries work correctly.

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { db, queryClient } from '../../infrastructure/db/client.js';
import { kgEntities, users } from '../../infrastructure/db/schema.js';
import { KGEntityRepository } from './kg-entity-repository.js';
import { UserRepository } from './user-repository.js';

describe('KGEntityRepository Integration', () => {
  let repo: KGEntityRepository;
  let userRepo: UserRepository;
  let testUserId: string;
  let testUserId2: string;

  // Sample embeddings for testing (1536 dimensions)
  // Creates normalized vectors with a base pattern + seed-based variation
  const createTestEmbedding = (seed: number): number[] => {
    const embedding = new Array(1536).fill(0);
    // Use a base offset to avoid all-zero vectors when seed is 0
    for (let i = 0; i < 1536; i++) {
      embedding[i] = Math.sin((seed + 1) * (i + 1) * 0.01) + 0.5;
    }
    const norm = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
    return embedding.map((val) => val / norm);
  };

  // Create embeddings with small differences for high similarity
  const similarEmbedding1 = createTestEmbedding(1);
  // For similarEmbedding2, use the same base but add tiny noise for ~0.99 similarity
  const similarEmbedding2 = similarEmbedding1.map((val, i) => {
    const noise = (i % 10) * 0.0001;
    return val + noise;
  });
  const norm2 = Math.sqrt(similarEmbedding2.reduce((sum, val) => sum + val * val, 0));
  for (let i = 0; i < similarEmbedding2.length; i++) {
    similarEmbedding2[i] = similarEmbedding2[i] / norm2;
  }
  const differentEmbedding = createTestEmbedding(50);

  beforeAll(async () => {
    repo = new KGEntityRepository();
    userRepo = new UserRepository();

    const user = await userRepo.create({
      email: `kg-entity-test-${Date.now()}@example.com`,
      passwordHash: 'test-hash',
      displayName: 'KG Entity Test User',
    });
    testUserId = user.id;

    const user2 = await userRepo.create({
      email: `kg-entity-test-2-${Date.now()}@example.com`,
      passwordHash: 'test-hash',
      displayName: 'KG Entity Test User 2',
    });
    testUserId2 = user2.id;
  });

  afterEach(async () => {
    await db.delete(kgEntities).where(sql`user_id = ${testUserId}`);
    await db.delete(kgEntities).where(sql`user_id = ${testUserId2}`);
  });

  afterAll(async () => {
    await db.delete(users).where(sql`id = ${testUserId}`);
    await db.delete(users).where(sql`id = ${testUserId2}`);
    await queryClient.end();
  });

  // ===========================================================================
  // create() tests
  // ===========================================================================

  describe('create()', () => {
    it('should create an entity without embedding', async () => {
      const entity = await repo.create({
        userId: testUserId,
        type: 'person',
        name: 'John Doe',
      });

      expect(entity).toBeDefined();
      expect(entity.id).toBeDefined();
      expect(entity.userId).toBe(testUserId);
      expect(entity.type).toBe('person');
      expect(entity.name).toBe('John Doe');
      expect(entity.embedding).toBeNull();
      expect(entity.properties).toEqual({});
      expect(entity.createdAt).toBeInstanceOf(Date);
      expect(entity.updatedAt).toBeInstanceOf(Date);
    });

    it('should create an entity with embedding', async () => {
      const entity = await repo.create({
        userId: testUserId,
        type: 'person',
        name: 'Jane Doe',
        embedding: similarEmbedding1,
      });

      expect(entity.embedding).toBeDefined();
      expect(entity.embedding!.length).toBe(1536);
    });

    it('should create an entity with properties', async () => {
      const entity = await repo.create({
        userId: testUserId,
        type: 'organization',
        name: 'Acme Corp',
        properties: { industry: 'tech', employees: 100 },
      });

      expect(entity.properties).toEqual({ industry: 'tech', employees: 100 });
    });
  });

  // ===========================================================================
  // findById() tests
  // ===========================================================================

  describe('findById()', () => {
    it('should find an entity by ID', async () => {
      const created = await repo.create({
        userId: testUserId,
        type: 'place',
        name: 'New York',
      });

      const found = await repo.findById(testUserId, created.id);

      expect(found).toBeDefined();
      expect(found!.id).toBe(created.id);
      expect(found!.name).toBe('New York');
    });

    it('should return null for non-existent ID', async () => {
      const found = await repo.findById(testUserId, '00000000-0000-0000-0000-000000000000');
      expect(found).toBeNull();
    });

    it('should not find entity belonging to different user', async () => {
      const created = await repo.create({
        userId: testUserId,
        type: 'person',
        name: 'Private Person',
      });

      const found = await repo.findById(testUserId2, created.id);
      expect(found).toBeNull();
    });
  });

  // ===========================================================================
  // findByType() tests
  // ===========================================================================

  describe('findByType()', () => {
    it('should find entities by type', async () => {
      await repo.create({ userId: testUserId, type: 'person', name: 'Alice' });
      await repo.create({ userId: testUserId, type: 'person', name: 'Bob' });
      await repo.create({ userId: testUserId, type: 'organization', name: 'Corp' });

      const people = await repo.findByType(testUserId, 'person');

      expect(people.length).toBe(2);
      expect(people.every((e) => e.type === 'person')).toBe(true);
    });

    it('should return empty array for non-existent type', async () => {
      const entities = await repo.findByType(testUserId, 'nonexistent');
      expect(entities).toEqual([]);
    });
  });

  // ===========================================================================
  // findByName() tests
  // ===========================================================================

  describe('findByName()', () => {
    it('should find entities by exact name', async () => {
      await repo.create({ userId: testUserId, type: 'person', name: 'John Smith' });
      await repo.create({ userId: testUserId, type: 'organization', name: 'John Smith' });

      const entities = await repo.findByName(testUserId, 'John Smith');

      expect(entities.length).toBe(2);
    });

    it('should filter by type when specified', async () => {
      await repo.create({ userId: testUserId, type: 'person', name: 'John Smith' });
      await repo.create({ userId: testUserId, type: 'organization', name: 'John Smith' });

      const entities = await repo.findByName(testUserId, 'John Smith', 'person');

      expect(entities.length).toBe(1);
      expect(entities[0].type).toBe('person');
    });
  });

  // ===========================================================================
  // searchSimilar() tests
  // ===========================================================================

  describe('searchSimilar()', () => {
    it('should find similar entities by vector search', async () => {
      await repo.create({
        userId: testUserId,
        type: 'concept',
        name: 'Concept A',
        embedding: similarEmbedding1,
      });
      await repo.create({
        userId: testUserId,
        type: 'concept',
        name: 'Concept B',
        embedding: similarEmbedding2,
      });
      await repo.create({
        userId: testUserId,
        type: 'concept',
        name: 'Concept C',
        embedding: differentEmbedding,
      });

      const results = await repo.searchSimilar(testUserId, similarEmbedding1, undefined, 10);

      expect(results.length).toBe(3);
      expect(results[0].name).toBe('Concept A');
      expect(results[0].similarity).toBeCloseTo(1.0, 3);
      expect(results[1].name).toBe('Concept B');
      expect(results[1].similarity).toBeGreaterThan(0.9);
    });

    it('should filter by type when specified', async () => {
      await repo.create({
        userId: testUserId,
        type: 'person',
        name: 'Person',
        embedding: similarEmbedding1,
      });
      await repo.create({
        userId: testUserId,
        type: 'organization',
        name: 'Org',
        embedding: similarEmbedding1,
      });

      const results = await repo.searchSimilar(testUserId, similarEmbedding1, 'person', 10);

      expect(results.length).toBe(1);
      expect(results[0].name).toBe('Person');
    });

    it('should respect limit parameter', async () => {
      for (let i = 0; i < 5; i++) {
        await repo.create({
          userId: testUserId,
          type: 'concept',
          name: `Concept ${i}`,
          embedding: createTestEmbedding(i),
        });
      }

      const results = await repo.searchSimilar(testUserId, similarEmbedding1, undefined, 2);
      expect(results.length).toBe(2);
    });

    it('should only search user\'s own entities', async () => {
      await repo.create({
        userId: testUserId,
        type: 'concept',
        name: 'User 1 Concept',
        embedding: similarEmbedding1,
      });
      await repo.create({
        userId: testUserId2,
        type: 'concept',
        name: 'User 2 Concept',
        embedding: similarEmbedding1,
      });

      const results = await repo.searchSimilar(testUserId2, similarEmbedding1, undefined, 10);

      expect(results.length).toBe(1);
      expect(results[0].name).toBe('User 2 Concept');
    });
  });

  // ===========================================================================
  // update() tests
  // ===========================================================================

  describe('update()', () => {
    it('should update entity name', async () => {
      const created = await repo.create({
        userId: testUserId,
        type: 'person',
        name: 'Old Name',
      });

      const updated = await repo.update(testUserId, created.id, {
        name: 'New Name',
      });

      expect(updated!.name).toBe('New Name');
      expect(updated!.updatedAt.getTime()).toBeGreaterThan(created.updatedAt.getTime());
    });

    it('should update entity type', async () => {
      const created = await repo.create({
        userId: testUserId,
        type: 'person',
        name: 'John',
      });

      const updated = await repo.update(testUserId, created.id, {
        type: 'organization',
      });

      expect(updated!.type).toBe('organization');
    });

    it('should update entity embedding', async () => {
      const created = await repo.create({
        userId: testUserId,
        type: 'concept',
        name: 'Concept',
      });

      const updated = await repo.update(testUserId, created.id, {
        embedding: similarEmbedding1,
      });

      expect(updated!.embedding).toBeDefined();
      expect(updated!.embedding!.length).toBe(1536);
    });

    it('should return null for non-existent entity', async () => {
      const updated = await repo.update(testUserId, '00000000-0000-0000-0000-000000000000', {
        name: 'New Name',
      });
      expect(updated).toBeNull();
    });

    it('should not update entity belonging to different user', async () => {
      const created = await repo.create({
        userId: testUserId,
        type: 'person',
        name: 'Original',
      });

      const updated = await repo.update(testUserId2, created.id, {
        name: 'Hacked!',
      });

      expect(updated).toBeNull();

      const original = await repo.findById(testUserId, created.id);
      expect(original!.name).toBe('Original');
    });
  });

  // ===========================================================================
  // mergeProperties() tests
  // ===========================================================================

  describe('mergeProperties()', () => {
    it('should merge properties with existing properties', async () => {
      const created = await repo.create({
        userId: testUserId,
        type: 'person',
        name: 'John',
        properties: { age: 30, city: 'NYC' },
      });

      const updated = await repo.mergeProperties(testUserId, created.id, {
        age: 31,
        job: 'engineer',
      });

      expect(updated!.properties).toEqual({
        age: 31,
        city: 'NYC',
        job: 'engineer',
      });
    });

    it('should return null for non-existent entity', async () => {
      const updated = await repo.mergeProperties(
        testUserId,
        '00000000-0000-0000-0000-000000000000',
        { key: 'value' }
      );
      expect(updated).toBeNull();
    });
  });

  // ===========================================================================
  // delete() tests
  // ===========================================================================

  describe('delete()', () => {
    it('should delete an entity', async () => {
      const created = await repo.create({
        userId: testUserId,
        type: 'person',
        name: 'To Delete',
      });

      const deleted = await repo.delete(testUserId, created.id);
      expect(deleted).toBe(true);

      const found = await repo.findById(testUserId, created.id);
      expect(found).toBeNull();
    });

    it('should return false for non-existent entity', async () => {
      const deleted = await repo.delete(testUserId, '00000000-0000-0000-0000-000000000000');
      expect(deleted).toBe(false);
    });

    it('should not delete entity belonging to different user', async () => {
      const created = await repo.create({
        userId: testUserId,
        type: 'person',
        name: 'Protected',
      });

      const deleted = await repo.delete(testUserId2, created.id);
      expect(deleted).toBe(false);

      const found = await repo.findById(testUserId, created.id);
      expect(found).toBeDefined();
    });
  });

  // ===========================================================================
  // deleteByUser() tests
  // ===========================================================================

  describe('deleteByUser()', () => {
    it('should delete all entities for a user', async () => {
      await repo.create({ userId: testUserId, type: 'person', name: 'A' });
      await repo.create({ userId: testUserId, type: 'person', name: 'B' });
      await repo.create({ userId: testUserId, type: 'person', name: 'C' });

      const count = await repo.deleteByUser(testUserId);
      expect(count).toBe(3);

      const remaining = await repo.findByUser(testUserId);
      expect(remaining.length).toBe(0);
    });

    it('should not affect other users\' entities', async () => {
      await repo.create({ userId: testUserId, type: 'person', name: 'User 1' });
      await repo.create({ userId: testUserId2, type: 'person', name: 'User 2' });

      await repo.deleteByUser(testUserId);

      const user2Entities = await repo.findByUser(testUserId2);
      expect(user2Entities.length).toBe(1);
    });
  });

  // ===========================================================================
  // countByUser() tests
  // ===========================================================================

  describe('countByUser()', () => {
    it('should count entities for a user', async () => {
      await repo.create({ userId: testUserId, type: 'person', name: 'A' });
      await repo.create({ userId: testUserId, type: 'person', name: 'B' });

      const count = await repo.countByUser(testUserId);
      expect(count).toBe(2);
    });

    it('should count by type when specified', async () => {
      await repo.create({ userId: testUserId, type: 'person', name: 'A' });
      await repo.create({ userId: testUserId, type: 'person', name: 'B' });
      await repo.create({ userId: testUserId, type: 'organization', name: 'C' });

      const personCount = await repo.countByUser(testUserId, 'person');
      expect(personCount).toBe(2);

      const orgCount = await repo.countByUser(testUserId, 'organization');
      expect(orgCount).toBe(1);
    });

    it('should return 0 for user with no entities', async () => {
      const count = await repo.countByUser(testUserId);
      expect(count).toBe(0);
    });
  });

  // ===========================================================================
  // findByIds() tests
  // ===========================================================================

  describe('findByIds()', () => {
    it('should find multiple entities by IDs', async () => {
      const e1 = await repo.create({ userId: testUserId, type: 'person', name: 'A' });
      const e2 = await repo.create({ userId: testUserId, type: 'person', name: 'B' });
      await repo.create({ userId: testUserId, type: 'person', name: 'C' });

      const found = await repo.findByIds(testUserId, [e1.id, e2.id]);

      expect(found.length).toBe(2);
      expect(found.map((e) => e.name).sort()).toEqual(['A', 'B']);
    });

    it('should return empty array for empty ID list', async () => {
      const found = await repo.findByIds(testUserId, []);
      expect(found).toEqual([]);
    });

    it('should only return user\'s own entities', async () => {
      const e1 = await repo.create({ userId: testUserId, type: 'person', name: 'User 1' });
      const e2 = await repo.create({ userId: testUserId2, type: 'person', name: 'User 2' });

      const found = await repo.findByIds(testUserId, [e1.id, e2.id]);

      expect(found.length).toBe(1);
      expect(found[0].name).toBe('User 1');
    });
  });
});
