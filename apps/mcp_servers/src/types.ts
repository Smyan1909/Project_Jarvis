// =============================================================================
// Composio Integration Types
// =============================================================================
// Zod schemas and TypeScript types for API requests/responses

import { z } from 'zod';

// =============================================================================
// Request Schemas
// =============================================================================

/**
 * Schema for creating a new Tool Router session
 */
export const CreateSessionRequestSchema = z.object({
  userId: z.string().min(1, 'userId is required'),
  /** Optional: disable in-chat connection management */
  manageConnections: z.boolean().optional().default(false),
  /** Optional: custom callback URL override */
  callbackUrl: z.string().url().optional(),
});

export type CreateSessionRequest = z.infer<typeof CreateSessionRequestSchema>;

/**
 * Schema for initiating an OAuth connection
 */
export const InitiateConnectionRequestSchema = z.object({
  userId: z.string().min(1, 'userId is required'),
  /** Optional: custom callback URL override */
  callbackUrl: z.string().url().optional(),
});

export type InitiateConnectionRequest = z.infer<
  typeof InitiateConnectionRequestSchema
>;

/**
 * Schema for path parameters with app/toolkit identifier
 */
export const AppParamSchema = z.object({
  app: z.string().min(1, 'app is required'),
});

/**
 * Schema for path parameters with session ID
 */
export const SessionIdParamSchema = z.object({
  sessionId: z.string().min(1, 'sessionId is required'),
});

/**
 * Schema for path parameters with connection ID
 */
export const ConnectionIdParamSchema = z.object({
  connectionId: z.string().min(1, 'connectionId is required'),
});

/**
 * Schema for path parameters with account ID
 */
export const AccountIdParamSchema = z.object({
  id: z.string().min(1, 'id is required'),
});

/**
 * Schema for query parameters with userId
 */
export const UserIdQuerySchema = z.object({
  userId: z.string().min(1, 'userId is required'),
});

/**
 * Schema for executing a tool
 */
export const ExecuteToolRequestSchema = z.object({
  userId: z.string().min(1, 'userId is required'),
  toolSlug: z.string().min(1, 'toolSlug is required'),
  arguments: z.record(z.unknown()).optional().default({}),
});

export type ExecuteToolRequest = z.infer<typeof ExecuteToolRequestSchema>;

// =============================================================================
// Response Types
// =============================================================================

/**
 * MCP server connection info returned from session creation
 */
export interface MCPServerInfo {
  type: 'http';
  url: string;
  headers: Record<string, string>;
}

/**
 * Session info returned after creation
 */
export interface SessionInfo {
  sessionId: string;
  mcp: MCPServerInfo;
  /** List of meta tools available in this session */
  metaTools: string[];
  /** Assistive prompt for optimal tool router usage */
  assistivePrompt?: string;
}

/**
 * Supported app with connection status
 */
export interface AppWithStatus {
  key: string;
  slug: string;
  name: string;
  description: string;
  isConnected: boolean;
  connectedAccountId?: string;
}

/**
 * Connection request response for mobile OAuth flow
 */
export interface ConnectionRequest {
  connectionId: string;
  redirectUrl: string;
  expiresAt?: string;
}

/**
 * Connection status response for polling
 */
export interface ConnectionStatus {
  connectionId: string;
  status: 'initiated' | 'active' | 'failed' | 'expired';
  connectedAccount?: ConnectedAccountInfo;
  error?: string;
}

/**
 * Connected account information
 */
export interface ConnectedAccountInfo {
  id: string;
  toolkit: {
    slug: string;
    name: string;
    logo?: string;
  };
  status: string;
  createdAt?: string;
  isDisabled?: boolean;
}

/**
 * Toolkit status for a user
 */
export interface ToolkitStatus {
  slug: string;
  name: string;
  isConnected: boolean;
  connectedAccountId?: string;
}

// =============================================================================
// Error Types
// =============================================================================

/**
 * Standard API error response
 */
export interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

/**
 * Create a standard error response object
 */
export function createErrorResponse(
  code: string,
  message: string,
  details?: unknown
): ApiErrorResponse {
  return {
    error: {
      code,
      message,
      ...(details !== undefined && { details }),
    },
  };
}

// =============================================================================
// Composio SDK Type Helpers
// =============================================================================

/**
 * Options for creating a Tool Router session
 */
export interface CreateSessionOptions {
  /** Enable/disable specific toolkits */
  toolkits?: {
    enabled?: string[];
    disabled?: string[];
  };
  /** Connection management settings */
  manageConnections?: {
    enable?: boolean;
    callbackUrl?: string;
    enableWaitForConnections?: boolean;
  };
  /** User timezone for assistive prompts */
  userTimezone?: string;
}
