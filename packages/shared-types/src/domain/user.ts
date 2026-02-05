import { z } from 'zod';

// =============================================================================
// Secret Provider
// =============================================================================

export const SecretProviderSchema = z.enum([
  'openai',
  'anthropic',
  'composio',
  'github',
  'custom',
]);

export type SecretProvider = z.infer<typeof SecretProviderSchema>;

// =============================================================================
// User
// =============================================================================

export const UserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  passwordHash: z.string(),
  displayName: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type User = z.infer<typeof UserSchema>;

// =============================================================================
// User Secret
// =============================================================================

export const UserSecretSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  provider: SecretProviderSchema,
  name: z.string().min(1).max(255),
  encryptedValue: z.string(), // AES-256-GCM encrypted
  iv: z.string(), // Initialization vector
  authTag: z.string(), // Authentication tag
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type UserSecret = z.infer<typeof UserSecretSchema>;

// =============================================================================
// Refresh Token
// =============================================================================

export const RefreshTokenSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  tokenHash: z.string(), // Hashed for security - never store raw tokens
  expiresAt: z.date(),
  createdAt: z.date(),
});

export type RefreshToken = z.infer<typeof RefreshTokenSchema>;
