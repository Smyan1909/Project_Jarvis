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

const log = logger.child({ module: 'MCPClientManager' });

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

  constructor(private configLoader: MCPConfigLoader) {}

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

  async invokeTool(toolId: string, args: Record<string, unknown>): Promise<MCPToolResult> {
    const parsed = parseToolId(toolId);
    if (!parsed) {
      throw new Error(`Invalid MCP tool ID: ${toolId}`);
    }

    const [serverName, toolName] = parsed;
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
   */
  async invokeToolAsToolResult(
    toolId: string,
    args: Record<string, unknown>
  ): Promise<{ success: boolean; output: unknown; error?: string }> {
    try {
      const result = await this.invokeTool(toolId, args);
      return convertMCPToolResult(result);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error('MCP tool invocation failed', { toolId, error: errorMessage });
      return {
        success: false,
        output: null,
        error: errorMessage,
      };
    }
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
}

/**
 * Create an MCP Client Manager with a database-backed config loader
 */
export function createMCPClientManager(configLoader: MCPConfigLoader): MCPClientManager {
  return new MCPClientManager(configLoader);
}
