import type { ToolDefinition, ToolResult } from '@project-jarvis/shared-types';

// =============================================================================
// Tool Invoker Port
// =============================================================================

/**
 * Port interface for tool invocation and management
 *
 * This port abstracts tool registration, discovery, permission checking,
 * and execution. Implementations may include local tool registries,
 * MCP clients, or Composio integrations.
 */
export interface ToolInvokerPort {
  /**
   * Get all available tools for a user
   *
   * Returns tool definitions that can be passed to LLM providers.
   * Tools may be filtered based on user permissions or subscriptions.
   *
   * @param userId - The user requesting available tools
   * @returns Array of tool definitions with schemas
   */
  getTools(userId: string): Promise<ToolDefinition[]>;

  /**
   * Invoke a tool with the given input
   *
   * Executes the tool and returns the result. The input should match
   * the tool's parameter schema.
   *
   * @param userId - The user invoking the tool (for permission checks and audit)
   * @param toolId - The unique identifier of the tool to invoke
   * @param input - The input parameters matching the tool's schema
   * @returns The tool execution result with success status and output
   */
  invoke(userId: string, toolId: string, input: Record<string, unknown>): Promise<ToolResult>;

  /**
   * Check if a user has permission to use a specific tool
   *
   * @param userId - The user to check permissions for
   * @param toolId - The tool to check access to
   * @returns True if the user can use the tool, false otherwise
   */
  hasPermission(userId: string, toolId: string): Promise<boolean>;
}
