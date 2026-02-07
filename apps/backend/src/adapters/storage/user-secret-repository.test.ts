// =============================================================================
// User Secret Repository - Integration Tests
// =============================================================================
// Tests run against the real database to verify SQL queries work correctly.

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { db, queryClient } from '../../infrastructure/db/client.js';
import { users, userSecrets } from '../../infrastructure/db/schema.js';
import { UserSecretRepository, type SecretProvider } from './user-secret-repository.js';
import { UserRepository } from './user-repository.js';

describe('UserSecretRepository Integration', () => {
  let repo: UserSecretRepository;
  let userRepo: UserRepository;
  let testUserId: string;
  const testSecretIds: string[] = [];

  // Create a test user for the secrets
  beforeAll(async () => {
    repo = new UserSecretRepository();
    userRepo = new UserRepository();

    // Create test user
    const user = await userRepo.create({
      email: `test-secrets-${Date.now()}@example.com`,
      passwordHash: 'test-hash',
    });
    testUserId = user.id;
  });

  afterEach(async () => {
    // Clean up test secrets
    for (const id of testSecretIds) {
      await db.delete(userSecrets).where(sql`id = ${id}`);
    }
    testSecretIds.length = 0;
  });

  afterAll(async () => {
    // Clean up test user (cascades to secrets)
    if (testUserId) {
      await db.delete(users).where(sql`id = ${testUserId}`);
    }
    await queryClient.end();
  });

  // Helper to create test secret data
  const createTestSecretData = (provider: SecretProvider = 'openai') => ({
    userId: testUserId,
    provider,
    name: `Test ${provider} Key`,
    encryptedValue: 'encrypted-value-hex',
    iv: 'a'.repeat(32), // 16 bytes = 32 hex chars
    authTag: 'b'.repeat(32), // 16 bytes = 32 hex chars
  });

  // ===========================================================================
  // create() tests
  // ===========================================================================

  describe('create()', () => {
    it('should create a new secret', async () => {
      const data = createTestSecretData('openai');

      const secret = await repo.create(data);
      testSecretIds.push(secret.id);

      expect(secret).toBeDefined();
      expect(secret.id).toBeDefined();
      expect(secret.userId).toBe(testUserId);
      expect(secret.provider).toBe('openai');
      expect(secret.name).toBe('Test openai Key');
      expect(secret.encryptedValue).toBe('encrypted-value-hex');
      expect(secret.iv).toBe('a'.repeat(32));
      expect(secret.authTag).toBe('b'.repeat(32));
      expect(secret.createdAt).toBeInstanceOf(Date);
      expect(secret.updatedAt).toBeInstanceOf(Date);
    });

    it('should create secrets for different providers', async () => {
      const providers: SecretProvider[] = ['openai', 'anthropic', 'github'];

      for (const provider of providers) {
        const secret = await repo.create(createTestSecretData(provider));
        testSecretIds.push(secret.id);

        expect(secret.provider).toBe(provider);
      }

      const allSecrets = await repo.findByUserId(testUserId);
      expect(allSecrets).toHaveLength(3);
    });

    it('should throw on duplicate provider for same user', async () => {
      const data = createTestSecretData('composio');

      const secret1 = await repo.create(data);
      testSecretIds.push(secret1.id);

      // Try to create another secret for the same provider
      // This should fail due to unique constraint (if implemented at DB level)
      // If no DB constraint, this test documents expected behavior
      await expect(repo.create(data)).rejects.toThrow();
    });
  });

  // ===========================================================================
  // findById() tests
  // ===========================================================================

  describe('findById()', () => {
    it('should find a secret by ID', async () => {
      const created = await repo.create(createTestSecretData('openai'));
      testSecretIds.push(created.id);

      const found = await repo.findById(created.id);

      expect(found).toBeDefined();
      expect(found!.id).toBe(created.id);
      expect(found!.provider).toBe('openai');
    });

    it('should return null for non-existent ID', async () => {
      const found = await repo.findById('00000000-0000-0000-0000-000000000000');

      expect(found).toBeNull();
    });
  });

  // ===========================================================================
  // findByUserId() tests
  // ===========================================================================

  describe('findByUserId()', () => {
    it('should return all secrets for a user', async () => {
      const providers: SecretProvider[] = ['openai', 'anthropic'];

      for (const provider of providers) {
        const secret = await repo.create(createTestSecretData(provider));
        testSecretIds.push(secret.id);
      }

      const secrets = await repo.findByUserId(testUserId);

      expect(secrets).toHaveLength(2);
      expect(secrets.map((s) => s.provider).sort()).toEqual(['anthropic', 'openai']);
    });

    it('should return empty array for user with no secrets', async () => {
      // Create a new user with no secrets
      const user = await userRepo.create({
        email: `no-secrets-${Date.now()}@example.com`,
        passwordHash: 'test-hash',
      });

      const secrets = await repo.findByUserId(user.id);

      expect(secrets).toEqual([]);

      // Cleanup
      await db.delete(users).where(sql`id = ${user.id}`);
    });
  });

  // ===========================================================================
  // findByUserAndProvider() tests
  // ===========================================================================

  describe('findByUserAndProvider()', () => {
    it('should find a secret by user and provider', async () => {
      const created = await repo.create(createTestSecretData('anthropic'));
      testSecretIds.push(created.id);

      const found = await repo.findByUserAndProvider(testUserId, 'anthropic');

      expect(found).toBeDefined();
      expect(found!.id).toBe(created.id);
      expect(found!.provider).toBe('anthropic');
    });

    it('should return null if provider not found for user', async () => {
      const found = await repo.findByUserAndProvider(testUserId, 'github');

      expect(found).toBeNull();
    });

    it('should not find other users secrets', async () => {
      // Create secret for test user
      const secret = await repo.create(createTestSecretData('openai'));
      testSecretIds.push(secret.id);

      // Create another user
      const otherUser = await userRepo.create({
        email: `other-user-${Date.now()}@example.com`,
        passwordHash: 'test-hash',
      });

      // Other user should not find test user's secret
      const found = await repo.findByUserAndProvider(otherUser.id, 'openai');
      expect(found).toBeNull();

      // Cleanup
      await db.delete(users).where(sql`id = ${otherUser.id}`);
    });
  });

  // ===========================================================================
  // existsByUserAndProvider() tests
  // ===========================================================================

  describe('existsByUserAndProvider()', () => {
    it('should return true if secret exists', async () => {
      const secret = await repo.create(createTestSecretData('openai'));
      testSecretIds.push(secret.id);

      const exists = await repo.existsByUserAndProvider(testUserId, 'openai');

      expect(exists).toBe(true);
    });

    it('should return false if secret does not exist', async () => {
      const exists = await repo.existsByUserAndProvider(testUserId, 'github');

      expect(exists).toBe(false);
    });
  });

  // ===========================================================================
  // update() tests
  // ===========================================================================

  describe('update()', () => {
    it('should update secret name', async () => {
      const created = await repo.create(createTestSecretData('openai'));
      testSecretIds.push(created.id);

      const updated = await repo.update(created.id, { name: 'Updated Name' });

      expect(updated).toBeDefined();
      expect(updated!.name).toBe('Updated Name');
      expect(updated!.updatedAt.getTime()).toBeGreaterThan(created.updatedAt.getTime());
    });

    it('should update encrypted value', async () => {
      const created = await repo.create(createTestSecretData('openai'));
      testSecretIds.push(created.id);

      const updated = await repo.update(created.id, {
        encryptedValue: 'new-encrypted-value',
        iv: 'c'.repeat(32),
        authTag: 'd'.repeat(32),
      });

      expect(updated).toBeDefined();
      expect(updated!.encryptedValue).toBe('new-encrypted-value');
      expect(updated!.iv).toBe('c'.repeat(32));
      expect(updated!.authTag).toBe('d'.repeat(32));
    });

    it('should return null for non-existent ID', async () => {
      const updated = await repo.update('00000000-0000-0000-0000-000000000000', {
        name: 'New Name',
      });

      expect(updated).toBeNull();
    });
  });

  // ===========================================================================
  // delete() tests
  // ===========================================================================

  describe('delete()', () => {
    it('should delete a secret', async () => {
      const created = await repo.create(createTestSecretData('openai'));

      const deleted = await repo.delete(created.id);

      expect(deleted).toBe(true);

      const found = await repo.findById(created.id);
      expect(found).toBeNull();
    });

    it('should return false for non-existent ID', async () => {
      const deleted = await repo.delete('00000000-0000-0000-0000-000000000000');

      expect(deleted).toBe(false);
    });
  });

  // ===========================================================================
  // deleteAllForUser() tests
  // ===========================================================================

  describe('deleteAllForUser()', () => {
    it('should delete all secrets for a user', async () => {
      const providers: SecretProvider[] = ['openai', 'anthropic', 'github'];

      for (const provider of providers) {
        await repo.create(createTestSecretData(provider));
      }

      const count = await repo.deleteAllForUser(testUserId);

      expect(count).toBe(3);

      const remaining = await repo.findByUserId(testUserId);
      expect(remaining).toHaveLength(0);
    });

    it('should return 0 if user has no secrets', async () => {
      const count = await repo.deleteAllForUser(testUserId);

      expect(count).toBe(0);
    });
  });

  // ===========================================================================
  // Cascade delete tests
  // ===========================================================================

  describe('Cascade delete', () => {
    it('should delete secrets when user is deleted', async () => {
      // Create a user with secrets
      const user = await userRepo.create({
        email: `cascade-test-${Date.now()}@example.com`,
        passwordHash: 'test-hash',
      });

      const secret = await repo.create({
        ...createTestSecretData('openai'),
        userId: user.id,
      });

      // Delete the user
      await userRepo.delete(user.id);

      // Secret should be gone
      const found = await repo.findById(secret.id);
      expect(found).toBeNull();
    });
  });
});
