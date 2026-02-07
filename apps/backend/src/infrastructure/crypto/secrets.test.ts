// =============================================================================
// Secrets Encryption - Unit Tests
// =============================================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  encryptSecret,
  decryptSecret,
  withDecryptedSecret,
  isValidEncryptedSecret,
  setMasterKeyForTesting,
  clearMasterKeyForTesting,
  type EncryptedSecret,
} from './secrets.js';

// =============================================================================
// Test Setup
// =============================================================================

// Test master key: 32 bytes (64 hex chars)
const TEST_MASTER_KEY = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2';

describe('Secrets Encryption', () => {
  beforeAll(() => {
    setMasterKeyForTesting(TEST_MASTER_KEY);
  });

  afterAll(() => {
    clearMasterKeyForTesting();
  });

  // ===========================================================================
  // encryptSecret() tests
  // ===========================================================================

  describe('encryptSecret()', () => {
    it('should encrypt a plaintext string', () => {
      const plaintext = 'sk-my-secret-api-key-12345';

      const encrypted = encryptSecret(plaintext);

      expect(encrypted).toBeDefined();
      expect(encrypted.encryptedValue).toBeDefined();
      expect(encrypted.iv).toBeDefined();
      expect(encrypted.authTag).toBeDefined();

      // IV should be 16 bytes = 32 hex chars
      expect(encrypted.iv).toHaveLength(32);

      // Auth tag should be 16 bytes = 32 hex chars
      expect(encrypted.authTag).toHaveLength(32);

      // Encrypted value should be hex
      expect(/^[0-9a-f]+$/i.test(encrypted.encryptedValue)).toBe(true);
    });

    it('should produce different ciphertext for same plaintext (random IV)', () => {
      const plaintext = 'same-secret-value';

      const encrypted1 = encryptSecret(plaintext);
      const encrypted2 = encryptSecret(plaintext);

      // IVs should be different
      expect(encrypted1.iv).not.toBe(encrypted2.iv);

      // Ciphertexts should be different
      expect(encrypted1.encryptedValue).not.toBe(encrypted2.encryptedValue);

      // Auth tags should be different
      expect(encrypted1.authTag).not.toBe(encrypted2.authTag);
    });

    it('should handle empty string', () => {
      const encrypted = encryptSecret('');

      expect(encrypted.encryptedValue).toBeDefined();
      expect(decryptSecret(encrypted)).toBe('');
    });

    it('should handle unicode characters', () => {
      const plaintext = 'secret with unicode: 你好世界 🔐';

      const encrypted = encryptSecret(plaintext);
      const decrypted = decryptSecret(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    it('should handle very long strings', () => {
      const plaintext = 'x'.repeat(10000);

      const encrypted = encryptSecret(plaintext);
      const decrypted = decryptSecret(encrypted);

      expect(decrypted).toBe(plaintext);
    });
  });

  // ===========================================================================
  // decryptSecret() tests
  // ===========================================================================

  describe('decryptSecret()', () => {
    it('should decrypt an encrypted string', () => {
      const plaintext = 'sk-my-secret-api-key-12345';

      const encrypted = encryptSecret(plaintext);
      const decrypted = decryptSecret(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    it('should throw on tampered ciphertext', () => {
      const encrypted = encryptSecret('my-secret');

      // Tamper with the ciphertext
      const tampered: EncryptedSecret = {
        ...encrypted,
        encryptedValue: 'ff' + encrypted.encryptedValue.slice(2),
      };

      expect(() => decryptSecret(tampered)).toThrow();
    });

    it('should throw on tampered IV', () => {
      const encrypted = encryptSecret('my-secret');

      // Tamper with the IV
      const tampered: EncryptedSecret = {
        ...encrypted,
        iv: 'ff' + encrypted.iv.slice(2),
      };

      expect(() => decryptSecret(tampered)).toThrow();
    });

    it('should throw on tampered auth tag', () => {
      const encrypted = encryptSecret('my-secret');

      // Tamper with the auth tag
      const tampered: EncryptedSecret = {
        ...encrypted,
        authTag: 'ff' + encrypted.authTag.slice(2),
      };

      expect(() => decryptSecret(tampered)).toThrow();
    });

    it('should throw on invalid IV length', () => {
      const encrypted = encryptSecret('my-secret');

      const invalid: EncryptedSecret = {
        ...encrypted,
        iv: 'abcd', // Too short
      };

      expect(() => decryptSecret(invalid)).toThrow(/Invalid IV length/);
    });

    it('should throw on invalid auth tag length', () => {
      const encrypted = encryptSecret('my-secret');

      const invalid: EncryptedSecret = {
        ...encrypted,
        authTag: 'abcd', // Too short
      };

      expect(() => decryptSecret(invalid)).toThrow(/Invalid auth tag length/);
    });
  });

  // ===========================================================================
  // withDecryptedSecret() tests
  // ===========================================================================

  describe('withDecryptedSecret()', () => {
    it('should pass decrypted secret to callback', () => {
      const plaintext = 'my-api-key';
      const encrypted = encryptSecret(plaintext);

      const result = withDecryptedSecret(encrypted, (secret) => {
        expect(secret).toBe(plaintext);
        return secret.length;
      });

      expect(result).toBe(plaintext.length);
    });

    it('should work with async callbacks', async () => {
      const plaintext = 'async-secret';
      const encrypted = encryptSecret(plaintext);

      const result = await withDecryptedSecret(encrypted, async (secret) => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return secret.toUpperCase();
      });

      expect(result).toBe('ASYNC-SECRET');
    });

    it('should propagate errors from callback', () => {
      const encrypted = encryptSecret('test');

      expect(() =>
        withDecryptedSecret(encrypted, () => {
          throw new Error('Callback error');
        })
      ).toThrow('Callback error');
    });
  });

  // ===========================================================================
  // isValidEncryptedSecret() tests
  // ===========================================================================

  describe('isValidEncryptedSecret()', () => {
    it('should return true for valid encrypted secret', () => {
      const encrypted = encryptSecret('test');

      expect(isValidEncryptedSecret(encrypted)).toBe(true);
    });

    it('should return false for null', () => {
      expect(isValidEncryptedSecret(null)).toBe(false);
    });

    it('should return false for undefined', () => {
      expect(isValidEncryptedSecret(undefined)).toBe(false);
    });

    it('should return false for missing fields', () => {
      expect(isValidEncryptedSecret({})).toBe(false);
      expect(isValidEncryptedSecret({ encryptedValue: 'abc' })).toBe(false);
      expect(isValidEncryptedSecret({ encryptedValue: 'abc', iv: 'def' })).toBe(false);
    });

    it('should return false for wrong IV length', () => {
      expect(
        isValidEncryptedSecret({
          encryptedValue: 'abc',
          iv: 'tooshort',
          authTag: 'a'.repeat(32),
        })
      ).toBe(false);
    });

    it('should return false for wrong auth tag length', () => {
      expect(
        isValidEncryptedSecret({
          encryptedValue: 'abc',
          iv: 'a'.repeat(32),
          authTag: 'tooshort',
        })
      ).toBe(false);
    });
  });

  // ===========================================================================
  // Master Key Validation tests
  // ===========================================================================

  describe('Master Key Validation', () => {
    it('should reject invalid key length', () => {
      expect(() => setMasterKeyForTesting('tooshort')).toThrow(/64 hex characters/);
    });

    it('should accept valid 64-char hex key', () => {
      // This should not throw
      setMasterKeyForTesting(TEST_MASTER_KEY);
    });
  });
});
