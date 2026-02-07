// =============================================================================
// PgKnowledgeGraph - Integration Tests
// =============================================================================
// Tests the full knowledge graph with embedding generation and pgvector search.

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { db, queryClient } from '../../infrastructure/db/client.js';
import { kgEntities, kgRelations, users } from '../../infrastructure/db/schema.js';
import { PgKnowledgeGraph } from './PgKnowledgeGraph.js';
import { KGEntityRepository } from '../storage/kg-entity-repository.js';
import { KGRelationRepository } from '../storage/kg-relation-repository.js';
import { UserRepository } from '../storage/user-repository.js';
import type { EmbeddingPort } from '../../ports/EmbeddingPort.js';

/**
 * Mock embedding adapter for testing
 */
class MockEmbeddingAdapter implements EmbeddingPort {
  private callCount = 0;

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

  private textToEmbedding(text: string): number[] {
    const embedding = new Array(1536).fill(0);

    for (let i = 0; i < text.length && i < 1536; i++) {
      const charCode = text.charCodeAt(i);
      embedding[i] = Math.sin(charCode * 0.1);
      if (i > 0) embedding[i - 1] += Math.cos(charCode * 0.05) * 0.5;
      if (i < 1535) embedding[i + 1] += Math.cos(charCode * 0.05) * 0.5;
    }

    for (let i = 0; i < 1536; i++) {
      embedding[i] += Math.sin((i + text.length) * 0.01) * 0.3;
    }

    const norm = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
    return embedding.map((val) => (norm > 0 ? val / norm : 0));
  }
}

describe('PgKnowledgeGraph Integration', () => {
  let kg: PgKnowledgeGraph;
  let entityRepo: KGEntityRepository;
  let relationRepo: KGRelationRepository;
  let userRepo: UserRepository;
  let mockEmbedding: MockEmbeddingAdapter;
  let testUserId: string;
  let testUserId2: string;

  beforeAll(async () => {
    entityRepo = new KGEntityRepository();
    relationRepo = new KGRelationRepository();
    userRepo = new UserRepository();
    mockEmbedding = new MockEmbeddingAdapter();
    kg = new PgKnowledgeGraph(entityRepo, relationRepo, mockEmbedding);

    const user = await userRepo.create({
      email: `pg-kg-test-${Date.now()}@example.com`,
      passwordHash: 'test-hash',
      displayName: 'PgKnowledgeGraph Test User',
    });
    testUserId = user.id;

    const user2 = await userRepo.create({
      email: `pg-kg-test-2-${Date.now()}@example.com`,
      passwordHash: 'test-hash',
      displayName: 'PgKnowledgeGraph Test User 2',
    });
    testUserId2 = user2.id;
  });

  afterEach(async () => {
    await db.delete(kgRelations).where(sql`user_id = ${testUserId}`);
    await db.delete(kgRelations).where(sql`user_id = ${testUserId2}`);
    await db.delete(kgEntities).where(sql`user_id = ${testUserId}`);
    await db.delete(kgEntities).where(sql`user_id = ${testUserId2}`);
    mockEmbedding.resetCallCount();
  });

  afterAll(async () => {
    await db.delete(users).where(sql`id = ${testUserId}`);
    await db.delete(users).where(sql`id = ${testUserId2}`);
    await queryClient.end();
  });

  // ===========================================================================
  // createEntity() tests
  // ===========================================================================

  describe('createEntity()', () => {
    it('should create an entity with automatic embedding', async () => {
      const entity = await kg.createEntity(testUserId, 'person', 'Alice Johnson');

      expect(entity).toBeDefined();
      expect(entity.id).toBeDefined();
      expect(entity.userId).toBe(testUserId);
      expect(entity.type).toBe('person');
      expect(entity.name).toBe('Alice Johnson');
      expect(entity.embedding).toBeDefined();
      expect(entity.embedding!.length).toBe(1536);
      expect(mockEmbedding.getCallCount()).toBe(1);
    });

    it('should create an entity with properties', async () => {
      const entity = await kg.createEntity(testUserId, 'organization', 'Acme Corp', {
        industry: 'tech',
        employees: 100,
      });

      expect(entity.properties).toEqual({ industry: 'tech', employees: 100 });
    });
  });

  // ===========================================================================
  // createRelation() tests
  // ===========================================================================

  describe('createRelation()', () => {
    it('should create a relation between entities', async () => {
      const alice = await kg.createEntity(testUserId, 'person', 'Alice');
      const acme = await kg.createEntity(testUserId, 'organization', 'Acme');

      const relation = await kg.createRelation(
        testUserId,
        alice.id,
        acme.id,
        'works_at'
      );

      expect(relation).toBeDefined();
      expect(relation.id).toBeDefined();
      expect(relation.sourceId).toBe(alice.id);
      expect(relation.targetId).toBe(acme.id);
      expect(relation.type).toBe('works_at');
    });

    it('should create a relation with properties', async () => {
      const alice = await kg.createEntity(testUserId, 'person', 'Alice');
      const bob = await kg.createEntity(testUserId, 'person', 'Bob');

      const relation = await kg.createRelation(
        testUserId,
        alice.id,
        bob.id,
        'knows',
        { since: 2020 }
      );

      expect(relation.properties).toEqual({ since: 2020 });
    });

    it('should throw error if source entity not found', async () => {
      const bob = await kg.createEntity(testUserId, 'person', 'Bob');

      await expect(
        kg.createRelation(
          testUserId,
          '00000000-0000-0000-0000-000000000000',
          bob.id,
          'knows'
        )
      ).rejects.toThrow(/Source entity.*not found/);
    });

    it('should throw error if target entity not found', async () => {
      const alice = await kg.createEntity(testUserId, 'person', 'Alice');

      await expect(
        kg.createRelation(
          testUserId,
          alice.id,
          '00000000-0000-0000-0000-000000000000',
          'knows'
        )
      ).rejects.toThrow(/Target entity.*not found/);
    });
  });

  // ===========================================================================
  // searchEntities() tests
  // ===========================================================================

  describe('searchEntities()', () => {
    it('should find entities by semantic similarity', async () => {
      await kg.createEntity(testUserId, 'person', 'Alice Johnson');
      await kg.createEntity(testUserId, 'person', 'Bob Smith');
      await kg.createEntity(testUserId, 'organization', 'Tech Company');

      const results = await kg.searchEntities(testUserId, 'person named Alice');

      expect(results.length).toBeGreaterThan(0);
    });

    it('should filter by type', async () => {
      await kg.createEntity(testUserId, 'person', 'Alice');
      await kg.createEntity(testUserId, 'organization', 'Alice Corp');

      const results = await kg.searchEntities(testUserId, 'Alice', 'person', 10);

      expect(results.length).toBe(1);
      expect(results[0].type).toBe('person');
    });

    it('should respect limit parameter', async () => {
      for (let i = 0; i < 5; i++) {
        await kg.createEntity(testUserId, 'person', `Person ${i}`);
      }

      const results = await kg.searchEntities(testUserId, 'person', undefined, 2);
      expect(results.length).toBe(2);
    });

    it('should only search user\'s own entities', async () => {
      await kg.createEntity(testUserId, 'person', 'User 1 Person');
      await kg.createEntity(testUserId2, 'person', 'User 2 Person');

      const results = await kg.searchEntities(testUserId2, 'person');

      expect(results.length).toBe(1);
      expect(results[0].name).toBe('User 2 Person');
    });
  });

  // ===========================================================================
  // getEntityWithRelations() tests
  // ===========================================================================

  describe('getEntityWithRelations()', () => {
    it('should get entity with immediate relations', async () => {
      const alice = await kg.createEntity(testUserId, 'person', 'Alice');
      const bob = await kg.createEntity(testUserId, 'person', 'Bob');
      const acme = await kg.createEntity(testUserId, 'organization', 'Acme');

      await kg.createRelation(testUserId, alice.id, bob.id, 'knows');
      await kg.createRelation(testUserId, alice.id, acme.id, 'works_at');

      const result = await kg.getEntityWithRelations(testUserId, alice.id, 1);

      expect(result).toBeDefined();
      expect(result!.entity.id).toBe(alice.id);
      expect(result!.relations.length).toBe(2);
      expect(result!.relatedEntities.length).toBe(2);
    });

    it('should return null for non-existent entity', async () => {
      const result = await kg.getEntityWithRelations(
        testUserId,
        '00000000-0000-0000-0000-000000000000'
      );
      expect(result).toBeNull();
    });

    it('should traverse multiple depths', async () => {
      // Create a chain: Alice -> Bob -> Carol
      const alice = await kg.createEntity(testUserId, 'person', 'Alice');
      const bob = await kg.createEntity(testUserId, 'person', 'Bob');
      const carol = await kg.createEntity(testUserId, 'person', 'Carol');

      await kg.createRelation(testUserId, alice.id, bob.id, 'knows');
      await kg.createRelation(testUserId, bob.id, carol.id, 'knows');

      // Depth 1 should only get Bob
      const depth1 = await kg.getEntityWithRelations(testUserId, alice.id, 1);
      expect(depth1!.relatedEntities.length).toBe(1);
      expect(depth1!.relatedEntities[0].name).toBe('Bob');

      // Depth 2 should get Bob and Carol
      const depth2 = await kg.getEntityWithRelations(testUserId, alice.id, 2);
      expect(depth2!.relatedEntities.length).toBe(2);
      expect(depth2!.relations.length).toBe(2);
    });
  });

  // ===========================================================================
  // query() tests
  // ===========================================================================

  describe('query()', () => {
    it('should return entities with their relations', async () => {
      const alice = await kg.createEntity(testUserId, 'person', 'Alice');
      const acme = await kg.createEntity(testUserId, 'organization', 'Acme Corp');
      await kg.createRelation(testUserId, alice.id, acme.id, 'works_at');

      const results = await kg.query(testUserId, 'Alice');

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].entity).toBeDefined();
      expect(results[0].relations).toBeDefined();
    });
  });

  // ===========================================================================
  // updateEntity() tests
  // ===========================================================================

  describe('updateEntity()', () => {
    it('should merge properties with existing properties', async () => {
      const entity = await kg.createEntity(testUserId, 'person', 'Alice', {
        age: 30,
        city: 'NYC',
      });

      const updated = await kg.updateEntity(testUserId, entity.id, {
        age: 31,
        job: 'engineer',
      });

      expect(updated.properties).toEqual({
        age: 31,
        city: 'NYC',
        job: 'engineer',
      });
    });

    it('should throw error for non-existent entity', async () => {
      await expect(
        kg.updateEntity(testUserId, '00000000-0000-0000-0000-000000000000', {
          key: 'value',
        })
      ).rejects.toThrow(/not found/);
    });
  });

  // ===========================================================================
  // updateEntityWithReembed() tests
  // ===========================================================================

  describe('updateEntityWithReembed()', () => {
    it('should update entity and regenerate embedding', async () => {
      const entity = await kg.createEntity(testUserId, 'person', 'Alice');
      const originalEmbedding = entity.embedding;

      mockEmbedding.resetCallCount();

      const updated = await kg.updateEntityWithReembed(testUserId, entity.id, {
        name: 'Alice Smith',
      });

      expect(updated.name).toBe('Alice Smith');
      expect(mockEmbedding.getCallCount()).toBe(1); // Should re-embed
      expect(updated.embedding).not.toEqual(originalEmbedding);
    });
  });

  // ===========================================================================
  // deleteEntity() tests
  // ===========================================================================

  describe('deleteEntity()', () => {
    it('should delete an entity', async () => {
      const entity = await kg.createEntity(testUserId, 'person', 'Alice');

      await kg.deleteEntity(testUserId, entity.id);

      const found = await kg.getEntity(testUserId, entity.id);
      expect(found).toBeNull();
    });

    it('should cascade delete relations', async () => {
      const alice = await kg.createEntity(testUserId, 'person', 'Alice');
      const bob = await kg.createEntity(testUserId, 'person', 'Bob');
      const relation = await kg.createRelation(testUserId, alice.id, bob.id, 'knows');

      await kg.deleteEntity(testUserId, alice.id);

      // Relation should be deleted via FK cascade
      const foundRelation = await kg.getRelation(testUserId, relation.id);
      expect(foundRelation).toBeNull();
    });

    it('should throw error for non-existent entity', async () => {
      await expect(
        kg.deleteEntity(testUserId, '00000000-0000-0000-0000-000000000000')
      ).rejects.toThrow(/not found/);
    });
  });

  // ===========================================================================
  // deleteRelation() tests
  // ===========================================================================

  describe('deleteRelation()', () => {
    it('should delete a relation', async () => {
      const alice = await kg.createEntity(testUserId, 'person', 'Alice');
      const bob = await kg.createEntity(testUserId, 'person', 'Bob');
      const relation = await kg.createRelation(testUserId, alice.id, bob.id, 'knows');

      await kg.deleteRelation(testUserId, relation.id);

      const found = await kg.getRelation(testUserId, relation.id);
      expect(found).toBeNull();
    });

    it('should throw error for non-existent relation', async () => {
      await expect(
        kg.deleteRelation(testUserId, '00000000-0000-0000-0000-000000000000')
      ).rejects.toThrow(/not found/);
    });
  });

  // ===========================================================================
  // getCounts() tests
  // ===========================================================================

  describe('getCounts()', () => {
    it('should count entities and relations', async () => {
      const alice = await kg.createEntity(testUserId, 'person', 'Alice');
      const bob = await kg.createEntity(testUserId, 'person', 'Bob');
      await kg.createRelation(testUserId, alice.id, bob.id, 'knows');

      const counts = await kg.getCounts(testUserId);

      expect(counts.entities).toBe(2);
      expect(counts.relations).toBe(1);
    });
  });

  // ===========================================================================
  // deleteAll() tests
  // ===========================================================================

  describe('deleteAll()', () => {
    it('should delete all entities and relations for a user', async () => {
      const alice = await kg.createEntity(testUserId, 'person', 'Alice');
      const bob = await kg.createEntity(testUserId, 'person', 'Bob');
      await kg.createRelation(testUserId, alice.id, bob.id, 'knows');

      const counts = await kg.deleteAll(testUserId);

      expect(counts.entities).toBe(2);
      expect(counts.relations).toBe(1);

      const remaining = await kg.getCounts(testUserId);
      expect(remaining.entities).toBe(0);
      expect(remaining.relations).toBe(0);
    });

    it('should not affect other users\' data', async () => {
      await kg.createEntity(testUserId, 'person', 'User 1 Person');
      await kg.createEntity(testUserId2, 'person', 'User 2 Person');

      await kg.deleteAll(testUserId);

      const user2Counts = await kg.getCounts(testUserId2);
      expect(user2Counts.entities).toBe(1);
    });
  });

  // ===========================================================================
  // getEntitiesByType() tests
  // ===========================================================================

  describe('getEntitiesByType()', () => {
    it('should get entities by type', async () => {
      await kg.createEntity(testUserId, 'person', 'Alice');
      await kg.createEntity(testUserId, 'person', 'Bob');
      await kg.createEntity(testUserId, 'organization', 'Acme');

      const people = await kg.getEntitiesByType(testUserId, 'person');

      expect(people.length).toBe(2);
      expect(people.every((e) => e.type === 'person')).toBe(true);
    });
  });

  // ===========================================================================
  // getRelations() tests
  // ===========================================================================

  describe('getRelations()', () => {
    it('should get all relations for an entity', async () => {
      const alice = await kg.createEntity(testUserId, 'person', 'Alice');
      const bob = await kg.createEntity(testUserId, 'person', 'Bob');
      const acme = await kg.createEntity(testUserId, 'organization', 'Acme');

      await kg.createRelation(testUserId, alice.id, bob.id, 'knows');
      await kg.createRelation(testUserId, alice.id, acme.id, 'works_at');

      const relations = await kg.getRelations(testUserId, alice.id);

      expect(relations.length).toBe(2);
    });
  });
});
