// =============================================================================
// Composite Tool Invoker
// =============================================================================
// Combines local ToolRegistry with MCP Client Manager for unified tool access
// Implements ToolInvokerPort interface

import type { ToolDefinition, ToolResult } from '@project-jarvis/shared-types';
import type { ToolInvokerPort } from '../../ports/ToolInvokerPort.js';
import type { ToolRegistry } from '../../application/services/ToolRegistry.js';
import type { MCPClientManager } from '../mcp/MCPClientManager.js';
import { isMCPToolId } from '../mcp/MCPToolConverter.js';
import { logger } from '../../infrastructure/logging/logger.js';

const log = logger.child({ module: 'CompositeToolInvoker' });

/**
 * Composite Tool Invoker
 *
 * Provides a unified interface for accessing both local tools (from ToolRegistry)
 * and remote tools (from MCP servers via MCPClientManager).
 *
 * Features:
 * - Seamless tool aggregation from local and remote sources
 * - Automatic routing of tool calls based on tool ID prefix
 * - Graceful degradation when MCP servers are unavailable
 * - Consistent tool result format
 *
 * Tool ID Format:
 * - Local tools: plain ID (e.g., "get_current_time", "calculate")
 * - MCP tools: serverName__toolName (e.g., "github__create_issue")
 */
export class CompositeToolInvoker implements ToolInvokerPort {
  private log = log;

  constructor(
    private localRegistry: ToolRegistry,
    private mcpManager: MCPClientManager | null
  ) {
    this.log.info('CompositeToolInvoker created', {
      hasLocalRegistry: !!localRegistry,
      hasMCPManager: !!mcpManager,
    });
  }

  /**
   * Get all available tools for a user
   *
   * Combines tools from the local registry and all connected MCP servers.
   * MCP tools are prefixed with their server name for identification.
   *
   * @param userId - User requesting tools
   * @param agentType - Optional agent type for filtering
   * @returns Combined array of tool definitions
   */
  async getTools(userId: string, agentType?: string): Promise<ToolDefinition[]> {
    const tools: ToolDefinition[] = [];

    // Get local tools
    try {
      const localTools = await this.localRegistry.getTools(userId, agentType);
      tools.push(...localTools);
      this.log.debug('Retrieved local tools', { count: localTools.length });
    } catch (error) {
      this.log.error('Failed to get local tools', error as Record<string, unknown>);
      // Continue with MCP tools even if local fails
    }

    // Get MCP tools
    if (this.mcpManager) {
      try {
        const mcpTools = await this.mcpManager.getToolDefinitions(userId);
        tools.push(...mcpTools);
        this.log.debug('Retrieved MCP tools', { count: mcpTools.length });
      } catch (error) {
        this.log.warn('Failed to get MCP tools', error as Record<string, unknown>);
        // Graceful degradation - continue without MCP tools
      }
    }

    this.log.debug('Total tools available', {
      total: tools.length,
      userId,
      agentType,
    });

    return tools;
  }

  /**
   * Get tools specifically filtered for an agent type
   *
   * This excludes orchestrator-only tools from sub-agents.
   */
  async getToolsForAgent(userId: string, agentType: string): Promise<ToolDefinition[]> {
    return this.getTools(userId, agentType);
  }

  /**
   * Invoke a tool with the given input
   *
   * Automatically routes to the appropriate handler:
   * - MCP tools (with server prefix) go to MCPClientManager
   * - Local tools go to ToolRegistry
   *
   * @param userId - User invoking the tool
   * @param toolId - Tool identifier (may include server prefix)
   * @param input - Tool input parameters
   * @returns Tool execution result
   */
  async invoke(
    userId: string,
    toolId: string,
    input: Record<string, unknown>
  ): Promise<ToolResult> {
    const startTime = Date.now();

    // Check if this is an MCP tool
    if (isMCPToolId(toolId)) {
      return this.invokeMCPTool(userId, toolId, input, startTime);
    }

    // Otherwise, use local registry
    return this.invokeLocalTool(userId, toolId, input, startTime);
  }

  /**
   * Check if a user has permission to use a specific tool
   */
  async hasPermission(userId: string, toolId: string): Promise<boolean> {
    // MCP tools - check if server is available
    if (isMCPToolId(toolId)) {
      if (!this.mcpManager) {
        return false;
      }

      const parsed = this.mcpManager.parseToolId(toolId);
      if (!parsed) {
        return false;
      }

      // For now, all MCP tools are available if the server is connected
      // Could add per-server permission checks in the future
      return true;
    }

    // Local tools
    return this.localRegistry.hasPermission(userId, toolId);
  }

  /**
   * Get a list of all registered tool IDs (local only)
   */
  getRegisteredToolIds(): string[] {
    return this.localRegistry.getRegisteredToolIds();
  }

  /**
   * Check if a tool is registered (local only)
   */
  isRegistered(toolId: string): boolean {
    if (isMCPToolId(toolId)) {
      return this.mcpManager !== null;
    }
    return this.localRegistry.isRegistered(toolId);
  }

  /**
   * Check if a tool ID is from an MCP server
   */
  isMCPTool(toolId: string): boolean {
    return isMCPToolId(toolId);
  }

  /**
   * Get MCP server status information
   */
  getMCPServerStatus() {
    if (!this.mcpManager) {
      return [];
    }
    return this.mcpManager.getAllServerStatus();
  }

  // =========================================================================
  // Private Methods
  // =========================================================================

  private async invokeMCPTool(
    userId: string,
    toolId: string,
    input: Record<string, unknown>,
    startTime: number
  ): Promise<ToolResult> {
    if (!this.mcpManager) {
      this.log.warn('MCP tool invoked but manager not available', { toolId });
      return {
        success: false,
        output: null,
        error: 'MCP integration not available',
      };
    }

    try {
      this.log.debug('Invoking MCP tool', { userId, toolId, input });

      const result = await this.mcpManager.invokeToolAsToolResult(userId, toolId, input);
      const durationMs = Date.now() - startTime;

      this.log.info('MCP tool invocation completed', {
        userId,
        toolId,
        success: result.success,
        durationMs,
      });

      return result;
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      this.log.error('MCP tool invocation failed', {
        userId,
        toolId,
        error: errorMessage,
        durationMs,
      });

      return {
        success: false,
        output: null,
        error: `MCP tool error: ${errorMessage}`,
      };
    }
  }

  private async invokeLocalTool(
    userId: string,
    toolId: string,
    input: Record<string, unknown>,
    startTime: number
  ): Promise<ToolResult> {
    try {
      this.log.debug('Invoking local tool', { userId, toolId, input });

      const result = await this.localRegistry.invoke(userId, toolId, input);
      const durationMs = Date.now() - startTime;

      this.log.info('Local tool invocation completed', {
        userId,
        toolId,
        success: result.success,
        durationMs,
      });

      return result;
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      this.log.error('Local tool invocation failed', {
        userId,
        toolId,
        error: errorMessage,
        durationMs,
      });

      return {
        success: false,
        output: null,
        error: errorMessage,
      };
    }
  }
}

/**
 * Create a CompositeToolInvoker instance
 *
 * @param localRegistry - Local tool registry
 * @param mcpManager - MCP client manager (optional - can be null if MCP not configured)
 */
export function createCompositeToolInvoker(
  localRegistry: ToolRegistry,
  mcpManager: MCPClientManager | null
): CompositeToolInvoker {
  return new CompositeToolInvoker(localRegistry, mcpManager);
}
