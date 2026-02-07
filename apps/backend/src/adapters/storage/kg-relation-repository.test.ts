// =============================================================================
// KG Relation Repository - Integration Tests
// =============================================================================
// Tests run against the real database to verify relation queries work correctly.

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { db, queryClient } from '../../infrastructure/db/client.js';
import { kgRelations, kgEntities, users } from '../../infrastructure/db/schema.js';
import { KGRelationRepository } from './kg-relation-repository.js';
import { KGEntityRepository } from './kg-entity-repository.js';
import { UserRepository } from './user-repository.js';

describe('KGRelationRepository Integration', () => {
  let repo: KGRelationRepository;
  let entityRepo: KGEntityRepository;
  let userRepo: UserRepository;
  let testUserId: string;
  let testUserId2: string;

  // Test entities
  let entityAlice: { id: string };
  let entityBob: { id: string };
  let entityAcme: { id: string };
  let entityNYC: { id: string };

  beforeAll(async () => {
    repo = new KGRelationRepository();
    entityRepo = new KGEntityRepository();
    userRepo = new UserRepository();

    const user = await userRepo.create({
      email: `kg-relation-test-${Date.now()}@example.com`,
      passwordHash: 'test-hash',
      displayName: 'KG Relation Test User',
    });
    testUserId = user.id;

    const user2 = await userRepo.create({
      email: `kg-relation-test-2-${Date.now()}@example.com`,
      passwordHash: 'test-hash',
      displayName: 'KG Relation Test User 2',
    });
    testUserId2 = user2.id;
  });

  beforeEach(async () => {
    // Create test entities for each test
    entityAlice = await entityRepo.create({
      userId: testUserId,
      type: 'person',
      name: 'Alice',
    });
    entityBob = await entityRepo.create({
      userId: testUserId,
      type: 'person',
      name: 'Bob',
    });
    entityAcme = await entityRepo.create({
      userId: testUserId,
      type: 'organization',
      name: 'Acme Corp',
    });
    entityNYC = await entityRepo.create({
      userId: testUserId,
      type: 'place',
      name: 'New York City',
    });
  });

  afterEach(async () => {
    // Clean up relations first (due to FK constraints)
    await db.delete(kgRelations).where(sql`user_id = ${testUserId}`);
    await db.delete(kgRelations).where(sql`user_id = ${testUserId2}`);
    // Then clean up entities
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
    it('should create a relation between entities', async () => {
      const relation = await repo.create({
        userId: testUserId,
        sourceId: entityAlice.id,
        targetId: entityBob.id,
        type: 'knows',
      });

      expect(relation).toBeDefined();
      expect(relation.id).toBeDefined();
      expect(relation.userId).toBe(testUserId);
      expect(relation.sourceId).toBe(entityAlice.id);
      expect(relation.targetId).toBe(entityBob.id);
      expect(relation.type).toBe('knows');
      expect(relation.properties).toEqual({});
      expect(relation.createdAt).toBeInstanceOf(Date);
    });

    it('should create a relation with properties', async () => {
      const relation = await repo.create({
        userId: testUserId,
        sourceId: entityAlice.id,
        targetId: entityAcme.id,
        type: 'works_at',
        properties: { role: 'engineer', since: 2020 },
      });

      expect(relation.properties).toEqual({ role: 'engineer', since: 2020 });
    });
  });

  // ===========================================================================
  // findById() tests
  // ===========================================================================

  describe('findById()', () => {
    it('should find a relation by ID', async () => {
      const created = await repo.create({
        userId: testUserId,
        sourceId: entityAlice.id,
        targetId: entityBob.id,
        type: 'knows',
      });

      const found = await repo.findById(testUserId, created.id);

      expect(found).toBeDefined();
      expect(found!.id).toBe(created.id);
      expect(found!.type).toBe('knows');
    });

    it('should return null for non-existent ID', async () => {
      const found = await repo.findById(testUserId, '00000000-0000-0000-0000-000000000000');
      expect(found).toBeNull();
    });

    it('should not find relation belonging to different user', async () => {
      const created = await repo.create({
        userId: testUserId,
        sourceId: entityAlice.id,
        targetId: entityBob.id,
        type: 'knows',
      });

      const found = await repo.findById(testUserId2, created.id);
      expect(found).toBeNull();
    });
  });

  // ===========================================================================
  // findByIdWithEntities() tests
  // ===========================================================================

  describe('findByIdWithEntities()', () => {
    it('should find a relation with entity details', async () => {
      const created = await repo.create({
        userId: testUserId,
        sourceId: entityAlice.id,
        targetId: entityAcme.id,
        type: 'works_at',
      });

      const found = await repo.findByIdWithEntities(testUserId, created.id);

      expect(found).toBeDefined();
      expect(found!.source.name).toBe('Alice');
      expect(found!.source.type).toBe('person');
      expect(found!.target.name).toBe('Acme Corp');
      expect(found!.target.type).toBe('organization');
    });
  });

  // ===========================================================================
  // findBySource() tests
  // ===========================================================================

  describe('findBySource()', () => {
    it('should find outgoing relations from an entity', async () => {
      await repo.create({
        userId: testUserId,
        sourceId: entityAlice.id,
        targetId: entityBob.id,
        type: 'knows',
      });
      await repo.create({
        userId: testUserId,
        sourceId: entityAlice.id,
        targetId: entityAcme.id,
        type: 'works_at',
      });
      await repo.create({
        userId: testUserId,
        sourceId: entityBob.id,
        targetId: entityAlice.id,
        type: 'knows',
      });

      const relations = await repo.findBySource(testUserId, entityAlice.id);

      expect(relations.length).toBe(2);
      expect(relations.every((r) => r.sourceId === entityAlice.id)).toBe(true);
    });
  });

  // ===========================================================================
  // findByTarget() tests
  // ===========================================================================

  describe('findByTarget()', () => {
    it('should find incoming relations to an entity', async () => {
      await repo.create({
        userId: testUserId,
        sourceId: entityAlice.id,
        targetId: entityBob.id,
        type: 'knows',
      });
      await repo.create({
        userId: testUserId,
        sourceId: entityAcme.id,
        targetId: entityBob.id,
        type: 'employs',
      });

      const relations = await repo.findByTarget(testUserId, entityBob.id);

      expect(relations.length).toBe(2);
      expect(relations.every((r) => r.targetId === entityBob.id)).toBe(true);
    });
  });

  // ===========================================================================
  // findByEntity() tests
  // ===========================================================================

  describe('findByEntity()', () => {
    it('should find all relations involving an entity', async () => {
      await repo.create({
        userId: testUserId,
        sourceId: entityAlice.id,
        targetId: entityBob.id,
        type: 'knows',
      });
      await repo.create({
        userId: testUserId,
        sourceId: entityBob.id,
        targetId: entityAlice.id,
        type: 'knows',
      });
      await repo.create({
        userId: testUserId,
        sourceId: entityBob.id,
        targetId: entityAcme.id,
        type: 'works_at',
      });

      const relations = await repo.findByEntity(testUserId, entityAlice.id);

      expect(relations.length).toBe(2);
    });
  });

  // ===========================================================================
  // findByEntityWithEntities() tests
  // ===========================================================================

  describe('findByEntityWithEntities()', () => {
    it('should find all relations with entity details', async () => {
      await repo.create({
        userId: testUserId,
        sourceId: entityAlice.id,
        targetId: entityAcme.id,
        type: 'works_at',
      });
      await repo.create({
        userId: testUserId,
        sourceId: entityBob.id,
        targetId: entityAlice.id,
        type: 'knows',
      });

      const relations = await repo.findByEntityWithEntities(testUserId, entityAlice.id);

      expect(relations.length).toBe(2);
      expect(relations[0].source).toBeDefined();
      expect(relations[0].target).toBeDefined();
    });
  });

  // ===========================================================================
  // findByType() tests
  // ===========================================================================

  describe('findByType()', () => {
    it('should find relations by type', async () => {
      await repo.create({
        userId: testUserId,
        sourceId: entityAlice.id,
        targetId: entityBob.id,
        type: 'knows',
      });
      await repo.create({
        userId: testUserId,
        sourceId: entityBob.id,
        targetId: entityAlice.id,
        type: 'knows',
      });
      await repo.create({
        userId: testUserId,
        sourceId: entityAlice.id,
        targetId: entityAcme.id,
        type: 'works_at',
      });

      const knowsRelations = await repo.findByType(testUserId, 'knows');
      const worksAtRelations = await repo.findByType(testUserId, 'works_at');

      expect(knowsRelations.length).toBe(2);
      expect(worksAtRelations.length).toBe(1);
    });
  });

  // ===========================================================================
  // findBetween() tests
  // ===========================================================================

  describe('findBetween()', () => {
    it('should find relations between two specific entities', async () => {
      await repo.create({
        userId: testUserId,
        sourceId: entityAlice.id,
        targetId: entityBob.id,
        type: 'knows',
      });
      await repo.create({
        userId: testUserId,
        sourceId: entityAlice.id,
        targetId: entityBob.id,
        type: 'mentors',
      });

      const relations = await repo.findBetween(testUserId, entityAlice.id, entityBob.id);

      expect(relations.length).toBe(2);
    });

    it('should filter by type when specified', async () => {
      await repo.create({
        userId: testUserId,
        sourceId: entityAlice.id,
        targetId: entityBob.id,
        type: 'knows',
      });
      await repo.create({
        userId: testUserId,
        sourceId: entityAlice.id,
        targetId: entityBob.id,
        type: 'mentors',
      });

      const relations = await repo.findBetween(
        testUserId,
        entityAlice.id,
        entityBob.id,
        'knows'
      );

      expect(relations.length).toBe(1);
      expect(relations[0].type).toBe('knows');
    });
  });

  // ===========================================================================
  // update() tests
  // ===========================================================================

  describe('update()', () => {
    it('should update relation type', async () => {
      const created = await repo.create({
        userId: testUserId,
        sourceId: entityAlice.id,
        targetId: entityBob.id,
        type: 'knows',
      });

      const updated = await repo.update(testUserId, created.id, {
        type: 'friends_with',
      });

      expect(updated!.type).toBe('friends_with');
    });

    it('should update relation properties', async () => {
      const created = await repo.create({
        userId: testUserId,
        sourceId: entityAlice.id,
        targetId: entityBob.id,
        type: 'knows',
        properties: { since: 2020 },
      });

      const updated = await repo.update(testUserId, created.id, {
        properties: { since: 2018, context: 'work' },
      });

      expect(updated!.properties).toEqual({ since: 2018, context: 'work' });
    });

    it('should return null for non-existent relation', async () => {
      const updated = await repo.update(testUserId, '00000000-0000-0000-0000-000000000000', {
        type: 'new_type',
      });
      expect(updated).toBeNull();
    });
  });

  // ===========================================================================
  // mergeProperties() tests
  // ===========================================================================

  describe('mergeProperties()', () => {
    it('should merge properties with existing properties', async () => {
      const created = await repo.create({
        userId: testUserId,
        sourceId: entityAlice.id,
        targetId: entityBob.id,
        type: 'knows',
        properties: { since: 2020, context: 'school' },
      });

      const updated = await repo.mergeProperties(testUserId, created.id, {
        since: 2018,
        strength: 'strong',
      });

      expect(updated!.properties).toEqual({
        since: 2018,
        context: 'school',
        strength: 'strong',
      });
    });
  });

  // ===========================================================================
  // delete() tests
  // ===========================================================================

  describe('delete()', () => {
    it('should delete a relation', async () => {
      const created = await repo.create({
        userId: testUserId,
        sourceId: entityAlice.id,
        targetId: entityBob.id,
        type: 'knows',
      });

      const deleted = await repo.delete(testUserId, created.id);
      expect(deleted).toBe(true);

      const found = await repo.findById(testUserId, created.id);
      expect(found).toBeNull();
    });

    it('should return false for non-existent relation', async () => {
      const deleted = await repo.delete(testUserId, '00000000-0000-0000-0000-000000000000');
      expect(deleted).toBe(false);
    });

    it('should not delete relation belonging to different user', async () => {
      const created = await repo.create({
        userId: testUserId,
        sourceId: entityAlice.id,
        targetId: entityBob.id,
        type: 'knows',
      });

      const deleted = await repo.delete(testUserId2, created.id);
      expect(deleted).toBe(false);

      const found = await repo.findById(testUserId, created.id);
      expect(found).toBeDefined();
    });
  });

  // ===========================================================================
  // deleteByEntity() tests
  // ===========================================================================

  describe('deleteByEntity()', () => {
    it('should delete all relations for an entity', async () => {
      await repo.create({
        userId: testUserId,
        sourceId: entityAlice.id,
        targetId: entityBob.id,
        type: 'knows',
      });
      await repo.create({
        userId: testUserId,
        sourceId: entityBob.id,
        targetId: entityAlice.id,
        type: 'knows',
      });
      await repo.create({
        userId: testUserId,
        sourceId: entityBob.id,
        targetId: entityAcme.id,
        type: 'works_at',
      });

      const count = await repo.deleteByEntity(testUserId, entityAlice.id);
      expect(count).toBe(2);

      // Bob -> Acme should still exist
      const remaining = await repo.findByUser(testUserId);
      expect(remaining.length).toBe(1);
    });
  });

  // ===========================================================================
  // deleteByUser() tests
  // ===========================================================================

  describe('deleteByUser()', () => {
    it('should delete all relations for a user', async () => {
      await repo.create({
        userId: testUserId,
        sourceId: entityAlice.id,
        targetId: entityBob.id,
        type: 'knows',
      });
      await repo.create({
        userId: testUserId,
        sourceId: entityAlice.id,
        targetId: entityAcme.id,
        type: 'works_at',
      });

      const count = await repo.deleteByUser(testUserId);
      expect(count).toBe(2);

      const remaining = await repo.findByUser(testUserId);
      expect(remaining.length).toBe(0);
    });
  });

  // ===========================================================================
  // countByUser() tests
  // ===========================================================================

  describe('countByUser()', () => {
    it('should count relations for a user', async () => {
      await repo.create({
        userId: testUserId,
        sourceId: entityAlice.id,
        targetId: entityBob.id,
        type: 'knows',
      });
      await repo.create({
        userId: testUserId,
        sourceId: entityAlice.id,
        targetId: entityAcme.id,
        type: 'works_at',
      });

      const count = await repo.countByUser(testUserId);
      expect(count).toBe(2);
    });

    it('should count by type when specified', async () => {
      await repo.create({
        userId: testUserId,
        sourceId: entityAlice.id,
        targetId: entityBob.id,
        type: 'knows',
      });
      await repo.create({
        userId: testUserId,
        sourceId: entityBob.id,
        targetId: entityAlice.id,
        type: 'knows',
      });
      await repo.create({
        userId: testUserId,
        sourceId: entityAlice.id,
        targetId: entityAcme.id,
        type: 'works_at',
      });

      const knowsCount = await repo.countByUser(testUserId, 'knows');
      expect(knowsCount).toBe(2);
    });
  });

  // ===========================================================================
  // countByEntity() tests
  // ===========================================================================

  describe('countByEntity()', () => {
    it('should count relations for an entity', async () => {
      await repo.create({
        userId: testUserId,
        sourceId: entityAlice.id,
        targetId: entityBob.id,
        type: 'knows',
      });
      await repo.create({
        userId: testUserId,
        sourceId: entityBob.id,
        targetId: entityAlice.id,
        type: 'knows',
      });

      const count = await repo.countByEntity(testUserId, entityAlice.id);
      expect(count).toBe(2);
    });
  });

  // ===========================================================================
  // getRelatedEntityIds() tests
  // ===========================================================================

  describe('getRelatedEntityIds()', () => {
    it('should get outgoing related entity IDs', async () => {
      await repo.create({
        userId: testUserId,
        sourceId: entityAlice.id,
        targetId: entityBob.id,
        type: 'knows',
      });
      await repo.create({
        userId: testUserId,
        sourceId: entityAlice.id,
        targetId: entityAcme.id,
        type: 'works_at',
      });

      const ids = await repo.getRelatedEntityIds(testUserId, entityAlice.id, 'outgoing');

      expect(ids.length).toBe(2);
      expect(ids).toContain(entityBob.id);
      expect(ids).toContain(entityAcme.id);
    });

    it('should get incoming related entity IDs', async () => {
      await repo.create({
        userId: testUserId,
        sourceId: entityAlice.id,
        targetId: entityBob.id,
        type: 'knows',
      });
      await repo.create({
        userId: testUserId,
        sourceId: entityAcme.id,
        targetId: entityBob.id,
        type: 'employs',
      });

      const ids = await repo.getRelatedEntityIds(testUserId, entityBob.id, 'incoming');

      expect(ids.length).toBe(2);
      expect(ids).toContain(entityAlice.id);
      expect(ids).toContain(entityAcme.id);
    });

    it('should get both directions', async () => {
      await repo.create({
        userId: testUserId,
        sourceId: entityAlice.id,
        targetId: entityBob.id,
        type: 'knows',
      });
      await repo.create({
        userId: testUserId,
        sourceId: entityAcme.id,
        targetId: entityAlice.id,
        type: 'employs',
      });

      const ids = await repo.getRelatedEntityIds(testUserId, entityAlice.id, 'both');

      expect(ids.length).toBe(2);
      expect(ids).toContain(entityBob.id);
      expect(ids).toContain(entityAcme.id);
    });
  });
});
