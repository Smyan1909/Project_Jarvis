// =============================================================================
// MCP Client Manager
// =============================================================================
// Manages multiple MCP server clients with tool aggregation and routing

import type {
  MCPServerConfig,
  MCPServerStatus,
  MCPTool,
  MCPToolResult,
  ToolDefinition,
} from '@project-jarvis/shared-types';
import type { MCPClientPort, MCPClientManagerPort, MCPClientEvents } from '../../ports/MCPClientPort.js';
import { MCPClientAdapter } from './MCPClientAdapter.js';
import {
  convertMCPToolsToDefinitions,
  parseToolId,
  isMCPToolId,
  convertMCPToolResult,
  normalizeServerName,
  MCP_TOOL_SEPARATOR,
} from './MCPToolConverter.js';
import { logger } from '../../infrastructure/logging/logger.js';
import type { ComposioSessionManager } from '../../application/services/ComposioSessionManager.js';

const log = logger.child({ module: 'MCPClientManager' });

/**
 * Name used for Composio MCP servers
 */
const COMPOSIO_SERVER_NAME = 'composio';

/**
 * Interface for loading MCP server configurations
 */
export interface MCPConfigLoader {
  loadConfigurations(): Promise<MCPServerConfig[]>;
}

/**
 * MCP Client Manager
 *
 * Manages multiple MCP server clients, providing:
 * - Centralized configuration loading from database
 * - Tool aggregation across all servers
 * - Automatic routing of tool calls to appropriate servers
 * - Health monitoring and graceful degradation
 * - Hot-reload of configurations
 */
export class MCPClientManager implements MCPClientManagerPort {
  private clients: Map<string, MCPClientAdapter> = new Map();
  private serverNameToId: Map<string, string> = new Map();
  private eventHandlers: MCPClientEvents = {};
  private initialized = false;

  // Per-user Composio clients: Map<userId, MCPClientAdapter>
  private composioClients: Map<string, MCPClientAdapter> = new Map();
  private composioSessionManager: ComposioSessionManager | null = null;

  constructor(private configLoader: MCPConfigLoader) {}

  /**
   * Set the Composio session manager for per-user session support.
   * This should be called after initialization to enable per-user Composio clients.
   */
  setComposioSessionManager(manager: ComposioSessionManager): void {
    this.composioSessionManager = manager;
    log.info('Composio session manager configured for per-user sessions');
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      log.debug('Manager already initialized');
      return;
    }

    log.info('Initializing MCP Client Manager');

    try {
      const configs = await this.configLoader.loadConfigurations();
      log.info('Loaded MCP server configurations', { count: configs.length });

      for (const config of configs) {
        if (config.enabled) {
          await this.addClient(config);
        }
      }

      this.initialized = true;
      log.info('MCP Client Manager initialized', {
        activeServers: this.clients.size,
      });
    } catch (error) {
      log.error('Failed to initialize MCP Client Manager', error);
      throw error;
    }
  }

  async shutdown(): Promise<void> {
    log.info('Shutting down MCP Client Manager');

    const disconnectPromises: Promise<void>[] = [];

    for (const client of this.clients.values()) {
      disconnectPromises.push(
        client.disconnect().catch((error) => {
          log.warn('Error disconnecting client', { error, serverId: client.getConfig().id });
        })
      );
    }

    await Promise.all(disconnectPromises);

    this.clients.clear();
    this.serverNameToId.clear();
    this.initialized = false;

    log.info('MCP Client Manager shut down');
  }

  getServerIds(): string[] {
    return Array.from(this.clients.keys());
  }

  getClient(serverId: string): MCPClientPort | undefined {
    return this.clients.get(serverId);
  }

  getAllServerStatus(): MCPServerStatus[] {
    return Array.from(this.clients.values()).map((client) => client.getStatus());
  }

  async getAllTools(): Promise<MCPTool[]> {
    const allTools: MCPTool[] = [];
    const fetchPromises: Promise<void>[] = [];

    for (const client of this.clients.values()) {
      const config = client.getConfig();
      if (!config.enabled) {
        continue;
      }

      fetchPromises.push(
        client
          .listTools()
          .then((tools) => {
            // Prefix tool names with server name
            const normalizedName = normalizeServerName(config.name);
            const prefixedTools = tools.map((tool) => ({
              ...tool,
              name: `${normalizedName}${MCP_TOOL_SEPARATOR}${tool.name}`,
            }));
            allTools.push(...prefixedTools);
          })
          .catch((error) => {
            log.warn('Failed to fetch tools from server', {
              serverId: config.id,
              serverName: config.name,
              error: error instanceof Error ? error.message : String(error),
            });
            // Graceful degradation - continue with other servers
          })
      );
    }

    await Promise.all(fetchPromises);

    log.debug('Aggregated tools from all servers', { totalCount: allTools.length });
    return allTools;
  }

  /**
   * Get all tools converted to ToolDefinition format
   *
   * This is the main method used by the CompositeToolInvoker
   */
  async getToolDefinitions(): Promise<ToolDefinition[]> {
    const allDefinitions: ToolDefinition[] = [];

    for (const client of this.clients.values()) {
      const config = client.getConfig();
      if (!config.enabled) {
        continue;
      }

      try {
        const tools = await client.listTools();
        const normalizedName = normalizeServerName(config.name);
        const definitions = convertMCPToolsToDefinitions(tools, normalizedName);
        allDefinitions.push(...definitions);
      } catch (error) {
        log.warn('Failed to get tool definitions from server', {
          serverId: config.id,
          serverName: config.name,
          error: error instanceof Error ? error.message : String(error),
        });
        // Graceful degradation
      }
    }

    return allDefinitions;
  }

  isRemoteTool(toolId: string): boolean {
    return isMCPToolId(toolId);
  }

  parseToolId(toolId: string): [string, string] | null {
    return parseToolId(toolId);
  }

  async invokeTool(
    userId: string,
    toolId: string, 
    args: Record<string, unknown>
  ): Promise<MCPToolResult> {
    const parsed = parseToolId(toolId);
    if (!parsed) {
      throw new Error(`Invalid MCP tool ID: ${toolId}`);
    }

    const [serverName, toolName] = parsed;

    // Special handling for Composio - use per-user clients
    if (serverName === COMPOSIO_SERVER_NAME && this.composioSessionManager) {
      const client = await this.getOrCreateComposioClient(userId);
      log.debug('Invoking Composio tool with per-user client', { 
        userId, 
        toolId, 
        toolName 
      });
      return client.callTool(toolName, args);
    }

    // Default: use shared client for non-Composio servers
    const serverId = this.serverNameToId.get(serverName);

    if (!serverId) {
      throw new Error(`MCP server not found: ${serverName}`);
    }

    const client = this.clients.get(serverId);
    if (!client) {
      throw new Error(`MCP client not found for server: ${serverName}`);
    }

    log.debug('Invoking MCP tool', { toolId, serverName, toolName });

    return client.callTool(toolName, args);
  }

  /**
   * Invoke a tool and convert result to our ToolResult format
   *
   * This is the main method used by the CompositeToolInvoker
   * 
   * @param userId - The user invoking the tool (required for per-user Composio sessions)
   * @param toolId - The tool ID to invoke
   * @param args - Tool arguments
   */
  async invokeToolAsToolResult(
    userId: string,
    toolId: string,
    args: Record<string, unknown>
  ): Promise<{ success: boolean; output: unknown; error?: string }> {
    try {
      // Only preprocess args for COMPOSIO_MULTI_EXECUTE_TOOL
      // This tool has an 'arguments' field that we converted to a JSON string for OpenAI compatibility
      // Other tools like unified__execute_tool have argsJson which should remain a string
      let processedArgs = args;
      if (toolId.includes('COMPOSIO_MULTI_EXECUTE_TOOL')) {
        log.debug('Preprocessing Composio tool args', { toolId, args: JSON.stringify(args) });
        processedArgs = this.preprocessComposioArgs(args);
        log.debug('Processed Composio args', { toolId, processedArgs: JSON.stringify(processedArgs) });
      }
      
      const result = await this.invokeTool(userId, toolId, processedArgs);
      return convertMCPToolResult(result);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error('MCP tool invocation failed', { userId, toolId, error: errorMessage });
      return {
        success: false,
        output: null,
        error: errorMessage,
      };
    }
  }

  /**
   * Preprocess COMPOSIO_MULTI_EXECUTE_TOOL arguments.
   * 
   * This tool has a 'tools' array where each item has an 'arguments' field.
   * We converted the 'arguments' field to a JSON string for OpenAI strict mode compatibility.
   * Now we need to parse those JSON strings back to objects for the MCP tool.
   */
  private preprocessComposioArgs(args: Record<string, unknown>): Record<string, unknown> {
    const processed: Record<string, unknown> = { ...args };
    
    // The COMPOSIO_MULTI_EXECUTE_TOOL has a 'tools' array
    if (Array.isArray(args.tools)) {
      processed.tools = args.tools.map((toolItem: unknown) => {
        if (typeof toolItem !== 'object' || toolItem === null) {
          return toolItem;
        }
        
        const item = toolItem as Record<string, unknown>;
        const processedItem: Record<string, unknown> = { ...item };
        
        // Parse the 'arguments' field if it's a JSON string
        if (typeof item.arguments === 'string') {
          const trimmed = item.arguments.trim();
          if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
            try {
              processedItem.arguments = JSON.parse(item.arguments);
              log.debug('Parsed Composio arguments JSON string', { 
                toolSlug: item.tool_slug,
                originalLength: item.arguments.length 
              });
            } catch {
              // Keep as string if parsing fails
              log.warn('Failed to parse Composio arguments JSON', { 
                toolSlug: item.tool_slug,
                value: item.arguments.slice(0, 100) 
              });
            }
          }
        }
        
        return processedItem;
      });
    }
    
    return processed;
  }

  async refreshConfigurations(): Promise<void> {
    log.info('Refreshing MCP server configurations');

    const configs = await this.configLoader.loadConfigurations();
    const currentIds = new Set(this.clients.keys());
    const newIds = new Set(configs.map((c) => c.id));

    // Remove clients for deleted servers
    for (const id of currentIds) {
      if (!newIds.has(id)) {
        await this.removeClient(id);
      }
    }

    // Add or update clients
    for (const config of configs) {
      if (currentIds.has(config.id)) {
        // Update existing client if config changed
        const existingClient = this.clients.get(config.id)!;
        const existingConfig = existingClient.getConfig();

        if (this.hasConfigChanged(existingConfig, config)) {
          await this.removeClient(config.id);
          if (config.enabled) {
            await this.addClient(config);
          }
        } else if (!config.enabled && existingConfig.enabled) {
          // Server was disabled
          await this.removeClient(config.id);
        } else if (config.enabled && !existingConfig.enabled) {
          // Server was enabled
          await this.addClient(config);
        }
      } else if (config.enabled) {
        // New server
        await this.addClient(config);
      }
    }

    log.info('Configuration refresh complete', {
      activeServers: this.clients.size,
    });
  }

  async reconnectServer(serverId: string): Promise<void> {
    const client = this.clients.get(serverId);
    if (!client) {
      throw new Error(`Server not found: ${serverId}`);
    }

    log.info('Reconnecting to server', { serverId });

    await client.disconnect();
    await client.connect();
  }

  setEventHandlers(handlers: MCPClientEvents): void {
    this.eventHandlers = handlers;

    // Propagate to all clients
    for (const client of this.clients.values()) {
      client.setEventHandlers(handlers);
    }
  }

  // =========================================================================
  // Private Methods
  // =========================================================================

  private async addClient(config: MCPServerConfig): Promise<void> {
    const normalizedName = normalizeServerName(config.name);

    // Check for name conflicts
    if (this.serverNameToId.has(normalizedName)) {
      const existingId = this.serverNameToId.get(normalizedName);
      if (existingId !== config.id) {
        log.warn('Server name conflict - appending ID suffix', {
          name: config.name,
          normalizedName,
          existingId,
          newId: config.id,
        });
        // Use ID as suffix to avoid conflicts
        this.serverNameToId.set(`${normalizedName}_${config.id.slice(0, 8)}`, config.id);
      }
    } else {
      this.serverNameToId.set(normalizedName, config.id);
    }

    const client = new MCPClientAdapter(config);
    client.setEventHandlers(this.eventHandlers);

    this.clients.set(config.id, client);

    log.info('Added MCP client', {
      serverId: config.id,
      serverName: config.name,
      transport: config.transport,
    });

    // Lazy connection - don't connect now, connect on first use
  }

  private async removeClient(serverId: string): Promise<void> {
    const client = this.clients.get(serverId);
    if (!client) {
      return;
    }

    const config = client.getConfig();
    const normalizedName = normalizeServerName(config.name);

    try {
      await client.disconnect();
    } catch (error) {
      log.warn('Error disconnecting client during removal', { serverId, error });
    }

    this.clients.delete(serverId);
    this.serverNameToId.delete(normalizedName);

    log.info('Removed MCP client', { serverId, serverName: config.name });
  }

  private hasConfigChanged(oldConfig: MCPServerConfig, newConfig: MCPServerConfig): boolean {
    return (
      oldConfig.url !== newConfig.url ||
      oldConfig.transport !== newConfig.transport ||
      oldConfig.authType !== newConfig.authType ||
      JSON.stringify(oldConfig.authConfig) !== JSON.stringify(newConfig.authConfig) ||
      oldConfig.connectionTimeoutMs !== newConfig.connectionTimeoutMs ||
      oldConfig.requestTimeoutMs !== newConfig.requestTimeoutMs ||
      oldConfig.maxRetries !== newConfig.maxRetries
    );
  }

  /**
   * Get or create a per-user Composio MCP client.
   * 
   * Creates a session for the user if one doesn't exist, then creates
   * an MCPClientAdapter connected to the user's personal Composio MCP endpoint.
   */
  private async getOrCreateComposioClient(userId: string): Promise<MCPClientAdapter> {
    // Check cache first
    if (this.composioClients.has(userId)) {
      const cachedClient = this.composioClients.get(userId)!;
      log.debug('Using cached Composio client', { userId });
      return cachedClient;
    }

    if (!this.composioSessionManager) {
      throw new Error('Composio session manager not configured');
    }

    log.info('Creating per-user Composio client', { userId });

    // Get or create session for this user
    const session = await this.composioSessionManager.getOrCreateSession(userId);

    // Create MCP config from session
    const config: MCPServerConfig = {
      id: `composio-user-${userId}`,
      name: COMPOSIO_SERVER_NAME,
      description: `Per-user Composio session for ${userId}`,
      url: session.mcp.url,
      transport: 'streamable-http',
      enabled: true,
      authType: 'none', // Auth is handled by the session URL
      authConfig: { type: 'none' },
      connectionTimeoutMs: 30000,
      requestTimeoutMs: 120000,
      maxRetries: 3,
      priority: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Create and connect client
    const client = new MCPClientAdapter(config);
    client.setEventHandlers(this.eventHandlers);

    // Store in cache
    this.composioClients.set(userId, client);

    log.info('Created per-user Composio client', { 
      userId, 
      sessionId: session.sessionId 
    });

    return client;
  }

  /**
   * Clear a user's Composio client from the cache.
   * Call this when a user's session is refreshed.
   */
  async clearComposioClient(userId: string): Promise<void> {
    const client = this.composioClients.get(userId);
    if (client) {
      try {
        await client.disconnect();
      } catch (error) {
        log.warn('Error disconnecting Composio client', { userId, error });
      }
      this.composioClients.delete(userId);
      log.info('Cleared Composio client', { userId });
    }
  }
}

/**
 * Create an MCP Client Manager with a database-backed config loader
 */
export function createMCPClientManager(configLoader: MCPConfigLoader): MCPClientManager {
  return new MCPClientManager(configLoader);
}
