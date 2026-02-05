import type { AgentEvent } from '@project-jarvis/shared-types';

// =============================================================================
// Event Stream Port
// =============================================================================

/**
 * Port interface for publishing agent events to clients
 *
 * This port abstracts the real-time event delivery mechanism.
 * Implementations may use WebSockets, Server-Sent Events, or message queues.
 * Events are scoped to specific agent runs and delivered to the owning user.
 */
export interface EventStreamPort {
  /**
   * Publish a raw agent event
   *
   * @param userId - The user to send the event to
   * @param runId - The agent run this event belongs to
   * @param event - The event to publish
   */
  publish(userId: string, runId: string, event: AgentEvent): Promise<void>;

  /**
   * Publish a token event (streaming LLM output)
   *
   * @param userId - The user to send the event to
   * @param runId - The agent run this event belongs to
   * @param token - The token/text chunk to stream
   */
  publishToken(userId: string, runId: string, token: string): Promise<void>;

  /**
   * Publish a tool call event (agent is invoking a tool)
   *
   * @param userId - The user to send the event to
   * @param runId - The agent run this event belongs to
   * @param toolId - Unique identifier of this tool call
   * @param toolName - Human-readable name of the tool
   * @param input - The input parameters passed to the tool
   */
  publishToolCall(
    userId: string,
    runId: string,
    toolId: string,
    toolName: string,
    input: unknown
  ): Promise<void>;

  /**
   * Publish a tool result event (tool execution completed)
   *
   * @param userId - The user to send the event to
   * @param runId - The agent run this event belongs to
   * @param toolId - Unique identifier of this tool call (matches publishToolCall)
   * @param output - The output/result from the tool
   * @param success - Whether the tool executed successfully
   */
  publishToolResult(
    userId: string,
    runId: string,
    toolId: string,
    output: unknown,
    success: boolean
  ): Promise<void>;

  /**
   * Publish a final response event (agent run complete with response)
   *
   * @param userId - The user to send the event to
   * @param runId - The agent run this event belongs to
   * @param content - The final response content
   * @param usage - Optional token usage and cost information
   */
  publishFinal(
    userId: string,
    runId: string,
    content: string,
    usage?: { totalTokens: number; totalCost: number }
  ): Promise<void>;

  /**
   * Publish an error event
   *
   * @param userId - The user to send the event to
   * @param runId - The agent run this event belongs to
   * @param message - Human-readable error message
   * @param code - Optional error code for programmatic handling
   */
  publishError(userId: string, runId: string, message: string, code?: string): Promise<void>;

  /**
   * Publish a status change event
   *
   * @param userId - The user to send the event to
   * @param runId - The agent run this event belongs to
   * @param status - The new status of the agent run
   */
  publishStatus(
    userId: string,
    runId: string,
    status: 'running' | 'completed' | 'failed' | 'cancelled'
  ): Promise<void>;
}
