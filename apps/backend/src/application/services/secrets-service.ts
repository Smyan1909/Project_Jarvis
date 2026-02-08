// =============================================================================
// Secrets Service - Application Service
// =============================================================================
// Handles user secrets management: create, list, update, delete.
// Encrypts secrets before storage and decrypts when needed by LLM adapters.
//
// IMPORTANT: This service NEVER logs secret values.

import {
  UserSecretRepository,
  type SecretProvider,
  type UserSecret,
} from '../../adapters/storage/user-secret-repository.js';
import {
  encryptSecret,
  decryptSecret,
  type EncryptedSecret,
} from '../../infrastructure/crypto/secrets.js';
import { ConflictError, NotFoundError } from '../../domain/errors/index.js';
import { logger } from '../../infrastructure/logging/logger.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Secret metadata returned to API clients (never includes the value)
 */
export interface SecretMetadata {
  id: string;
  provider: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Data for creating a new secret
 */
export interface CreateSecretInput {
  provider: SecretProvider;
  name: string;
  value: string;
}

/**
 * Data for updating a secret
 */
export interface UpdateSecretInput {
  name?: string;
  value?: string;
}

// =============================================================================
// Service
// =============================================================================

/**
 * Secrets management service
 * Handles encryption, storage, and retrieval of user secrets
 */
export class SecretsService {
  constructor(private secretRepo: UserSecretRepository) {}

  // ===========================================================================
  // Public Methods
  // ===========================================================================

  /**
   * List all secrets for a user (metadata only, no values)
   */
  async list(userId: string): Promise<SecretMetadata[]> {
    const secrets = await this.secretRepo.findByUserId(userId);

    return secrets.map(this.toMetadata);
  }

  /**
   * Create a new secret for a user
   *
   * @throws ConflictError if a secret for this provider already exists
   */
  async create(userId: string, input: CreateSecretInput): Promise<SecretMetadata> {
    // Check if secret already exists for this provider
    const existing = await this.secretRepo.findByUserAndProvider(userId, input.provider);

    if (existing) {
      throw new ConflictError(
        `A secret for provider '${input.provider}' already exists. Use update to change it.`
      );
    }

    // Encrypt the secret value
    const encrypted = encryptSecret(input.value);

    // Store in database
    const secret = await this.secretRepo.create({
      userId,
      provider: input.provider,
      name: input.name,
      encryptedValue: encrypted.encryptedValue,
      iv: encrypted.iv,
      authTag: encrypted.authTag,
    });

    logger.info('Secret created', {
      userId,
      provider: input.provider,
      secretId: secret.id,
    });
    // NEVER log input.value!

    return this.toMetadata(secret);
  }

  /**
   * Update an existing secret
   *
   * @throws NotFoundError if secret not found or doesn't belong to user
   */
  async update(
    userId: string,
    secretId: string,
    input: UpdateSecretInput
  ): Promise<SecretMetadata> {
    // Find and verify ownership
    const existing = await this.secretRepo.findById(secretId);

    if (!existing || existing.userId !== userId) {
      throw new NotFoundError('Secret', secretId);
    }

    // Build update data
    const updateData: {
      name?: string;
      encryptedValue?: string;
      iv?: string;
      authTag?: string;
    } = {};

    if (input.name !== undefined) {
      updateData.name = input.name;
    }

    if (input.value !== undefined) {
      // Re-encrypt with new value
      const encrypted = encryptSecret(input.value);
      updateData.encryptedValue = encrypted.encryptedValue;
      updateData.iv = encrypted.iv;
      updateData.authTag = encrypted.authTag;
    }

    const updated = await this.secretRepo.update(secretId, updateData);

    if (!updated) {
      throw new NotFoundError('Secret', secretId);
    }

    logger.info('Secret updated', {
      userId,
      secretId,
      nameUpdated: input.name !== undefined,
      valueUpdated: input.value !== undefined,
    });
    // NEVER log input.value!

    return this.toMetadata(updated);
  }

  /**
   * Delete a secret
   *
   * @throws NotFoundError if secret not found or doesn't belong to user
   */
  async delete(userId: string, secretId: string): Promise<void> {
    // Find and verify ownership
    const existing = await this.secretRepo.findById(secretId);

    if (!existing || existing.userId !== userId) {
      throw new NotFoundError('Secret', secretId);
    }

    await this.secretRepo.delete(secretId);

    logger.info('Secret deleted', {
      userId,
      secretId,
      provider: existing.provider,
    });
  }

  /**
   * Get a decrypted secret value by provider
   *
   * This method is for INTERNAL USE ONLY by LLM adapters.
   * It returns the actual decrypted secret value.
   *
   * @returns The decrypted secret value, or null if not found
   */
  async getDecryptedValue(userId: string, provider: SecretProvider): Promise<string | null> {
    const secret = await this.secretRepo.findByUserAndProvider(userId, provider);

    if (!secret) {
      return null;
    }

    const encrypted: EncryptedSecret = {
      encryptedValue: secret.encryptedValue,
      iv: secret.iv,
      authTag: secret.authTag,
    };

    return decryptSecret(encrypted);
  }

  /**
   * Check if a user has a secret for a given provider
   */
  async hasSecret(userId: string, provider: SecretProvider): Promise<boolean> {
    return this.secretRepo.existsByUserAndProvider(userId, provider);
  }

  /**
   * Get secret metadata by ID (for ownership verification)
   *
   * @throws NotFoundError if secret not found or doesn't belong to user
   */
  async getById(userId: string, secretId: string): Promise<SecretMetadata> {
    const secret = await this.secretRepo.findById(secretId);

    if (!secret || secret.userId !== userId) {
      throw new NotFoundError('Secret', secretId);
    }

    return this.toMetadata(secret);
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  /**
   * Convert a UserSecret to SecretMetadata (strips sensitive fields)
   */
  private toMetadata(secret: UserSecret): SecretMetadata {
    return {
      id: secret.id,
      provider: secret.provider,
      name: secret.name,
      createdAt: secret.createdAt,
      updatedAt: secret.updatedAt,
    };
  }
}
