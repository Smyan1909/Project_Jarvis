// =============================================================================
// Tool Call Repository - Integration Tests
// =============================================================================
// Tests run against the real database to verify SQL queries work correctly.

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { db, queryClient } from '../../infrastructure/db/client.js';
import { agentRuns, users, toolCalls } from '../../infrastructure/db/schema.js';
import { ToolCallRepository } from './tool-call-repository.js';
import { AgentRunRepository } from './agent-run-repository.js';
import { UserRepository } from './user-repository.js';

describe('ToolCallRepository Integration', () => {
  let repo: ToolCallRepository;
  let runRepo: AgentRunRepository;
  let userRepo: UserRepository;
  let testUserId: string;
  let testRunId: string;

  beforeAll(async () => {
    repo = new ToolCallRepository();
    runRepo = new AgentRunRepository();
    userRepo = new UserRepository();

    // Create a test user
    const user = await userRepo.create({
      email: `tool-call-test-${Date.now()}@example.com`,
      passwordHash: 'test-hash',
      displayName: 'Tool Call Test User',
    });
    testUserId = user.id;

    // Create a test run
    const run = await runRepo.create(testUserId);
    testRunId = run.id;
  });

  afterEach(async () => {
    // Clean up tool calls from test run
    await db.delete(toolCalls).where(sql`run_id = ${testRunId}`);
  });

  afterAll(async () => {
    // Clean up test user (cascades to runs and tool calls)
    await db.delete(users).where(sql`id = ${testUserId}`);
    await queryClient.end();
  });

  // ===========================================================================
  // create() tests
  // ===========================================================================

  describe('create()', () => {
    it('should create a new tool call with pending status', async () => {
      const toolCall = await repo.create({
        runId: testRunId,
        toolId: 'web_search',
        input: { query: 'What is TypeScript?' },
      });

      expect(toolCall).toBeDefined();
      expect(toolCall.id).toBeDefined();
      expect(toolCall.runId).toBe(testRunId);
      expect(toolCall.toolId).toBe('web_search');
      expect(toolCall.input).toEqual({ query: 'What is TypeScript?' });
      expect(toolCall.output).toBeNull();
      expect(toolCall.status).toBe('pending');
      expect(toolCall.durationMs).toBeNull();
      expect(toolCall.createdAt).toBeInstanceOf(Date);
    });

    it('should create tool calls with complex input', async () => {
      const toolCall = await repo.create({
        runId: testRunId,
        toolId: 'file_write',
        input: {
          path: '/tmp/test.txt',
          content: 'Hello, world!',
          options: {
            overwrite: true,
            encoding: 'utf-8',
          },
        },
      });

      expect(toolCall.input).toEqual({
        path: '/tmp/test.txt',
        content: 'Hello, world!',
        options: {
          overwrite: true,
          encoding: 'utf-8',
        },
      });
    });
  });

  // ===========================================================================
  // findById() tests
  // ===========================================================================

  describe('findById()', () => {
    it('should find a tool call by ID', async () => {
      const created = await repo.create({
        runId: testRunId,
        toolId: 'calculator',
        input: { expression: '2 + 2' },
      });

      const found = await repo.findById(created.id);

      expect(found).toBeDefined();
      expect(found!.id).toBe(created.id);
      expect(found!.toolId).toBe('calculator');
    });

    it('should return null for non-existent ID', async () => {
      const found = await repo.findById('00000000-0000-0000-0000-000000000000');
      expect(found).toBeNull();
    });
  });

  // ===========================================================================
  // findByRun() tests
  // ===========================================================================

  describe('findByRun()', () => {
    it('should find all tool calls for a run in chronological order', async () => {
      await repo.create({ runId: testRunId, toolId: 'tool_1', input: { n: 1 } });
      await repo.create({ runId: testRunId, toolId: 'tool_2', input: { n: 2 } });
      await repo.create({ runId: testRunId, toolId: 'tool_3', input: { n: 3 } });

      const found = await repo.findByRun(testRunId);

      expect(found.length).toBe(3);
      expect(found[0].toolId).toBe('tool_1');
      expect(found[1].toolId).toBe('tool_2');
      expect(found[2].toolId).toBe('tool_3');
    });
  });

  // ===========================================================================
  // findByRunAndStatus() tests
  // ===========================================================================

  describe('findByRunAndStatus()', () => {
    it('should filter tool calls by status', async () => {
      const tc1 = await repo.create({ runId: testRunId, toolId: 'tool_1', input: {} });
      const tc2 = await repo.create({ runId: testRunId, toolId: 'tool_2', input: {} });
      const tc3 = await repo.create({ runId: testRunId, toolId: 'tool_3', input: {} });

      await repo.complete(tc1.id, { output: { result: 'ok' }, durationMs: 100 });
      await repo.fail(tc2.id, { error: 'failed', durationMs: 50 });
      // tc3 remains pending

      const pending = await repo.findByRunAndStatus(testRunId, 'pending');
      const success = await repo.findByRunAndStatus(testRunId, 'success');
      const error = await repo.findByRunAndStatus(testRunId, 'error');

      expect(pending.length).toBe(1);
      expect(success.length).toBe(1);
      expect(error.length).toBe(1);
    });
  });

  // ===========================================================================
  // findPendingByRun() tests
  // ===========================================================================

  describe('findPendingByRun()', () => {
    it('should find only pending tool calls', async () => {
      const tc1 = await repo.create({ runId: testRunId, toolId: 'tool_1', input: {} });
      const tc2 = await repo.create({ runId: testRunId, toolId: 'tool_2', input: {} });

      await repo.complete(tc1.id, { output: { result: 'done' }, durationMs: 100 });

      const pending = await repo.findPendingByRun(testRunId);

      expect(pending.length).toBe(1);
      expect(pending[0].id).toBe(tc2.id);
    });
  });

  // ===========================================================================
  // complete() tests
  // ===========================================================================

  describe('complete()', () => {
    it('should mark a tool call as successful', async () => {
      const created = await repo.create({
        runId: testRunId,
        toolId: 'web_search',
        input: { query: 'test' },
      });

      const completed = await repo.complete(created.id, {
        output: { results: ['result1', 'result2'] },
        durationMs: 150,
      });

      expect(completed!.status).toBe('success');
      expect(completed!.output).toEqual({ results: ['result1', 'result2'] });
      expect(completed!.durationMs).toBe(150);
    });

    it('should return null for non-existent tool call', async () => {
      const result = await repo.complete('00000000-0000-0000-0000-000000000000', {
        output: {},
        durationMs: 0,
      });
      expect(result).toBeNull();
    });
  });

  // ===========================================================================
  // fail() tests
  // ===========================================================================

  describe('fail()', () => {
    it('should mark a tool call as failed', async () => {
      const created = await repo.create({
        runId: testRunId,
        toolId: 'api_call',
        input: { url: 'https://api.example.com' },
      });

      const failed = await repo.fail(created.id, {
        error: 'Connection timeout',
        durationMs: 5000,
      });

      expect(failed!.status).toBe('error');
      expect(failed!.output).toEqual({ error: 'Connection timeout' });
      expect(failed!.durationMs).toBe(5000);
    });
  });

  // ===========================================================================
  // countByRun() tests
  // ===========================================================================

  describe('countByRun()', () => {
    it('should count tool calls in a run', async () => {
      await repo.create({ runId: testRunId, toolId: 'tool_1', input: {} });
      await repo.create({ runId: testRunId, toolId: 'tool_2', input: {} });
      await repo.create({ runId: testRunId, toolId: 'tool_3', input: {} });

      const count = await repo.countByRun(testRunId);
      expect(count).toBe(3);
    });
  });

  // ===========================================================================
  // countByRunAndStatus() tests
  // ===========================================================================

  describe('countByRunAndStatus()', () => {
    it('should count tool calls by status', async () => {
      const tc1 = await repo.create({ runId: testRunId, toolId: 'tool_1', input: {} });
      const tc2 = await repo.create({ runId: testRunId, toolId: 'tool_2', input: {} });
      await repo.create({ runId: testRunId, toolId: 'tool_3', input: {} });

      await repo.complete(tc1.id, { output: { result: 'ok' }, durationMs: 100 });
      await repo.fail(tc2.id, { error: 'err', durationMs: 50 });

      const successCount = await repo.countByRunAndStatus(testRunId, 'success');
      const errorCount = await repo.countByRunAndStatus(testRunId, 'error');
      const pendingCount = await repo.countByRunAndStatus(testRunId, 'pending');

      expect(successCount).toBe(1);
      expect(errorCount).toBe(1);
      expect(pendingCount).toBe(1);
    });
  });

  // ===========================================================================
  // getTotalDuration() tests
  // ===========================================================================

  describe('getTotalDuration()', () => {
    it('should sum duration of all tool calls', async () => {
      const tc1 = await repo.create({ runId: testRunId, toolId: 'tool_1', input: {} });
      const tc2 = await repo.create({ runId: testRunId, toolId: 'tool_2', input: {} });
      const tc3 = await repo.create({ runId: testRunId, toolId: 'tool_3', input: {} });

      await repo.complete(tc1.id, { output: { result: 'ok' }, durationMs: 100 });
      await repo.complete(tc2.id, { output: { result: 'ok' }, durationMs: 200 });
      await repo.fail(tc3.id, { error: 'err', durationMs: 50 });

      const totalDuration = await repo.getTotalDuration(testRunId);
      expect(totalDuration).toBe(350);
    });
  });

  // ===========================================================================
  // findByToolId() tests
  // ===========================================================================

  describe('findByToolId()', () => {
    it('should find tool calls by tool ID', async () => {
      await repo.create({ runId: testRunId, toolId: 'web_search', input: { q: '1' } });
      await repo.create({ runId: testRunId, toolId: 'calculator', input: { expr: '2+2' } });
      await repo.create({ runId: testRunId, toolId: 'web_search', input: { q: '2' } });

      const webSearchCalls = await repo.findByToolId(testRunId, 'web_search');

      expect(webSearchCalls.length).toBe(2);
      expect(webSearchCalls.every(tc => tc.toolId === 'web_search')).toBe(true);
    });
  });

  // ===========================================================================
  // delete() tests
  // ===========================================================================

  describe('delete()', () => {
    it('should delete a tool call', async () => {
      const created = await repo.create({
        runId: testRunId,
        toolId: 'to_delete',
        input: {},
      });

      const deleted = await repo.delete(created.id);
      expect(deleted).toBe(true);

      const found = await repo.findById(created.id);
      expect(found).toBeNull();
    });

    it('should return false for non-existent tool call', async () => {
      const deleted = await repo.delete('00000000-0000-0000-0000-000000000000');
      expect(deleted).toBe(false);
    });
  });

  // ===========================================================================
  // deleteByRun() tests
  // ===========================================================================

  describe('deleteByRun()', () => {
    it('should delete all tool calls for a run', async () => {
      await repo.create({ runId: testRunId, toolId: 'tool_1', input: {} });
      await repo.create({ runId: testRunId, toolId: 'tool_2', input: {} });
      await repo.create({ runId: testRunId, toolId: 'tool_3', input: {} });

      const deletedCount = await repo.deleteByRun(testRunId);
      expect(deletedCount).toBe(3);

      const remaining = await repo.findByRun(testRunId);
      expect(remaining.length).toBe(0);
    });
  });

  // ===========================================================================
  // getRunStats() tests
  // ===========================================================================

  describe('getRunStats()', () => {
    it('should return comprehensive run statistics', async () => {
      const tc1 = await repo.create({ runId: testRunId, toolId: 'tool_1', input: {} });
      const tc2 = await repo.create({ runId: testRunId, toolId: 'tool_2', input: {} });
      const tc3 = await repo.create({ runId: testRunId, toolId: 'tool_3', input: {} });
      await repo.create({ runId: testRunId, toolId: 'tool_4', input: {} }); // pending

      await repo.complete(tc1.id, { output: { result: 'ok' }, durationMs: 100 });
      await repo.complete(tc2.id, { output: { result: 'ok' }, durationMs: 150 });
      await repo.fail(tc3.id, { error: 'err', durationMs: 50 });

      const stats = await repo.getRunStats(testRunId);

      expect(stats.total).toBe(4);
      expect(stats.success).toBe(2);
      expect(stats.error).toBe(1);
      expect(stats.pending).toBe(1);
      expect(stats.totalDurationMs).toBe(300);
    });

    it('should return zero stats for empty run', async () => {
      // Create a new run with no tool calls
      const newRun = await runRepo.create(testUserId);
      const stats = await repo.getRunStats(newRun.id);

      expect(stats.total).toBe(0);
      expect(stats.success).toBe(0);
      expect(stats.error).toBe(0);
      expect(stats.pending).toBe(0);
      expect(stats.totalDurationMs).toBe(0);

      // Clean up
      await runRepo.delete(newRun.id);
    });
  });
});
