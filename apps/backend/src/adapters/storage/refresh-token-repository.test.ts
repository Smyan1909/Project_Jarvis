// =============================================================================
// Refresh Token Repository - Integration Tests
// =============================================================================
// Tests run against the real database to verify SQL queries work correctly.

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { db, queryClient } from '../../infrastructure/db/client.js';
import { users, refreshTokens } from '../../infrastructure/db/schema.js';
import { UserRepository } from './user-repository.js';
import { RefreshTokenRepository } from './refresh-token-repository.js';

describe('RefreshTokenRepository Integration', () => {
  let userRepo: UserRepository;
  let tokenRepo: RefreshTokenRepository;
  let testUserId: string;
  const testTokenIds: string[] = [];

  beforeAll(async () => {
    userRepo = new UserRepository();
    tokenRepo = new RefreshTokenRepository();

    // Create a test user for token tests
    const testEmail = `token-test-user-${Date.now()}@example.com`;
    const user = await userRepo.create({
      email: testEmail,
      passwordHash: 'test-hash',
    });
    testUserId = user.id;
  });

  afterEach(async () => {
    // Clean up test tokens
    for (const id of testTokenIds) {
      await db.delete(refreshTokens).where(sql`id = ${id}`);
    }
    testTokenIds.length = 0;
  });

  afterAll(async () => {
    // Clean up test user (cascades to tokens)
    await db.delete(users).where(sql`id = ${testUserId}`);
    await queryClient.end();
  });

  // ===========================================================================
  // create() tests
  // ===========================================================================

  describe('create()', () => {
    it('should create a new refresh token', async () => {
      const tokenHash = `hash-${Date.now()}`;
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

      const token = await tokenRepo.create({
        userId: testUserId,
        tokenHash,
        expiresAt,
      });
      testTokenIds.push(token.id);

      expect(token).toBeDefined();
      expect(token.id).toBeDefined();
      expect(token.userId).toBe(testUserId);
      expect(token.tokenHash).toBe(tokenHash);
      expect(token.expiresAt.getTime()).toBe(expiresAt.getTime());
      expect(token.createdAt).toBeInstanceOf(Date);
    });

    it('should allow multiple tokens for same user', async () => {
      const token1 = await tokenRepo.create({
        userId: testUserId,
        tokenHash: `hash1-${Date.now()}`,
        expiresAt: new Date(Date.now() + 1000000),
      });
      testTokenIds.push(token1.id);

      const token2 = await tokenRepo.create({
        userId: testUserId,
        tokenHash: `hash2-${Date.now()}`,
        expiresAt: new Date(Date.now() + 1000000),
      });
      testTokenIds.push(token2.id);

      expect(token1.id).not.toBe(token2.id);
    });
  });

  // ===========================================================================
  // findByHash() tests
  // ===========================================================================

  describe('findByHash()', () => {
    it('should find a token by its hash', async () => {
      const tokenHash = `find-hash-${Date.now()}`;

      const created = await tokenRepo.create({
        userId: testUserId,
        tokenHash,
        expiresAt: new Date(Date.now() + 1000000),
      });
      testTokenIds.push(created.id);

      const found = await tokenRepo.findByHash(tokenHash);

      expect(found).toBeDefined();
      expect(found!.id).toBe(created.id);
      expect(found!.tokenHash).toBe(tokenHash);
    });

    it('should return null for non-existent hash', async () => {
      const found = await tokenRepo.findByHash('nonexistent-hash');
      expect(found).toBeNull();
    });
  });

  // ===========================================================================
  // findById() tests
  // ===========================================================================

  describe('findById()', () => {
    it('should find a token by ID', async () => {
      const created = await tokenRepo.create({
        userId: testUserId,
        tokenHash: `find-id-${Date.now()}`,
        expiresAt: new Date(Date.now() + 1000000),
      });
      testTokenIds.push(created.id);

      const found = await tokenRepo.findById(created.id);

      expect(found).toBeDefined();
      expect(found!.id).toBe(created.id);
    });

    it('should return null for non-existent ID', async () => {
      const found = await tokenRepo.findById('00000000-0000-0000-0000-000000000000');
      expect(found).toBeNull();
    });
  });

  // ===========================================================================
  // delete() tests
  // ===========================================================================

  describe('delete()', () => {
    it('should delete a token by ID', async () => {
      const created = await tokenRepo.create({
        userId: testUserId,
        tokenHash: `delete-${Date.now()}`,
        expiresAt: new Date(Date.now() + 1000000),
      });

      const deleted = await tokenRepo.delete(created.id);
      expect(deleted).toBe(true);

      const found = await tokenRepo.findById(created.id);
      expect(found).toBeNull();
    });

    it('should return false for non-existent ID', async () => {
      const deleted = await tokenRepo.delete('00000000-0000-0000-0000-000000000000');
      expect(deleted).toBe(false);
    });
  });

  // ===========================================================================
  // deleteByHash() tests
  // ===========================================================================

  describe('deleteByHash()', () => {
    it('should delete a token by hash', async () => {
      const tokenHash = `delete-hash-${Date.now()}`;

      const created = await tokenRepo.create({
        userId: testUserId,
        tokenHash,
        expiresAt: new Date(Date.now() + 1000000),
      });

      const deleted = await tokenRepo.deleteByHash(tokenHash);
      expect(deleted).toBe(true);

      const found = await tokenRepo.findById(created.id);
      expect(found).toBeNull();
    });

    it('should return false for non-existent hash', async () => {
      const deleted = await tokenRepo.deleteByHash('nonexistent');
      expect(deleted).toBe(false);
    });
  });

  // ===========================================================================
  // deleteAllForUser() tests
  // ===========================================================================

  describe('deleteAllForUser()', () => {
    it('should delete all tokens for a user', async () => {
      // Create multiple tokens
      await tokenRepo.create({
        userId: testUserId,
        tokenHash: `multi1-${Date.now()}`,
        expiresAt: new Date(Date.now() + 1000000),
      });
      await tokenRepo.create({
        userId: testUserId,
        tokenHash: `multi2-${Date.now()}`,
        expiresAt: new Date(Date.now() + 1000000),
      });
      await tokenRepo.create({
        userId: testUserId,
        tokenHash: `multi3-${Date.now()}`,
        expiresAt: new Date(Date.now() + 1000000),
      });

      const count = await tokenRepo.deleteAllForUser(testUserId);
      expect(count).toBe(3);

      const remaining = await tokenRepo.countByUser(testUserId);
      expect(remaining).toBe(0);
    });

    it('should return 0 for user with no tokens', async () => {
      const count = await tokenRepo.deleteAllForUser(testUserId);
      expect(count).toBe(0);
    });
  });

  // ===========================================================================
  // deleteExpired() tests
  // ===========================================================================

  describe('deleteExpired()', () => {
    it('should delete expired tokens', async () => {
      // Create an expired token
      const expired = await tokenRepo.create({
        userId: testUserId,
        tokenHash: `expired-${Date.now()}`,
        expiresAt: new Date(Date.now() - 1000), // Expired 1 second ago
      });

      // Create a valid token
      const valid = await tokenRepo.create({
        userId: testUserId,
        tokenHash: `valid-${Date.now()}`,
        expiresAt: new Date(Date.now() + 1000000),
      });
      testTokenIds.push(valid.id);

      const deletedCount = await tokenRepo.deleteExpired();
      expect(deletedCount).toBeGreaterThanOrEqual(1);

      // Expired token should be gone
      const foundExpired = await tokenRepo.findById(expired.id);
      expect(foundExpired).toBeNull();

      // Valid token should still exist
      const foundValid = await tokenRepo.findById(valid.id);
      expect(foundValid).toBeDefined();
    });
  });

  // ===========================================================================
  // countByUser() tests
  // ===========================================================================

  describe('countByUser()', () => {
    it('should count tokens for a user', async () => {
      // Ensure clean state
      await tokenRepo.deleteAllForUser(testUserId);

      expect(await tokenRepo.countByUser(testUserId)).toBe(0);

      const t1 = await tokenRepo.create({
        userId: testUserId,
        tokenHash: `count1-${Date.now()}`,
        expiresAt: new Date(Date.now() + 1000000),
      });
      testTokenIds.push(t1.id);

      expect(await tokenRepo.countByUser(testUserId)).toBe(1);

      const t2 = await tokenRepo.create({
        userId: testUserId,
        tokenHash: `count2-${Date.now()}`,
        expiresAt: new Date(Date.now() + 1000000),
      });
      testTokenIds.push(t2.id);

      expect(await tokenRepo.countByUser(testUserId)).toBe(2);
    });
  });
});
