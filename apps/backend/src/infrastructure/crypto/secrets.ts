// =============================================================================
// Secrets Encryption Module
// =============================================================================
// AES-256-GCM encryption for user secrets (API keys, tokens, etc.)
// Uses a master key from environment to encrypt/decrypt sensitive values.

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { config } from '../config/index.js';

// =============================================================================
// Constants
// =============================================================================

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16; // 128 bits
const AUTH_TAG_LENGTH = 16; // 128 bits
const KEY_LENGTH = 32; // 256 bits

// =============================================================================
// Types
// =============================================================================

/**
 * Encrypted secret data stored in the database
 */
export interface EncryptedSecret {
  /** Hex-encoded ciphertext */
  encryptedValue: string;
  /** Hex-encoded initialization vector (16 bytes) */
  iv: string;
  /** Hex-encoded authentication tag (16 bytes) */
  authTag: string;
}

// =============================================================================
// Master Key Management
// =============================================================================

let masterKey: Buffer | null = null;

/**
 * Get the master key, lazily loading from config
 * This allows tests to set up the key before it's used
 */
function getMasterKey(): Buffer {
  if (masterKey) {
    return masterKey;
  }

  const keyHex = config.SECRETS_MASTER_KEY;

  if (!keyHex || keyHex.length !== 64) {
    throw new Error(
      `SECRETS_MASTER_KEY must be 32 bytes (64 hex characters), got ${keyHex?.length ?? 0} characters`
    );
  }

  // Validate hex format
  if (!/^[0-9a-fA-F]+$/.test(keyHex)) {
    throw new Error('SECRETS_MASTER_KEY must be a valid hex string');
  }

  masterKey = Buffer.from(keyHex, 'hex');

  if (masterKey.length !== KEY_LENGTH) {
    throw new Error(
      `SECRETS_MASTER_KEY must decode to 32 bytes, got ${masterKey.length} bytes`
    );
  }

  return masterKey;
}

/**
 * Set a custom master key (for testing only)
 * @internal
 */
export function setMasterKeyForTesting(keyHex: string): void {
  if (keyHex.length !== 64) {
    throw new Error('Test master key must be 64 hex characters');
  }
  masterKey = Buffer.from(keyHex, 'hex');
}

/**
 * Clear the master key (for testing only)
 * @internal
 */
export function clearMasterKeyForTesting(): void {
  masterKey = null;
}

// =============================================================================
// Encryption Functions
// =============================================================================

/**
 * Encrypt a plaintext secret using AES-256-GCM
 *
 * @param plaintext - The secret value to encrypt
 * @returns Encrypted data with IV and auth tag
 *
 * @example
 * const encrypted = encryptSecret('sk-my-api-key');
 * // Store encrypted.encryptedValue, encrypted.iv, encrypted.authTag in DB
 */
export function encryptSecret(plaintext: string): EncryptedSecret {
  const key = getMasterKey();
  const iv = randomBytes(IV_LENGTH);

  const cipher = createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag();

  return {
    encryptedValue: encrypted,
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex'),
  };
}

/**
 * Decrypt an encrypted secret using AES-256-GCM
 *
 * @param encrypted - The encrypted data from the database
 * @returns The original plaintext secret
 * @throws Error if decryption fails (tampering detected or wrong key)
 *
 * @example
 * const plaintext = decryptSecret({
 *   encryptedValue: '...',
 *   iv: '...',
 *   authTag: '...',
 * });
 */
export function decryptSecret(encrypted: EncryptedSecret): string {
  const key = getMasterKey();

  const iv = Buffer.from(encrypted.iv, 'hex');
  const authTag = Buffer.from(encrypted.authTag, 'hex');

  if (iv.length !== IV_LENGTH) {
    throw new Error(`Invalid IV length: expected ${IV_LENGTH}, got ${iv.length}`);
  }

  if (authTag.length !== AUTH_TAG_LENGTH) {
    throw new Error(
      `Invalid auth tag length: expected ${AUTH_TAG_LENGTH}, got ${authTag.length}`
    );
  }

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted.encryptedValue, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

/**
 * Safely use a decrypted secret within a callback
 *
 * This is a convenience wrapper that ensures the secret is only available
 * within the callback scope. While JavaScript doesn't allow true memory
 * clearing, this pattern helps prevent accidental leakage.
 *
 * @param encrypted - The encrypted data
 * @param fn - Callback that receives the decrypted secret
 * @returns The result of the callback
 *
 * @example
 * const response = await withDecryptedSecret(encrypted, async (apiKey) => {
 *   return fetch('https://api.openai.com/...', {
 *     headers: { Authorization: `Bearer ${apiKey}` },
 *   });
 * });
 */
export function withDecryptedSecret<T>(
  encrypted: EncryptedSecret,
  fn: (secret: string) => T
): T {
  const secret = decryptSecret(encrypted);
  return fn(secret);
}

// =============================================================================
// Validation Helpers
// =============================================================================

/**
 * Validate that an EncryptedSecret object has all required fields
 */
export function isValidEncryptedSecret(obj: unknown): obj is EncryptedSecret {
  if (typeof obj !== 'object' || obj === null) {
    return false;
  }

  const secret = obj as Record<string, unknown>;

  return (
    typeof secret.encryptedValue === 'string' &&
    typeof secret.iv === 'string' &&
    typeof secret.authTag === 'string' &&
    secret.iv.length === IV_LENGTH * 2 && // hex = 2 chars per byte
    secret.authTag.length === AUTH_TAG_LENGTH * 2
  );
}
