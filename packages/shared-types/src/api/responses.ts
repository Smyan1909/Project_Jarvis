import { z } from 'zod';
import { AgentRunStatusSchema } from '../domain/agent.js';
import { SecretProviderSchema } from '../domain/user.js';

// =============================================================================
// Generic API Response Wrapper
// =============================================================================

export const ApiResponseSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.object({
    data: dataSchema,
  });

export interface ApiResponse<T> {
  data: T;
}

// =============================================================================
// API Error Response
// =============================================================================

export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});

export type ApiError = z.infer<typeof ApiErrorSchema>;

// =============================================================================
// Pagination Info
// =============================================================================

export const PaginationInfoSchema = z.object({
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  limit: z.number().int().positive(),
  hasMore: z.boolean(),
});

export type PaginationInfo = z.infer<typeof PaginationInfoSchema>;

// =============================================================================
// Paginated Response
// =============================================================================

export const PaginatedResponseSchema = <T extends z.ZodTypeAny>(itemSchema: T) =>
  z.object({
    data: z.array(itemSchema),
    pagination: PaginationInfoSchema,
  });

export interface PaginatedResponse<T> {
  data: T[];
  pagination: PaginationInfo;
}

// =============================================================================
// Agent Run Response
// =============================================================================

export const AgentRunResponseSchema = z.object({
  id: z.string().uuid(),
  status: AgentRunStatusSchema,
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
  totalTokens: z.number().int().nonnegative().optional(),
  totalCost: z.number().nonnegative().optional(),
});

export type AgentRunResponse = z.infer<typeof AgentRunResponseSchema>;

// =============================================================================
// Secret Response (without the encrypted value)
// =============================================================================

export const SecretResponseSchema = z.object({
  id: z.string().uuid(),
  provider: SecretProviderSchema,
  name: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type SecretResponse = z.infer<typeof SecretResponseSchema>;

// =============================================================================
// Message Response
// =============================================================================

export const MessageResponseSchema = z.object({
  id: z.string().uuid(),
  role: z.enum(['user', 'assistant', 'system', 'tool']),
  content: z.string(),
  createdAt: z.string().datetime(),
});

export type MessageResponse = z.infer<typeof MessageResponseSchema>;

// =============================================================================
// Auth Response
// =============================================================================

export const AuthResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresIn: z.number().int().positive(), // Seconds until access token expires
});

export type AuthResponse = z.infer<typeof AuthResponseSchema>;

// =============================================================================
// User Profile Response
// =============================================================================

export const UserProfileResponseSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  displayName: z.string().nullable(),
  createdAt: z.string().datetime(),
});

export type UserProfileResponse = z.infer<typeof UserProfileResponseSchema>;
