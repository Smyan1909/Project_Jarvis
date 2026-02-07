import { z } from 'zod';
import { SecretProviderSchema } from '../domain/user.js';

// =============================================================================
// Agent Run Request
// =============================================================================

export const AgentRunRequestSchema = z.object({
  input: z.string().min(1).max(10000),
  context: z
    .object({
      previousRunId: z.string().uuid().optional(),
      systemPrompt: z.string().max(5000).optional(),
    })
    .optional(),
});

export type AgentRunRequest = z.infer<typeof AgentRunRequestSchema>;

// =============================================================================
// Send Message Request
// =============================================================================

export const SendMessageRequestSchema = z.object({
  content: z.string().min(1).max(10000),
});

export type SendMessageRequest = z.infer<typeof SendMessageRequestSchema>;

// =============================================================================
// Create Secret Request
// =============================================================================

export const CreateSecretRequestSchema = z.object({
  provider: SecretProviderSchema,
  name: z.string().min(1).max(255),
  value: z.string().min(1), // The raw secret value (will be encrypted server-side)
});

export type CreateSecretRequest = z.infer<typeof CreateSecretRequestSchema>;

// =============================================================================
// Update Secret Request
// =============================================================================

export const UpdateSecretRequestSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  value: z.string().min(1).optional(),
});

export type UpdateSecretRequest = z.infer<typeof UpdateSecretRequestSchema>;

// =============================================================================
// Pagination Request
// =============================================================================

export const PaginationRequestSchema = z.object({
  page: z.number().int().positive().default(1),
  limit: z.number().int().positive().max(100).default(20),
});

export type PaginationRequest = z.infer<typeof PaginationRequestSchema>;

// =============================================================================
// Auth Requests
// =============================================================================

/**
 * Register a new user
 */
export const RegisterRequestSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  displayName: z.string().max(255).optional(),
});

export type RegisterRequest = z.infer<typeof RegisterRequestSchema>;

/**
 * Login with email and password
 */
export const LoginRequestSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

export type LoginRequest = z.infer<typeof LoginRequestSchema>;

/**
 * Refresh access token using refresh token
 */
export const RefreshTokenRequestSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
});

export type RefreshTokenRequest = z.infer<typeof RefreshTokenRequestSchema>;

/**
 * Logout (invalidate refresh token)
 */
export const LogoutRequestSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
});

export type LogoutRequest = z.infer<typeof LogoutRequestSchema>;
