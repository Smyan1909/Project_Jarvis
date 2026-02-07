// =============================================================================
// MCP Servers Module
// =============================================================================
// Unified MCP servers module providing:
// 1. Composio Tool Router - OAuth connection management for external services
// 2. Unified MCP Server - Claude Code + Playwright automation with dynamic tool routing

// =============================================================================
// Configuration
// =============================================================================

export {
  SUPPORTED_TOOLKITS,
  ENABLED_TOOLKIT_SLUGS,
  MANAGED_AUTH_TOOLKIT_SLUGS,
  loadEnvConfig,
  getToolkitInfo,
  isToolkitSupported,
  type SupportedAppKey,
  type ToolkitSlug,
  type ComposioEnvConfig,
} from './config.js';

// =============================================================================
// Client
// =============================================================================

export {
  getComposioClient,
  getEnvConfig,
  resetClient,
  createComposioClient,
} from './client.js';

// =============================================================================
// Types
// =============================================================================

export {
  // Request schemas
  CreateSessionRequestSchema,
  InitiateConnectionRequestSchema,
  AppParamSchema,
  SessionIdParamSchema,
  ConnectionIdParamSchema,
  AccountIdParamSchema,
  UserIdQuerySchema,
  ExecuteToolRequestSchema,
  // Request types
  type CreateSessionRequest,
  type InitiateConnectionRequest,
  type ExecuteToolRequest,
  // Response types
  type MCPServerInfo,
  type SessionInfo,
  type AppWithStatus,
  type ConnectionRequest,
  type ConnectionStatus,
  type ConnectedAccountInfo,
  type ToolkitStatus,
  // Error types
  type ApiErrorResponse,
  createErrorResponse,
  // Options types
  type CreateSessionOptions,
} from './types.js';

// =============================================================================
// Service
// =============================================================================

export {
  ComposioIntegrationService,
  createComposioIntegrationService,
} from './service/ComposioIntegrationService.js';

// =============================================================================
// Routes
// =============================================================================

export {
  createComposioRoutes,
  type ComposioRouteDependencies,
} from './routes/composio.js';

// =============================================================================
// Convenience Factory
// =============================================================================

import { Composio } from '@composio/core';
import type { Hono } from 'hono';
import { getComposioClient, getEnvConfig } from './client.js';
import { createComposioIntegrationService } from './service/ComposioIntegrationService.js';
import { createComposioRoutes } from './routes/composio.js';

/**
 * Options for creating Composio routes with defaults.
 */
export interface CreateComposioModuleOptions {
  /** Override the Composio API key (defaults to COMPOSIO_API_KEY env var) */
  apiKey?: string;
  /** Override the callback URL scheme (defaults to COMPOSIO_CALLBACK_SCHEME env var) */
  callbackScheme?: string;
}

/**
 * Create a fully configured Composio routes module.
 * Uses environment variables for configuration by default.
 *
 * @example
 * ```typescript
 * import { createComposioModule } from '@project-jarvis/mcp-servers';
 *
 * const app = new Hono();
 * app.route('/api/v1/composio', createComposioModule());
 * ```
 */
export function createComposioModule(
  options?: CreateComposioModuleOptions
): Hono {
  // Use provided API key or get from environment
  const client = options?.apiKey
    ? new Composio({ apiKey: options.apiKey })
    : getComposioClient();

  // Use provided callback scheme or get from environment
  const callbackScheme = options?.callbackScheme ?? getEnvConfig().callbackScheme;

  // Create service and routes
  const service = createComposioIntegrationService(client, callbackScheme);
  return createComposioRoutes({ composioService: service });
}

// =============================================================================
// Unified MCP Server (Claude Code + Playwright)
// =============================================================================

export {
  // Main server
  MCPServer,
  startUnifiedServer,
  // Configuration
  getConfig as getUnifiedServerConfig,
  resetConfig as resetUnifiedServerConfig,
  type UnifiedServerConfig,
  type PlaywrightConfig,
  type ServerConfig,
  // Tool router
  toolRouter,
  ToolRouter,
  type RegisteredTool,
  type ToolResult,
  type ToolResultContent,
  type ToolHandler,
  type ToolSummary,
  type ListToolsResponse,
  type GetToolSchemaResponse,
  type SuggestToolsResponse,
  type ToolSuggestion,
  // Meta-tool schemas
  metaToolSchemas,
  listAvailableToolsSchema,
  getToolSchemaSchema,
  executeToolSchema,
  suggestToolsSchema,
  claudeCodeSchema,
  // Tool management
  registerAllTools,
  cleanupTools,
  initializePlaywright,
  cleanupPlaywright,
  // Browser access
  browserManager,
  sessionManager,
  // Logging
  log as unifiedServerLog,
  Logger,
} from './unified-server/index.js';
