// =============================================================================
// MCP Client Port
// =============================================================================
// Interface for MCP client operations
// Abstracts communication with MCP servers for tool discovery and invocation

import type {
  MCPServerConfig,
  MCPServerInfo,
  MCPServerStatus,
  MCPTool,
  MCPToolResult,
  MCPConnectionState,
} from '@project-jarvis/shared-types';

/**
 * Event emitter interface for MCP client events
 */
export interface MCPClientEvents {
  onConnectionStateChange?: (
    serverId: string,
    previousState: MCPConnectionState,
    newState: MCPConnectionState
  ) => void;
  onToolsDiscovered?: (serverId: string, tools: MCPTool[]) => void;
  onError?: (serverId: string, error: Error) => void;
}

/**
 * Port interface for a single MCP server client
 *
 * This port abstracts the connection and communication with a single MCP server.
 * Implementations handle transport (Streamable HTTP, SSE), authentication,
 * and protocol-level concerns.
 */
export interface MCPClientPort {
  /**
   * Get the server configuration
   */
  getConfig(): MCPServerConfig;

  /**
   * Get current connection state
   */
  getConnectionState(): MCPConnectionState;

  /**
   * Get server status including health metrics
   */
  getStatus(): MCPServerStatus;

  /**
   * Connect to the MCP server
   *
   * Establishes connection and performs initialization handshake.
   * Should be idempotent - calling on an already connected client is a no-op.
   *
   * @throws MCPConnectionError if connection fails
   */
  connect(): Promise<void>;

  /**
   * Disconnect from the MCP server
   *
   * Gracefully closes the connection. Should be idempotent.
   */
  disconnect(): Promise<void>;

  /**
   * Check if client is connected
   */
  isConnected(): boolean;

  /**
   * Get server information from initialization response
   *
   * @returns Server info or null if not connected
   */
  getServerInfo(): MCPServerInfo | null;

  /**
   * List all available tools from this server
   *
   * Caches results with TTL-based refresh. Returns cached results if available.
   *
   * @param forceRefresh - Force refresh from server, ignoring cache
   * @returns Array of tool definitions
   * @throws MCPConnectionError if not connected and connection fails
   */
  listTools(forceRefresh?: boolean): Promise<MCPTool[]>;

  /**
   * Call a tool on this server
   *
   * @param toolName - Name of the tool to call
   * @param args - Arguments to pass to the tool
   * @returns Tool execution result
   * @throws MCPToolNotFoundError if tool doesn't exist
   * @throws MCPToolExecutionError if tool execution fails
   * @throws MCPConnectionError if not connected
   */
  callTool(toolName: string, args: Record<string, unknown>): Promise<MCPToolResult>;

  /**
   * Set event handlers
   */
  setEventHandlers(handlers: MCPClientEvents): void;
}

/**
 * Port interface for managing multiple MCP server clients
 *
 * This port provides aggregate operations across all configured MCP servers,
 * including tool discovery, invocation routing, and health monitoring.
 */
export interface MCPClientManagerPort {
  /**
   * Initialize the manager with server configurations
   *
   * Loads configurations and prepares clients (lazy connection by default).
   */
  initialize(): Promise<void>;

  /**
   * Shutdown all clients gracefully
   */
  shutdown(): Promise<void>;

  /**
   * Get all configured server IDs
   */
  getServerIds(): string[];

  /**
   * Get a specific client by server ID
   */
  getClient(serverId: string): MCPClientPort | undefined;

  /**
   * Get status for all servers
   */
  getAllServerStatus(): MCPServerStatus[];

  /**
   * Get all tools from all connected servers
   *
   * Tool names are prefixed with server identifier to avoid conflicts.
   * Format: `serverName__toolName`
   *
   * @returns Aggregated tools from all servers
   */
  getAllTools(): Promise<MCPTool[]>;

  /**
   * Check if a tool ID is from an MCP server (has server prefix)
   */
  isRemoteTool(toolId: string): boolean;

  /**
   * Parse a tool ID to extract server name and tool name
   *
   * @returns [serverName, toolName] or null if not a valid MCP tool ID
   */
  parseToolId(toolId: string): [string, string] | null;

  /**
   * Invoke a tool on the appropriate server
   *
   * Automatically routes to the correct server based on tool ID prefix.
   * For Composio tools, uses per-user sessions based on userId.
   *
   * @param userId - User ID for per-user session routing
   * @param toolId - Full tool ID including server prefix
   * @param args - Tool arguments
   * @returns Tool execution result
   */
  invokeTool(userId: string, toolId: string, args: Record<string, unknown>): Promise<MCPToolResult>;

  /**
   * Refresh server configuration from database
   *
   * Adds new servers, removes deleted ones, updates changed configs.
   */
  refreshConfigurations(): Promise<void>;

  /**
   * Force reconnect to a specific server
   */
  reconnectServer(serverId: string): Promise<void>;

  /**
   * Set event handlers for all clients
   */
  setEventHandlers(handlers: MCPClientEvents): void;
}
