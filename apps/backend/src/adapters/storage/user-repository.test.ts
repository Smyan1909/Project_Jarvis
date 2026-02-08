// =============================================================================
// User Repository - Integration Tests
// =============================================================================
// Tests run against the real database to verify SQL queries work correctly.

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { db, queryClient } from '../../infrastructure/db/client.js';
import { users } from '../../infrastructure/db/schema.js';
import { UserRepository } from './user-repository.js';

describe('UserRepository Integration', () => {
  let repo: UserRepository;
  const testEmails: string[] = [];

  beforeAll(async () => {
    repo = new UserRepository();
  });

  afterEach(async () => {
    // Clean up test users
    for (const email of testEmails) {
      await db.delete(users).where(sql`email = ${email}`);
    }
    testEmails.length = 0;
  });

  afterAll(async () => {
    await queryClient.end();
  });

  // ===========================================================================
  // create() tests
  // ===========================================================================

  describe('create()', () => {
    it('should create a new user', async () => {
      const email = `test-create-${Date.now()}@example.com`;
      testEmails.push(email.toLowerCase());

      const user = await repo.create({
        email,
        passwordHash: 'hashed-password-123',
        displayName: 'Test User',
      });

      expect(user).toBeDefined();
      expect(user.id).toBeDefined();
      expect(user.email).toBe(email.toLowerCase());
      expect(user.passwordHash).toBe('hashed-password-123');
      expect(user.displayName).toBe('Test User');
      expect(user.createdAt).toBeInstanceOf(Date);
      expect(user.updatedAt).toBeInstanceOf(Date);
    });

    it('should normalize email to lowercase', async () => {
      const email = `TEST-UPPERCASE-${Date.now()}@EXAMPLE.COM`;
      testEmails.push(email.toLowerCase());

      const user = await repo.create({
        email,
        passwordHash: 'hash',
      });

      expect(user.email).toBe(email.toLowerCase());
    });

    it('should allow null displayName', async () => {
      const email = `test-no-display-${Date.now()}@example.com`;
      testEmails.push(email.toLowerCase());

      const user = await repo.create({
        email,
        passwordHash: 'hash',
      });

      expect(user.displayName).toBeNull();
    });

    it('should throw on duplicate email', async () => {
      const email = `test-duplicate-${Date.now()}@example.com`;
      testEmails.push(email.toLowerCase());

      await repo.create({
        email,
        passwordHash: 'hash1',
      });

      await expect(
        repo.create({
          email,
          passwordHash: 'hash2',
        })
      ).rejects.toThrow();
    });
  });

  // ===========================================================================
  // findById() tests
  // ===========================================================================

  describe('findById()', () => {
    it('should find a user by ID', async () => {
      const email = `test-find-id-${Date.now()}@example.com`;
      testEmails.push(email.toLowerCase());

      const created = await repo.create({
        email,
        passwordHash: 'hash',
        displayName: 'Find By ID',
      });

      const found = await repo.findById(created.id);

      expect(found).toBeDefined();
      expect(found!.id).toBe(created.id);
      expect(found!.email).toBe(email.toLowerCase());
      expect(found!.displayName).toBe('Find By ID');
    });

    it('should return null for non-existent ID', async () => {
      const found = await repo.findById('00000000-0000-0000-0000-000000000000');
      expect(found).toBeNull();
    });
  });

  // ===========================================================================
  // findByEmail() tests
  // ===========================================================================

  describe('findByEmail()', () => {
    it('should find a user by email', async () => {
      const email = `test-find-email-${Date.now()}@example.com`;
      testEmails.push(email.toLowerCase());

      await repo.create({
        email,
        passwordHash: 'hash',
        displayName: 'Find By Email',
      });

      const found = await repo.findByEmail(email);

      expect(found).toBeDefined();
      expect(found!.email).toBe(email.toLowerCase());
      expect(found!.displayName).toBe('Find By Email');
    });

    it('should find user regardless of email case', async () => {
      const email = `test-case-${Date.now()}@example.com`;
      testEmails.push(email.toLowerCase());

      await repo.create({
        email: email.toLowerCase(),
        passwordHash: 'hash',
      });

      // Search with uppercase
      const found = await repo.findByEmail(email.toUpperCase());
      expect(found).toBeDefined();
      expect(found!.email).toBe(email.toLowerCase());
    });

    it('should return null for non-existent email', async () => {
      const found = await repo.findByEmail('nonexistent@example.com');
      expect(found).toBeNull();
    });
  });

  // ===========================================================================
  // update() tests
  // ===========================================================================

  describe('update()', () => {
    it('should update user displayName', async () => {
      const email = `test-update-${Date.now()}@example.com`;
      testEmails.push(email.toLowerCase());

      const created = await repo.create({
        email,
        passwordHash: 'hash',
        displayName: 'Original Name',
      });

      const updated = await repo.update(created.id, {
        displayName: 'Updated Name',
      });

      expect(updated).toBeDefined();
      expect(updated!.displayName).toBe('Updated Name');
      expect(updated!.updatedAt.getTime()).toBeGreaterThanOrEqual(
        created.updatedAt.getTime()
      );
    });

    it('should update user email and normalize it', async () => {
      const email = `test-update-email-${Date.now()}@example.com`;
      const newEmail = `UPDATED-${Date.now()}@EXAMPLE.COM`;
      testEmails.push(email.toLowerCase());
      testEmails.push(newEmail.toLowerCase());

      const created = await repo.create({
        email,
        passwordHash: 'hash',
      });

      const updated = await repo.update(created.id, {
        email: newEmail,
      });

      expect(updated!.email).toBe(newEmail.toLowerCase());
    });

    it('should return null for non-existent user', async () => {
      const updated = await repo.update('00000000-0000-0000-0000-000000000000', {
        displayName: 'Test',
      });
      expect(updated).toBeNull();
    });
  });

  // ===========================================================================
  // delete() tests
  // ===========================================================================

  describe('delete()', () => {
    it('should delete a user', async () => {
      const email = `test-delete-${Date.now()}@example.com`;
      // Don't add to testEmails since we're deleting it

      const created = await repo.create({
        email,
        passwordHash: 'hash',
      });

      const deleted = await repo.delete(created.id);
      expect(deleted).toBe(true);

      const found = await repo.findById(created.id);
      expect(found).toBeNull();
    });

    it('should return false for non-existent user', async () => {
      const deleted = await repo.delete('00000000-0000-0000-0000-000000000000');
      expect(deleted).toBe(false);
    });
  });

  // ===========================================================================
  // emailExists() tests
  // ===========================================================================

  describe('emailExists()', () => {
    it('should return true for existing email', async () => {
      const email = `test-exists-${Date.now()}@example.com`;
      testEmails.push(email.toLowerCase());

      await repo.create({
        email,
        passwordHash: 'hash',
      });

      const exists = await repo.emailExists(email);
      expect(exists).toBe(true);
    });

    it('should return false for non-existing email', async () => {
      const exists = await repo.emailExists('nonexistent@example.com');
      expect(exists).toBe(false);
    });
  });
});
