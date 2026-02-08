// =============================================================================
// Agent Run Repository - Integration Tests
// =============================================================================
// Tests run against the real database to verify SQL queries work correctly.

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { db, queryClient } from '../../infrastructure/db/client.js';
import { agentRuns, users } from '../../infrastructure/db/schema.js';
import { AgentRunRepository } from './agent-run-repository.js';
import { UserRepository } from './user-repository.js';

describe('AgentRunRepository Integration', () => {
  let repo: AgentRunRepository;
  let userRepo: UserRepository;
  let testUserId: string;
  const testRunIds: string[] = [];

  beforeAll(async () => {
    repo = new AgentRunRepository();
    userRepo = new UserRepository();

    // Create a test user for agent runs
    const user = await userRepo.create({
      email: `agent-run-test-${Date.now()}@example.com`,
      passwordHash: 'test-hash',
      displayName: 'Agent Run Test User',
    });
    testUserId = user.id;
  });

  afterEach(async () => {
    // Clean up test runs
    for (const runId of testRunIds) {
      await db.delete(agentRuns).where(sql`id = ${runId}`);
    }
    testRunIds.length = 0;
  });

  afterAll(async () => {
    // Clean up test user (cascades to runs)
    await db.delete(users).where(sql`id = ${testUserId}`);
    await queryClient.end();
  });

  // ===========================================================================
  // create() tests
  // ===========================================================================

  describe('create()', () => {
    it('should create a new agent run with pending status', async () => {
      const run = await repo.create(testUserId);
      testRunIds.push(run.id);

      expect(run).toBeDefined();
      expect(run.id).toBeDefined();
      expect(run.userId).toBe(testUserId);
      expect(run.status).toBe('pending');
      expect(run.totalTokens).toBe(0);
      expect(run.totalCost).toBe(0);
      expect(run.startedAt).toBeInstanceOf(Date);
      expect(run.completedAt).toBeNull();
    });

    it('should create multiple runs for the same user', async () => {
      const run1 = await repo.create(testUserId);
      const run2 = await repo.create(testUserId);
      testRunIds.push(run1.id, run2.id);

      expect(run1.id).not.toBe(run2.id);
      expect(run1.userId).toBe(run2.userId);
    });
  });

  // ===========================================================================
  // findById() tests
  // ===========================================================================

  describe('findById()', () => {
    it('should find a run by ID', async () => {
      const created = await repo.create(testUserId);
      testRunIds.push(created.id);

      const found = await repo.findById(created.id);

      expect(found).toBeDefined();
      expect(found!.id).toBe(created.id);
      expect(found!.userId).toBe(testUserId);
    });

    it('should return null for non-existent ID', async () => {
      const found = await repo.findById('00000000-0000-0000-0000-000000000000');
      expect(found).toBeNull();
    });
  });

  // ===========================================================================
  // findByIdAndUser() tests
  // ===========================================================================

  describe('findByIdAndUser()', () => {
    it('should find a run by ID and user', async () => {
      const created = await repo.create(testUserId);
      testRunIds.push(created.id);

      const found = await repo.findByIdAndUser(created.id, testUserId);

      expect(found).toBeDefined();
      expect(found!.id).toBe(created.id);
    });

    it('should return null if user does not own the run', async () => {
      const created = await repo.create(testUserId);
      testRunIds.push(created.id);

      const found = await repo.findByIdAndUser(created.id, '00000000-0000-0000-0000-000000000000');
      expect(found).toBeNull();
    });
  });

  // ===========================================================================
  // findByUser() tests
  // ===========================================================================

  describe('findByUser()', () => {
    it('should list runs for a user', async () => {
      const run1 = await repo.create(testUserId);
      const run2 = await repo.create(testUserId);
      testRunIds.push(run1.id, run2.id);

      const runs = await repo.findByUser(testUserId);

      expect(runs.length).toBeGreaterThanOrEqual(2);
      // Most recent first
      expect(runs[0].startedAt.getTime()).toBeGreaterThanOrEqual(runs[1].startedAt.getTime());
    });

    it('should respect limit and offset', async () => {
      // Create 5 runs
      for (let i = 0; i < 5; i++) {
        const run = await repo.create(testUserId);
        testRunIds.push(run.id);
      }

      const page1 = await repo.findByUser(testUserId, { limit: 2, offset: 0 });
      const page2 = await repo.findByUser(testUserId, { limit: 2, offset: 2 });

      expect(page1.length).toBe(2);
      expect(page2.length).toBe(2);
      expect(page1[0].id).not.toBe(page2[0].id);
    });

    it('should filter by status', async () => {
      const run1 = await repo.create(testUserId);
      const run2 = await repo.create(testUserId);
      testRunIds.push(run1.id, run2.id);

      await repo.updateStatus(run1.id, { status: 'running' });

      const runningRuns = await repo.findByUser(testUserId, { status: 'running' });
      expect(runningRuns.some(r => r.id === run1.id)).toBe(true);
      expect(runningRuns.some(r => r.id === run2.id)).toBe(false);
    });
  });

  // ===========================================================================
  // updateStatus() tests
  // ===========================================================================

  describe('updateStatus()', () => {
    it('should update status to running', async () => {
      const created = await repo.create(testUserId);
      testRunIds.push(created.id);

      const updated = await repo.updateStatus(created.id, { status: 'running' });

      expect(updated!.status).toBe('running');
      expect(updated!.completedAt).toBeNull();
    });

    it('should set completedAt for terminal statuses', async () => {
      const created = await repo.create(testUserId);
      testRunIds.push(created.id);

      const updated = await repo.updateStatus(created.id, { status: 'completed' });

      expect(updated!.status).toBe('completed');
      expect(updated!.completedAt).toBeInstanceOf(Date);
    });

    it('should update tokens and cost', async () => {
      const created = await repo.create(testUserId);
      testRunIds.push(created.id);

      const updated = await repo.updateStatus(created.id, {
        status: 'completed',
        totalTokens: 1000,
        totalCost: 0.05,
      });

      expect(updated!.totalTokens).toBe(1000);
      expect(updated!.totalCost).toBeCloseTo(0.05);
    });

    it('should return null for non-existent run', async () => {
      const updated = await repo.updateStatus('00000000-0000-0000-0000-000000000000', {
        status: 'running',
      });
      expect(updated).toBeNull();
    });
  });

  // ===========================================================================
  // incrementUsage() tests
  // ===========================================================================

  describe('incrementUsage()', () => {
    it('should increment tokens and cost atomically', async () => {
      const created = await repo.create(testUserId);
      testRunIds.push(created.id);

      await repo.incrementUsage(created.id, 100, 0.01);
      await repo.incrementUsage(created.id, 200, 0.02);

      const found = await repo.findById(created.id);
      expect(found!.totalTokens).toBe(300);
      expect(found!.totalCost).toBeCloseTo(0.03);
    });
  });

  // ===========================================================================
  // countByUser() tests
  // ===========================================================================

  describe('countByUser()', () => {
    it('should count runs for a user', async () => {
      const initialCount = await repo.countByUser(testUserId);

      const run1 = await repo.create(testUserId);
      const run2 = await repo.create(testUserId);
      testRunIds.push(run1.id, run2.id);

      const newCount = await repo.countByUser(testUserId);
      expect(newCount).toBe(initialCount + 2);
    });
  });

  // ===========================================================================
  // countActiveByUser() tests
  // ===========================================================================

  describe('countActiveByUser()', () => {
    it('should count only pending and running runs', async () => {
      const run1 = await repo.create(testUserId);
      const run2 = await repo.create(testUserId);
      const run3 = await repo.create(testUserId);
      testRunIds.push(run1.id, run2.id, run3.id);

      await repo.updateStatus(run1.id, { status: 'running' });
      await repo.updateStatus(run2.id, { status: 'completed' });
      // run3 remains pending

      const activeCount = await repo.countActiveByUser(testUserId);
      expect(activeCount).toBeGreaterThanOrEqual(2); // run1 (running) + run3 (pending)
    });
  });

  // ===========================================================================
  // delete() tests
  // ===========================================================================

  describe('delete()', () => {
    it('should delete a run', async () => {
      const created = await repo.create(testUserId);
      // Don't add to testRunIds since we're deleting

      const deleted = await repo.delete(created.id);
      expect(deleted).toBe(true);

      const found = await repo.findById(created.id);
      expect(found).toBeNull();
    });

    it('should return false for non-existent run', async () => {
      const deleted = await repo.delete('00000000-0000-0000-0000-000000000000');
      expect(deleted).toBe(false);
    });
  });

  // ===========================================================================
  // cancelAllActive() tests
  // ===========================================================================

  describe('cancelAllActive()', () => {
    it('should cancel all pending and running runs', async () => {
      const run1 = await repo.create(testUserId);
      const run2 = await repo.create(testUserId);
      const run3 = await repo.create(testUserId);
      testRunIds.push(run1.id, run2.id, run3.id);

      await repo.updateStatus(run1.id, { status: 'running' });
      await repo.updateStatus(run2.id, { status: 'completed' });
      // run3 remains pending

      const cancelledCount = await repo.cancelAllActive(testUserId);
      expect(cancelledCount).toBeGreaterThanOrEqual(2);

      const found1 = await repo.findById(run1.id);
      const found2 = await repo.findById(run2.id);
      const found3 = await repo.findById(run3.id);

      expect(found1!.status).toBe('cancelled');
      expect(found2!.status).toBe('completed'); // Should not be changed
      expect(found3!.status).toBe('cancelled');
    });
  });
});
