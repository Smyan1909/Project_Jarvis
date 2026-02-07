// =============================================================================
// Unified MCP Server
// =============================================================================
// Combines Claude Code and Playwright capabilities into a single MCP server
// with dynamic tool routing to minimize context usage

// Re-export main server class
export { MCPServer } from './server.js';

// Re-export configuration
export { getConfig, resetConfig, type UnifiedServerConfig, type PlaywrightConfig, type ServerConfig } from './config.js';

// Re-export tool router
export { toolRouter, ToolRouter } from './router/index.js';
export type {
  RegisteredTool,
  ToolResult,
  ToolResultContent,
  ToolHandler,
  ToolSummary,
  ListToolsResponse,
  GetToolSchemaResponse,
  SuggestToolsResponse,
  ToolSuggestion,
} from './router/types.js';

// Re-export meta-tool schemas for reference
export {
  metaToolSchemas,
  listAvailableToolsSchema,
  getToolSchemaSchema,
  executeToolSchema,
  suggestToolsSchema,
  claudeCodeSchema,
} from './router/meta-tools.js';

// Re-export tool registration
export { registerAllTools, cleanupTools, initializePlaywright, cleanupPlaywright } from './tools/index.js';

// Re-export browser manager for direct access if needed
export { browserManager } from './tools/playwright/browser-manager.js';
export { sessionManager } from './tools/playwright/session-manager.js';

// Re-export logger
export { log, Logger } from './utils/logger.js';

// =============================================================================
// Convenience Function to Start Server
// =============================================================================

import { MCPServer } from './server.js';
import { log } from './utils/logger.js';

/**
 * Start the unified MCP server
 * 
 * @example
 * ```typescript
 * import { startUnifiedServer } from '@project-jarvis/mcp-servers/unified-server';
 * 
 * await startUnifiedServer();
 * ```
 */
export async function startUnifiedServer(): Promise<MCPServer> {
  const server = new MCPServer();

  // Handle graceful shutdown
  const shutdown = async (signal: string) => {
    log.info(`Received ${signal}, shutting down...`);
    await server.stop();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  await server.start();
  
  return server;
}
