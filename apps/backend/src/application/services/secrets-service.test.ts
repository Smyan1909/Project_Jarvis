// =============================================================================
// Secrets Service - Unit Tests
// =============================================================================
// Unit tests with mocked repository to test business logic in isolation.

import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from 'vitest';
import { SecretsService } from './secrets-service.js';
import {
  UserSecretRepository,
  type UserSecret,
  type SecretProvider,
} from '../../adapters/storage/user-secret-repository.js';
import {
  setMasterKeyForTesting,
  clearMasterKeyForTesting,
  encryptSecret,
} from '../../infrastructure/crypto/secrets.js';
import { ConflictError, NotFoundError } from '../../domain/errors/index.js';

// =============================================================================
// Test Setup
// =============================================================================

// Test master key
const TEST_MASTER_KEY = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2';

// Mock the repository
const createMockRepo = () => ({
  findById: vi.fn(),
  findByUserId: vi.fn(),
  findByUserAndProvider: vi.fn(),
  existsByUserAndProvider: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  deleteAllForUser: vi.fn(),
});

// Helper to create a mock UserSecret
const createMockSecret = (overrides: Partial<UserSecret> = {}): UserSecret => {
  const encrypted = encryptSecret('test-api-key');
  return {
    id: 'secret-123',
    userId: 'user-123',
    provider: 'openai',
    name: 'My OpenAI Key',
    encryptedValue: encrypted.encryptedValue,
    iv: encrypted.iv,
    authTag: encrypted.authTag,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    ...overrides,
  };
};

describe('SecretsService', () => {
  let service: SecretsService;
  let mockRepo: ReturnType<typeof createMockRepo>;

  beforeAll(() => {
    setMasterKeyForTesting(TEST_MASTER_KEY);
  });

  afterAll(() => {
    clearMasterKeyForTesting();
  });

  beforeEach(() => {
    mockRepo = createMockRepo();
    service = new SecretsService(mockRepo as unknown as UserSecretRepository);
    vi.clearAllMocks();
  });

  // ===========================================================================
  // list() tests
  // ===========================================================================

  describe('list()', () => {
    it('should return secret metadata without values', async () => {
      const mockSecrets = [
        createMockSecret({ id: 'secret-1', provider: 'openai' }),
        createMockSecret({ id: 'secret-2', provider: 'anthropic' }),
      ];
      mockRepo.findByUserId.mockResolvedValue(mockSecrets);

      const result = await service.list('user-123');

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        id: 'secret-1',
        provider: 'openai',
        name: 'My OpenAI Key',
        createdAt: expect.any(Date),
        updatedAt: expect.any(Date),
      });

      // Verify no encrypted data is exposed
      expect((result[0] as unknown as Record<string, unknown>).encryptedValue).toBeUndefined();
      expect((result[0] as unknown as Record<string, unknown>).iv).toBeUndefined();
      expect((result[0] as unknown as Record<string, unknown>).authTag).toBeUndefined();
    });

    it('should return empty array if no secrets', async () => {
      mockRepo.findByUserId.mockResolvedValue([]);

      const result = await service.list('user-123');

      expect(result).toEqual([]);
    });
  });

  // ===========================================================================
  // create() tests
  // ===========================================================================

  describe('create()', () => {
    it('should encrypt and store a new secret', async () => {
      mockRepo.findByUserAndProvider.mockResolvedValue(null);
      mockRepo.create.mockImplementation(async (data) => ({
        id: 'new-secret-id',
        userId: data.userId,
        provider: data.provider,
        name: data.name,
        encryptedValue: data.encryptedValue,
        iv: data.iv,
        authTag: data.authTag,
        createdAt: new Date(),
        updatedAt: new Date(),
      }));

      const result = await service.create('user-123', {
        provider: 'openai',
        name: 'My API Key',
        value: 'sk-secret-key-12345',
      });

      expect(result.id).toBe('new-secret-id');
      expect(result.provider).toBe('openai');
      expect(result.name).toBe('My API Key');

      // Verify encryption was used
      expect(mockRepo.create).toHaveBeenCalledWith({
        userId: 'user-123',
        provider: 'openai',
        name: 'My API Key',
        encryptedValue: expect.any(String),
        iv: expect.any(String),
        authTag: expect.any(String),
      });

      // Verify the value was encrypted (not stored as plaintext)
      const createCall = mockRepo.create.mock.calls[0][0];
      expect(createCall.encryptedValue).not.toBe('sk-secret-key-12345');
      expect(createCall.iv).toHaveLength(32); // 16 bytes hex
      expect(createCall.authTag).toHaveLength(32); // 16 bytes hex
    });

    it('should throw ConflictError if secret for provider already exists', async () => {
      mockRepo.findByUserAndProvider.mockResolvedValue(createMockSecret());

      await expect(
        service.create('user-123', {
          provider: 'openai',
          name: 'Another Key',
          value: 'sk-another-key',
        })
      ).rejects.toThrow(ConflictError);

      expect(mockRepo.create).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // update() tests
  // ===========================================================================

  describe('update()', () => {
    it('should update secret name only', async () => {
      const existing = createMockSecret();
      mockRepo.findById.mockResolvedValue(existing);
      mockRepo.update.mockResolvedValue({
        ...existing,
        name: 'Updated Name',
        updatedAt: new Date(),
      });

      const result = await service.update('user-123', 'secret-123', {
        name: 'Updated Name',
      });

      expect(result.name).toBe('Updated Name');
      expect(mockRepo.update).toHaveBeenCalledWith('secret-123', {
        name: 'Updated Name',
      });
    });

    it('should re-encrypt when value is updated', async () => {
      const existing = createMockSecret();
      mockRepo.findById.mockResolvedValue(existing);
      mockRepo.update.mockImplementation(async (id, data) => ({
        ...existing,
        ...data,
        updatedAt: new Date(),
      }));

      await service.update('user-123', 'secret-123', {
        value: 'new-secret-value',
      });

      expect(mockRepo.update).toHaveBeenCalledWith('secret-123', {
        encryptedValue: expect.any(String),
        iv: expect.any(String),
        authTag: expect.any(String),
      });

      // Verify new encryption (different IV)
      const updateCall = mockRepo.update.mock.calls[0][1];
      expect(updateCall.encryptedValue).not.toBe(existing.encryptedValue);
    });

    it('should update both name and value', async () => {
      const existing = createMockSecret();
      mockRepo.findById.mockResolvedValue(existing);
      mockRepo.update.mockImplementation(async (id, data) => ({
        ...existing,
        ...data,
        updatedAt: new Date(),
      }));

      await service.update('user-123', 'secret-123', {
        name: 'New Name',
        value: 'new-value',
      });

      expect(mockRepo.update).toHaveBeenCalledWith('secret-123', {
        name: 'New Name',
        encryptedValue: expect.any(String),
        iv: expect.any(String),
        authTag: expect.any(String),
      });
    });

    it('should throw NotFoundError if secret not found', async () => {
      mockRepo.findById.mockResolvedValue(null);

      await expect(
        service.update('user-123', 'nonexistent', { name: 'New Name' })
      ).rejects.toThrow(NotFoundError);
    });

    it('should throw NotFoundError if secret belongs to different user', async () => {
      mockRepo.findById.mockResolvedValue(createMockSecret({ userId: 'other-user' }));

      await expect(
        service.update('user-123', 'secret-123', { name: 'New Name' })
      ).rejects.toThrow(NotFoundError);
    });
  });

  // ===========================================================================
  // delete() tests
  // ===========================================================================

  describe('delete()', () => {
    it('should delete a secret', async () => {
      mockRepo.findById.mockResolvedValue(createMockSecret());
      mockRepo.delete.mockResolvedValue(true);

      await service.delete('user-123', 'secret-123');

      expect(mockRepo.delete).toHaveBeenCalledWith('secret-123');
    });

    it('should throw NotFoundError if secret not found', async () => {
      mockRepo.findById.mockResolvedValue(null);

      await expect(service.delete('user-123', 'nonexistent')).rejects.toThrow(NotFoundError);
    });

    it('should throw NotFoundError if secret belongs to different user', async () => {
      mockRepo.findById.mockResolvedValue(createMockSecret({ userId: 'other-user' }));

      await expect(service.delete('user-123', 'secret-123')).rejects.toThrow(NotFoundError);
    });
  });

  // ===========================================================================
  // getDecryptedValue() tests
  // ===========================================================================

  describe('getDecryptedValue()', () => {
    it('should return decrypted secret value', async () => {
      const originalValue = 'sk-my-api-key-12345';
      const encrypted = encryptSecret(originalValue);
      mockRepo.findByUserAndProvider.mockResolvedValue(
        createMockSecret({
          encryptedValue: encrypted.encryptedValue,
          iv: encrypted.iv,
          authTag: encrypted.authTag,
        })
      );

      const result = await service.getDecryptedValue('user-123', 'openai');

      expect(result).toBe(originalValue);
    });

    it('should return null if secret not found', async () => {
      mockRepo.findByUserAndProvider.mockResolvedValue(null);

      const result = await service.getDecryptedValue('user-123', 'openai');

      expect(result).toBeNull();
    });
  });

  // ===========================================================================
  // hasSecret() tests
  // ===========================================================================

  describe('hasSecret()', () => {
    it('should return true if secret exists', async () => {
      mockRepo.existsByUserAndProvider.mockResolvedValue(true);

      const result = await service.hasSecret('user-123', 'openai');

      expect(result).toBe(true);
    });

    it('should return false if secret does not exist', async () => {
      mockRepo.existsByUserAndProvider.mockResolvedValue(false);

      const result = await service.hasSecret('user-123', 'openai');

      expect(result).toBe(false);
    });
  });

  // ===========================================================================
  // getById() tests
  // ===========================================================================

  describe('getById()', () => {
    it('should return secret metadata by ID', async () => {
      mockRepo.findById.mockResolvedValue(createMockSecret());

      const result = await service.getById('user-123', 'secret-123');

      expect(result.id).toBe('secret-123');
      expect(result.provider).toBe('openai');
    });

    it('should throw NotFoundError if secret not found', async () => {
      mockRepo.findById.mockResolvedValue(null);

      await expect(service.getById('user-123', 'nonexistent')).rejects.toThrow(NotFoundError);
    });

    it('should throw NotFoundError if secret belongs to different user', async () => {
      mockRepo.findById.mockResolvedValue(createMockSecret({ userId: 'other-user' }));

      await expect(service.getById('user-123', 'secret-123')).rejects.toThrow(NotFoundError);
    });
  });
});
