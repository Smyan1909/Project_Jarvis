import { z } from 'zod';

// =============================================================================
// MCP Transport Type
// =============================================================================

export const MCPTransportTypeSchema = z.enum(['streamable-http', 'sse']);

export type MCPTransportType = z.infer<typeof MCPTransportTypeSchema>;

// =============================================================================
// MCP Auth Type
// =============================================================================

export const MCPAuthTypeSchema = z.enum(['oauth', 'api-key', 'none']);

export type MCPAuthType = z.infer<typeof MCPAuthTypeSchema>;

// =============================================================================
// MCP OAuth Config
// =============================================================================

export const MCPOAuthConfigSchema = z.object({
  clientId: z.string(),
  clientSecret: z.string(), // Should be encrypted at rest
  tokenUrl: z.string().url(),
  authorizationUrl: z.string().url().optional(),
  scopes: z.array(z.string()).optional(),
  // Cached tokens (managed internally)
  accessToken: z.string().optional(),
  refreshToken: z.string().optional(),
  expiresAt: z.number().optional(), // Unix timestamp
});

export type MCPOAuthConfig = z.infer<typeof MCPOAuthConfigSchema>;

// =============================================================================
// MCP API Key Config
// =============================================================================

export const MCPApiKeyConfigSchema = z.object({
  apiKey: z.string(), // Should be encrypted at rest
  headerName: z.string().default('Authorization'),
  headerPrefix: z.string().default('Bearer'), // e.g., "Bearer", "Api-Key", or empty
});

export type MCPApiKeyConfig = z.infer<typeof MCPApiKeyConfigSchema>;

// =============================================================================
// MCP Auth Config (Union)
// =============================================================================

export const MCPAuthConfigSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('oauth'),
    oauth: MCPOAuthConfigSchema,
  }),
  z.object({
    type: z.literal('api-key'),
    apiKey: MCPApiKeyConfigSchema,
  }),
  z.object({
    type: z.literal('none'),
  }),
]);

export type MCPAuthConfig = z.infer<typeof MCPAuthConfigSchema>;

// =============================================================================
// MCP Server Config
// =============================================================================

export const MCPServerConfigSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(255),
  description: z.string().max(1024).optional(),
  url: z.string().url(),
  headers: z.record(z.string(), z.string()).optional(),
  transport: MCPTransportTypeSchema,
  authType: MCPAuthTypeSchema,
  authConfig: MCPAuthConfigSchema.optional(),
  enabled: z.boolean().default(true),
  priority: z.number().int().min(0).default(0), // Higher = higher priority
  // Timeouts and retry config
  connectionTimeoutMs: z.number().int().positive().default(30000),
  requestTimeoutMs: z.number().int().positive().default(60000),
  maxRetries: z.number().int().min(0).default(3),
  // Metadata
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type MCPServerConfig = z.infer<typeof MCPServerConfigSchema>;

// =============================================================================
// MCP Server Status
// =============================================================================

export const MCPServerStatusSchema = z.object({
  serverId: z.string().uuid(),
  serverName: z.string(),
  connected: z.boolean(),
  lastConnectedAt: z.date().optional(),
  lastErrorAt: z.date().optional(),
  lastError: z.string().optional(),
  toolCount: z.number().int().nonnegative(),
  // Health metrics
  consecutiveFailures: z.number().int().nonnegative().default(0),
  totalRequests: z.number().int().nonnegative().default(0),
  successfulRequests: z.number().int().nonnegative().default(0),
  averageLatencyMs: z.number().nonnegative().optional(),
});

export type MCPServerStatus = z.infer<typeof MCPServerStatusSchema>;

// =============================================================================
// MCP Tool (as returned from MCP server)
// =============================================================================

export const MCPToolSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  inputSchema: z.record(z.string(), z.unknown()), // JSON Schema
});

export type MCPTool = z.infer<typeof MCPToolSchema>;

// =============================================================================
// MCP Tool Result
// =============================================================================

export const MCPToolResultSchema = z.object({
  content: z.array(
    z.object({
      type: z.enum(['text', 'image', 'resource']),
      text: z.string().optional(),
      data: z.string().optional(), // Base64 for images
      mimeType: z.string().optional(),
      resource: z.record(z.string(), z.unknown()).optional(),
    })
  ),
  isError: z.boolean().optional(),
});

export type MCPToolResult = z.infer<typeof MCPToolResultSchema>;

// =============================================================================
// MCP Server Info (from initialize response)
// =============================================================================

export const MCPServerInfoSchema = z.object({
  name: z.string(),
  version: z.string(),
  protocolVersion: z.string(),
  capabilities: z.object({
    tools: z.boolean().optional(),
    resources: z.boolean().optional(),
    prompts: z.boolean().optional(),
    logging: z.boolean().optional(),
  }),
});

export type MCPServerInfo = z.infer<typeof MCPServerInfoSchema>;

// =============================================================================
// MCP Connection State
// =============================================================================

export const MCPConnectionStateSchema = z.enum([
  'disconnected',
  'connecting',
  'connected',
  'reconnecting',
  'failed',
]);

export type MCPConnectionState = z.infer<typeof MCPConnectionStateSchema>;

// =============================================================================
// Create/Update DTOs
// =============================================================================

export const CreateMCPServerConfigSchema = MCPServerConfigSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type CreateMCPServerConfig = z.infer<typeof CreateMCPServerConfigSchema>;

export const UpdateMCPServerConfigSchema = MCPServerConfigSchema.partial().omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type UpdateMCPServerConfig = z.infer<typeof UpdateMCPServerConfigSchema>;
