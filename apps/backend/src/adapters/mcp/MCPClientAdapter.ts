// =============================================================================
// MCP Client Adapter
// =============================================================================
// Single MCP server client implementation using the official MCP SDK
// Supports Streamable HTTP and SSE transports with lazy connection

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import type {
  MCPServerConfig,
  MCPServerInfo,
  MCPServerStatus,
  MCPTool,
  MCPToolResult,
  MCPConnectionState,
} from '@project-jarvis/shared-types';
import type { MCPClientPort, MCPClientEvents } from '../../ports/MCPClientPort.js';
import { createAuthenticatedFetch } from './MCPAuth.js';
import { logger } from '../../infrastructure/logging/logger.js';
import { createTracer, SpanKind, SpanStatusCode } from '../../infrastructure/observability/index.js';

const log = logger.child({ module: 'MCPClientAdapter' });

// =============================================================================
// Tracing
// =============================================================================

const tracer = createTracer('mcp-client', '1.0.0');

/**
 * Cache configuration for tools
 */
interface ToolCache {
  tools: MCPTool[];
  fetchedAt: number;
  ttlMs: number;
}

/**
 * MCP Client Adapter
 *
 * Implements MCPClientPort for a single MCP server connection.
 * Features:
 * - Lazy connection (connects on first operation)
 * - Automatic reconnection with exponential backoff
 * - Tool caching with TTL
 * - Graceful degradation on failures
 */
export class MCPClientAdapter implements MCPClientPort {
  private client: Client | null = null;
  private transport: Transport | null = null;
  private connectionState: MCPConnectionState = 'disconnected';
  private serverInfo: MCPServerInfo | null = null;
  private toolCache: ToolCache | null = null;
  private eventHandlers: MCPClientEvents = {};

  // Reconnection state
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private baseReconnectDelayMs = 1000;
  private reconnectTimeout: NodeJS.Timeout | null = null;

  // Metrics
  private consecutiveFailures = 0;
  private totalRequests = 0;
  private successfulRequests = 0;
  private latencySum = 0;
  private lastConnectedAt: Date | null = null;
  private lastErrorAt: Date | null = null;
  private lastError: string | null = null;

  // Tool cache TTL (5 minutes)
  private readonly toolCacheTtlMs = 5 * 60 * 1000;

  private log = log.child({ serverId: '' });

  constructor(private config: MCPServerConfig) {
    this.log = log.child({
      serverId: config.id,
      serverName: config.name,
    });
    this.maxReconnectAttempts = config.maxRetries;
  }

  getConfig(): MCPServerConfig {
    return this.config;
  }

  getConnectionState(): MCPConnectionState {
    return this.connectionState;
  }

  getStatus(): MCPServerStatus {
    return {
      serverId: this.config.id,
      serverName: this.config.name,
      connected: this.connectionState === 'connected',
      lastConnectedAt: this.lastConnectedAt ?? undefined,
      lastErrorAt: this.lastErrorAt ?? undefined,
      lastError: this.lastError ?? undefined,
      toolCount: this.toolCache?.tools.length ?? 0,
      consecutiveFailures: this.consecutiveFailures,
      totalRequests: this.totalRequests,
      successfulRequests: this.successfulRequests,
      averageLatencyMs:
        this.successfulRequests > 0 ? this.latencySum / this.successfulRequests : undefined,
    };
  }

  async connect(): Promise<void> {
    if (this.connectionState === 'connected') {
      this.log.debug('Already connected');
      return;
    }

    if (this.connectionState === 'connecting') {
      this.log.debug('Connection already in progress');
      // Wait for the current connection attempt
      await this.waitForConnection();
      return;
    }

    this.setConnectionState('connecting');
    this.log.info('Connecting to MCP server', { url: this.config.url });

    try {
      // Create transport based on configuration
      this.transport = await this.createTransport();

      // Create MCP client
      this.client = new Client(
        {
          name: 'project-jarvis',
          version: '1.0.0',
        },
        {
          capabilities: {
            // Request tools capability from server
          },
        }
      );

      // Connect to the server
      await this.client.connect(this.transport);

      // Store server info from initialization
      const serverInfo = this.client.getServerVersion();
      if (serverInfo) {
        this.serverInfo = {
          name: serverInfo.name,
          version: serverInfo.version,
          protocolVersion: 'unknown', // Protocol version not exposed in this API
          capabilities: {
            tools: true, // We're using tools capability
            resources: false,
            prompts: false,
            logging: false,
          },
        };
      }

      this.setConnectionState('connected');
      this.lastConnectedAt = new Date();
      this.consecutiveFailures = 0;
      this.reconnectAttempts = 0;

      this.log.info('Connected to MCP server', {
        serverInfo: this.serverInfo,
      });

      // Pre-fetch tools
      await this.listTools();
    } catch (error) {
      this.handleConnectionError(error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.client) {
      try {
        await this.client.close();
      } catch (error) {
        this.log.warn('Error during disconnect', error as Record<string, unknown>);
      }
      this.client = null;
    }

    if (this.transport) {
      try {
        await this.transport.close();
      } catch (error) {
        this.log.warn('Error closing transport', error as Record<string, unknown>);
      }
      this.transport = null;
    }

    this.setConnectionState('disconnected');
    this.serverInfo = null;
    this.log.info('Disconnected from MCP server');
  }

  isConnected(): boolean {
    return this.connectionState === 'connected';
  }

  getServerInfo(): MCPServerInfo | null {
    return this.serverInfo;
  }

  async listTools(forceRefresh = false): Promise<MCPTool[]> {
    // Check cache first
    if (!forceRefresh && this.toolCache) {
      const age = Date.now() - this.toolCache.fetchedAt;
      if (age < this.toolCache.ttlMs) {
        this.log.debug('Returning cached tools', { count: this.toolCache.tools.length });
        return this.toolCache.tools;
      }
    }

    // Ensure we're connected
    await this.ensureConnected();

    const startTime = Date.now();
    this.totalRequests++;

    try {
      const result = await this.client!.listTools();
      const latency = Date.now() - startTime;

      this.successfulRequests++;
      this.latencySum += latency;
      this.consecutiveFailures = 0;

      // Convert SDK tools to our format
      const tools = result.tools.map((tool: Tool) => this.convertSDKTool(tool));

      // Update cache
      this.toolCache = {
        tools,
        fetchedAt: Date.now(),
        ttlMs: this.toolCacheTtlMs,
      };

      this.log.info('Tools fetched', { count: tools.length, latencyMs: latency });

      // Emit discovery event
      if (this.eventHandlers.onToolsDiscovered) {
        this.eventHandlers.onToolsDiscovered(this.config.id, tools);
      }

      return tools;
    } catch (error) {
      this.consecutiveFailures++;
      this.handleRequestError(error, 'listTools');
      throw error;
    }
  }

  async callTool(toolName: string, args: Record<string, unknown>): Promise<MCPToolResult> {
    return tracer.startActiveSpan(
      `mcp.tool.call ${toolName}`,
      {
        kind: SpanKind.CLIENT,
        attributes: {
          'mcp.server.id': this.config.id,
          'mcp.server.name': this.config.name,
          'mcp.server.url': this.config.url,
          'mcp.tool.name': toolName,
          'mcp.transport': this.config.transport,
        },
      },
      async (span) => {
        await this.ensureConnected();

        const startTime = Date.now();
        this.totalRequests++;

        this.log.debug('Calling tool', { toolName, args });

        try {
          const result = await this.client!.callTool({
            name: toolName,
            arguments: args,
          });

          const latency = Date.now() - startTime;
          this.successfulRequests++;
          this.latencySum += latency;
          this.consecutiveFailures = 0;

          // Record span metrics
          const isError = result.isError === true;
          span.setAttributes({
            'mcp.tool.latency_ms': latency,
            'mcp.tool.is_error': isError,
          });

          if (isError) {
            span.setStatus({
              code: SpanStatusCode.ERROR,
              message: 'Tool returned error',
            });
          }

          this.log.info('Tool call completed', {
            toolName,
            latencyMs: latency,
            isError: result.isError,
          });

          return this.convertSDKToolResult(result);
        } catch (error) {
          this.consecutiveFailures++;
          this.handleRequestError(error, 'callTool');

          // Record error in span
          span.recordException(error as Error);
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: (error as Error).message,
          });

          throw error;
        } finally {
          span.end();
        }
      }
    );
  }

  setEventHandlers(handlers: MCPClientEvents): void {
    this.eventHandlers = handlers;
  }

  // =========================================================================
  // Private Methods
  // =========================================================================

  private async createTransport(): Promise<Transport> {
    const authenticatedFetch = createAuthenticatedFetch(this.config.authConfig);
    const url = new URL(this.config.url);

    if (this.config.transport === 'sse') {
      this.log.debug('Creating SSE transport');
      return new SSEClientTransport(url, {
        requestInit: {
          headers: await this.getBaseHeaders(),
        },
        eventSourceInit: {
          fetch: authenticatedFetch,
        },
      });
    }

    // Default: Streamable HTTP
    this.log.debug('Creating Streamable HTTP transport');
    return new StreamableHTTPClientTransport(url, {
      requestInit: {
        headers: await this.getBaseHeaders(),
      },
      fetch: authenticatedFetch,
    });
  }

  private async getBaseHeaders(): Promise<Record<string, string>> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'project-jarvis/1.0.0',
    };

    // Add custom headers from config if available
    if (this.config.headers) {
      Object.assign(headers, this.config.headers);
    }

    return headers;
  }

  private convertSDKTool(tool: Tool): MCPTool {
    return {
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema as Record<string, unknown>,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private convertSDKToolResult(result: any): MCPToolResult {
    // Handle both content array and toolResult formats
    // The SDK's CallToolResult is a union type, so we need to check structure
    const resultAny = result as Record<string, unknown>;
    
    let content: MCPToolResult['content'];
    
    if ('content' in resultAny && Array.isArray(resultAny.content)) {
      content = (resultAny.content as Array<Record<string, unknown>>).map((c) => {
        if (c.type === 'text') {
          return { type: 'text' as const, text: c.text as string };
        }
        if (c.type === 'image') {
          return { type: 'image' as const, data: c.data as string, mimeType: c.mimeType as string };
        }
        if (c.type === 'resource') {
          return { type: 'resource' as const, resource: c.resource as Record<string, unknown> };
        }
        // Handle embedded resources or other types
        return { type: 'text' as const, text: JSON.stringify(c) };
      });
    } else {
      // Fallback for toolResult format or unknown structure
      content = [{ type: 'text' as const, text: JSON.stringify(result) }];
    }

    return {
      content,
      isError: resultAny.isError as boolean | undefined,
    };
  }

  private async ensureConnected(): Promise<void> {
    if (this.connectionState === 'connected' && this.client) {
      return;
    }

    if (this.connectionState === 'failed') {
      throw new Error(`MCP server ${this.config.name} is in failed state: ${this.lastError}`);
    }

    await this.connect();
  }

  private async waitForConnection(): Promise<void> {
    const maxWait = this.config.connectionTimeoutMs;
    const startTime = Date.now();

    while (this.connectionState === 'connecting') {
      if (Date.now() - startTime > maxWait) {
        throw new Error('Connection timeout');
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    if (this.connectionState !== 'connected') {
      throw new Error(`Connection failed: ${this.lastError}`);
    }
  }

  private setConnectionState(state: MCPConnectionState): void {
    const previousState = this.connectionState;
    this.connectionState = state;

    if (previousState !== state && this.eventHandlers.onConnectionStateChange) {
      this.eventHandlers.onConnectionStateChange(this.config.id, previousState, state);
    }
  }

  private handleConnectionError(error: unknown): void {
    const errorMessage = error instanceof Error ? error.message : String(error);
    this.lastError = errorMessage;
    this.lastErrorAt = new Date();
    this.consecutiveFailures++;

    this.log.error('Connection error', error);

    if (this.eventHandlers.onError) {
      this.eventHandlers.onError(
        this.config.id,
        error instanceof Error ? error : new Error(errorMessage)
      );
    }

    // Schedule reconnection
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.scheduleReconnect();
    } else {
      this.setConnectionState('failed');
      this.log.error('Max reconnection attempts reached');
    }
  }

  private handleRequestError(error: unknown, operation: string): void {
    const errorMessage = error instanceof Error ? error.message : String(error);
    this.lastError = `${operation}: ${errorMessage}`;
    this.lastErrorAt = new Date();

    this.log.error(`Request error in ${operation}`, error);

    if (this.eventHandlers.onError) {
      this.eventHandlers.onError(
        this.config.id,
        error instanceof Error ? error : new Error(errorMessage)
      );
    }

    // Check if this is a connection issue
    if (this.isConnectionError(error)) {
      this.setConnectionState('reconnecting');
      this.scheduleReconnect();
    }
  }

  private isConnectionError(error: unknown): boolean {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      return (
        message.includes('connection') ||
        message.includes('network') ||
        message.includes('socket') ||
        message.includes('econnrefused') ||
        message.includes('etimedout')
      );
    }
    return false;
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimeout) {
      return; // Already scheduled
    }

    this.reconnectAttempts++;
    const delay = Math.min(
      this.baseReconnectDelayMs * Math.pow(2, this.reconnectAttempts - 1),
      30000 // Max 30 seconds
    );

    this.log.info('Scheduling reconnection', {
      attempt: this.reconnectAttempts,
      maxAttempts: this.maxReconnectAttempts,
      delayMs: delay,
    });

    this.reconnectTimeout = setTimeout(async () => {
      this.reconnectTimeout = null;

      try {
        // Clean up existing connection
        await this.disconnect();
        this.setConnectionState('reconnecting');
        await this.connect();
      } catch (error) {
        this.handleConnectionError(error);
      }
    }, delay);
  }
}
