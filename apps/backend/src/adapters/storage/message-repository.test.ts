// =============================================================================
// Message Repository - Integration Tests
// =============================================================================
// Tests run against the real database to verify SQL queries work correctly.

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { db, queryClient } from '../../infrastructure/db/client.js';
import { agentRuns, users, messages } from '../../infrastructure/db/schema.js';
import { MessageRepository } from './message-repository.js';
import { AgentRunRepository } from './agent-run-repository.js';
import { UserRepository } from './user-repository.js';

describe('MessageRepository Integration', () => {
  let repo: MessageRepository;
  let runRepo: AgentRunRepository;
  let userRepo: UserRepository;
  let testUserId: string;
  let testRunId: string;

  beforeAll(async () => {
    repo = new MessageRepository();
    runRepo = new AgentRunRepository();
    userRepo = new UserRepository();

    // Create a test user
    const user = await userRepo.create({
      email: `message-test-${Date.now()}@example.com`,
      passwordHash: 'test-hash',
      displayName: 'Message Test User',
    });
    testUserId = user.id;

    // Create a test run
    const run = await runRepo.create(testUserId);
    testRunId = run.id;
  });

  afterEach(async () => {
    // Clean up messages from test user
    await db.delete(messages).where(sql`user_id = ${testUserId}`);
  });

  afterAll(async () => {
    // Clean up test user (cascades to runs and messages)
    await db.delete(users).where(sql`id = ${testUserId}`);
    await queryClient.end();
  });

  // ===========================================================================
  // create() tests
  // ===========================================================================

  describe('create()', () => {
    it('should create a user message', async () => {
      const message = await repo.create({
        userId: testUserId,
        runId: testRunId,
        role: 'user',
        content: 'Hello, how can I help?',
      });

      expect(message).toBeDefined();
      expect(message.id).toBeDefined();
      expect(message.userId).toBe(testUserId);
      expect(message.runId).toBe(testRunId);
      expect(message.role).toBe('user');
      expect(message.content).toBe('Hello, how can I help?');
      expect(message.toolCallId).toBeNull();
      expect(message.createdAt).toBeInstanceOf(Date);
    });

    it('should create an assistant message', async () => {
      const message = await repo.create({
        userId: testUserId,
        runId: testRunId,
        role: 'assistant',
        content: 'I can help you with many tasks!',
      });

      expect(message.role).toBe('assistant');
      expect(message.content).toBe('I can help you with many tasks!');
    });

    it('should create a tool message with toolCallId', async () => {
      const toolCallId = 'tool-call-001';
      const message = await repo.create({
        userId: testUserId,
        runId: testRunId,
        role: 'tool',
        content: '{"result": "success"}',
        toolCallId,
      });

      expect(message.role).toBe('tool');
      expect(message.toolCallId).toBe(toolCallId);
    });

    it('should create a system message', async () => {
      const message = await repo.create({
        userId: testUserId,
        runId: testRunId,
        role: 'system',
        content: 'You are a helpful assistant.',
      });

      expect(message.role).toBe('system');
    });

    it('should create a message without runId', async () => {
      const message = await repo.create({
        userId: testUserId,
        role: 'user',
        content: 'Message without run',
      });

      expect(message.runId).toBeNull();
      expect(message.userId).toBe(testUserId);
    });

    it('should create a message with metadata', async () => {
      const message = await repo.create({
        userId: testUserId,
        role: 'user',
        content: 'Message with metadata',
        metadata: { subject: 'Test subject', timeSinceLastMessage: '2 hours later' },
      });

      expect(message.metadata).toEqual({ subject: 'Test subject', timeSinceLastMessage: '2 hours later' });
    });

    it('should create a message with toolCalls', async () => {
      const toolCalls = [{ id: 'tc1', name: 'get_weather', arguments: '{"city": "NYC"}' }];
      const message = await repo.create({
        userId: testUserId,
        role: 'assistant',
        content: 'Let me check the weather.',
        toolCalls,
      });

      expect(message.toolCalls).toEqual(toolCalls);
    });
  });

  // ===========================================================================
  // createMany() tests
  // ===========================================================================

  describe('createMany()', () => {
    it('should create multiple messages at once', async () => {
      const result = await repo.createMany(testUserId, [
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'Hello!' },
        { role: 'assistant', content: 'Hi there!' },
      ], testRunId);

      expect(result.length).toBe(3);
      expect(result[0].role).toBe('system');
      expect(result[1].role).toBe('user');
      expect(result[2].role).toBe('assistant');
      expect(result.every(m => m.userId === testUserId)).toBe(true);
    });

    it('should return empty array for empty input', async () => {
      const result = await repo.createMany(testUserId, []);
      expect(result).toEqual([]);
    });

    it('should create messages without runId', async () => {
      const result = await repo.createMany(testUserId, [
        { role: 'user', content: 'No run' },
      ]);

      expect(result[0].runId).toBeNull();
    });
  });

  // ===========================================================================
  // findById() tests
  // ===========================================================================

  describe('findById()', () => {
    it('should find a message by ID', async () => {
      const created = await repo.create({
        userId: testUserId,
        runId: testRunId,
        role: 'user',
        content: 'Find me!',
      });

      const found = await repo.findById(created.id);

      expect(found).toBeDefined();
      expect(found!.id).toBe(created.id);
      expect(found!.content).toBe('Find me!');
    });

    it('should return null for non-existent ID', async () => {
      const found = await repo.findById('00000000-0000-0000-0000-000000000000');
      expect(found).toBeNull();
    });
  });

  describe('findByIdAndUser()', () => {
    it('should find a message by ID with user check', async () => {
      const created = await repo.create({
        userId: testUserId,
        role: 'user',
        content: 'User scoped find',
      });

      const found = await repo.findByIdAndUser(created.id, testUserId);
      expect(found).toBeDefined();
      expect(found!.id).toBe(created.id);
    });

    it('should return null for wrong user', async () => {
      const created = await repo.create({
        userId: testUserId,
        role: 'user',
        content: 'Wrong user test',
      });

      const found = await repo.findByIdAndUser(created.id, '00000000-0000-0000-0000-000000000000');
      expect(found).toBeNull();
    });
  });

  // ===========================================================================
  // findByRun() tests
  // ===========================================================================

  describe('findByRun()', () => {
    it('should find all messages for a run in chronological order', async () => {
      await repo.createMany(testUserId, [
        { role: 'system', content: 'System message' },
        { role: 'user', content: 'User message' },
        { role: 'assistant', content: 'Assistant message' },
      ], testRunId);

      const found = await repo.findByRun(testRunId);

      expect(found.length).toBe(3);
      // Chronological order
      expect(found[0].role).toBe('system');
      expect(found[1].role).toBe('user');
      expect(found[2].role).toBe('assistant');
    });

    it('should return empty array for run with no messages', async () => {
      // Create a new run with no messages
      const newRun = await runRepo.create(testUserId);
      const found = await repo.findByRun(newRun.id);
      expect(found).toEqual([]);

      // Clean up
      await runRepo.delete(newRun.id);
    });
  });

  // ===========================================================================
  // findByRunAndRole() tests
  // ===========================================================================

  describe('findByRunAndRole()', () => {
    it('should filter messages by role', async () => {
      await repo.createMany(testUserId, [
        { role: 'user', content: 'User 1' },
        { role: 'assistant', content: 'Assistant 1' },
        { role: 'user', content: 'User 2' },
        { role: 'assistant', content: 'Assistant 2' },
      ], testRunId);

      const userMessages = await repo.findByRunAndRole(testRunId, 'user');
      const assistantMessages = await repo.findByRunAndRole(testRunId, 'assistant');

      expect(userMessages.length).toBe(2);
      expect(assistantMessages.length).toBe(2);
      expect(userMessages.every(m => m.role === 'user')).toBe(true);
    });
  });

  // ===========================================================================
  // findLastN() tests
  // ===========================================================================

  describe('findLastNByRun()', () => {
    it('should return the last N messages in chronological order', async () => {
      // Create messages individually to ensure distinct timestamps
      await repo.create({ userId: testUserId, runId: testRunId, role: 'system', content: 'Message 1' });
      await repo.create({ userId: testUserId, runId: testRunId, role: 'user', content: 'Message 2' });
      await repo.create({ userId: testUserId, runId: testRunId, role: 'assistant', content: 'Message 3' });
      await repo.create({ userId: testUserId, runId: testRunId, role: 'user', content: 'Message 4' });
      await repo.create({ userId: testUserId, runId: testRunId, role: 'assistant', content: 'Message 5' });

      const last3 = await repo.findLastNByRun(testRunId, 3);

      expect(last3.length).toBe(3);
      expect(last3[0].content).toBe('Message 3');
      expect(last3[1].content).toBe('Message 4');
      expect(last3[2].content).toBe('Message 5');
    });
  });

  // ===========================================================================
  // User-scoped query tests
  // ===========================================================================

  describe('findRecentByUser()', () => {
    it('should return recent messages for a user', async () => {
      await repo.create({ userId: testUserId, role: 'user', content: 'First' });
      await repo.create({ userId: testUserId, role: 'assistant', content: 'Second' });
      await repo.create({ userId: testUserId, role: 'user', content: 'Third' });

      const recent = await repo.findRecentByUser(testUserId, 2);

      expect(recent.length).toBe(2);
      expect(recent[0].content).toBe('Second');
      expect(recent[1].content).toBe('Third');
    });
  });

  describe('countByUser()', () => {
    it('should count messages for a user', async () => {
      await repo.create({ userId: testUserId, role: 'user', content: 'One' });
      await repo.create({ userId: testUserId, role: 'assistant', content: 'Two' });

      const count = await repo.countByUser(testUserId);
      expect(count).toBe(2);
    });
  });

  describe('findLastByUser()', () => {
    it('should return the last message for a user', async () => {
      await repo.create({ userId: testUserId, role: 'user', content: 'First' });
      await repo.create({ userId: testUserId, role: 'assistant', content: 'Last' });

      const last = await repo.findLastByUser(testUserId);
      expect(last?.content).toBe('Last');
    });

    it('should return null for user with no messages', async () => {
      const last = await repo.findLastByUser('00000000-0000-0000-0000-000000000000');
      expect(last).toBeNull();
    });
  });

  // ===========================================================================
  // countByRun() tests
  // ===========================================================================

  describe('countByRun()', () => {
    it('should count messages in a run', async () => {
      await repo.createMany(testUserId, [
        { role: 'user', content: 'One' },
        { role: 'assistant', content: 'Two' },
        { role: 'user', content: 'Three' },
      ], testRunId);

      const count = await repo.countByRun(testRunId);
      expect(count).toBe(3);
    });
  });

  // ===========================================================================
  // delete() tests
  // ===========================================================================

  describe('delete()', () => {
    it('should delete a message', async () => {
      const created = await repo.create({
        userId: testUserId,
        runId: testRunId,
        role: 'user',
        content: 'To be deleted',
      });

      const deleted = await repo.delete(created.id);
      expect(deleted).toBe(true);

      const found = await repo.findById(created.id);
      expect(found).toBeNull();
    });

    it('should return false for non-existent message', async () => {
      const deleted = await repo.delete('00000000-0000-0000-0000-000000000000');
      expect(deleted).toBe(false);
    });
  });

  describe('deleteByIdAndUser()', () => {
    it('should delete a message with user check', async () => {
      const created = await repo.create({
        userId: testUserId,
        role: 'user',
        content: 'User-scoped delete',
      });

      const deleted = await repo.deleteByIdAndUser(created.id, testUserId);
      expect(deleted).toBe(true);
    });

    it('should return false for wrong user', async () => {
      const created = await repo.create({
        userId: testUserId,
        role: 'user',
        content: 'Wrong user delete',
      });

      const deleted = await repo.deleteByIdAndUser(created.id, '00000000-0000-0000-0000-000000000000');
      expect(deleted).toBe(false);

      // Clean up - message still exists
      await repo.delete(created.id);
    });
  });

  describe('deleteAllByUser()', () => {
    it('should delete all messages for a user', async () => {
      await repo.create({ userId: testUserId, role: 'user', content: 'One' });
      await repo.create({ userId: testUserId, role: 'assistant', content: 'Two' });

      const count = await repo.deleteAllByUser(testUserId);
      expect(count).toBe(2);

      const remaining = await repo.countByUser(testUserId);
      expect(remaining).toBe(0);
    });
  });

  // ===========================================================================
  // deleteByRun() tests
  // ===========================================================================

  describe('deleteByRun()', () => {
    it('should delete all messages for a run', async () => {
      await repo.createMany(testUserId, [
        { role: 'user', content: 'One' },
        { role: 'assistant', content: 'Two' },
        { role: 'user', content: 'Three' },
      ], testRunId);

      const deletedCount = await repo.deleteByRun(testRunId);
      expect(deletedCount).toBe(3);

      const remaining = await repo.findByRun(testRunId);
      expect(remaining.length).toBe(0);
    });
  });

  // ===========================================================================
  // findByToolCallId() tests
  // ===========================================================================

  describe('findByToolCallId()', () => {
    it('should find a tool result message by tool call ID', async () => {
      const toolCallId = 'tool-call-002';
      await repo.create({
        userId: testUserId,
        runId: testRunId,
        role: 'tool',
        content: '{"result": "found"}',
        toolCallId,
      });

      const found = await repo.findByToolCallId(toolCallId);

      expect(found).toBeDefined();
      expect(found!.toolCallId).toBe(toolCallId);
      expect(found!.content).toBe('{"result": "found"}');
    });

    it('should return null for non-existent tool call ID', async () => {
      const found = await repo.findByToolCallId('nonexistent-tool-call');
      expect(found).toBeNull();
    });
  });

  // ===========================================================================
  // updateContent() tests
  // ===========================================================================

  describe('updateContent()', () => {
    it('should update message content', async () => {
      const created = await repo.create({
        userId: testUserId,
        runId: testRunId,
        role: 'assistant',
        content: 'Initial content',
      });

      const updated = await repo.updateContent(created.id, 'Updated content');

      expect(updated!.content).toBe('Updated content');
    });

    it('should return null for non-existent message', async () => {
      const updated = await repo.updateContent('00000000-0000-0000-0000-000000000000', 'New');
      expect(updated).toBeNull();
    });
  });

  describe('updateMetadata()', () => {
    it('should update message metadata', async () => {
      const created = await repo.create({
        userId: testUserId,
        role: 'user',
        content: 'Metadata test',
      });

      const updated = await repo.updateMetadata(created.id, { subject: 'New Subject' });
      expect(updated!.metadata).toEqual({ subject: 'New Subject' });
    });
  });

  // ===========================================================================
  // appendContent() tests
  // ===========================================================================

  describe('appendContent()', () => {
    it('should append content to an existing message', async () => {
      const created = await repo.create({
        userId: testUserId,
        runId: testRunId,
        role: 'assistant',
        content: 'Hello',
      });

      await repo.appendContent(created.id, ' world');
      await repo.appendContent(created.id, '!');

      const found = await repo.findById(created.id);
      expect(found!.content).toBe('Hello world!');
    });
  });
});
