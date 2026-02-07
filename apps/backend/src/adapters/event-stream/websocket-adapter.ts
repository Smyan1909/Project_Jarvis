// =============================================================================
// WebSocket Event Stream Adapter
// =============================================================================
// Implements EventStreamPort using Socket.io for real-time event delivery.
// Translates domain events into WebSocket emissions to connected clients.

import type { EventStreamPort } from '../../ports/EventStreamPort.js';
import type { SocketServer } from '../../api/ws/socket-server.js';
import type { AgentEvent } from '@project-jarvis/shared-types';

// =============================================================================
// Adapter
// =============================================================================

/**
 * WebSocket implementation of the EventStreamPort
 *
 * Delivers agent events to connected clients via Socket.io.
 * Events are scoped to specific agent runs and delivered to the owning user.
 */
export class WebSocketEventStreamAdapter implements EventStreamPort {
  constructor(private socketServer: SocketServer) {}

  /**
   * Publish a raw agent event
   */
  async publish(userId: string, runId: string, event: AgentEvent): Promise<void> {
    this.socketServer.emitToRun(userId, runId, event);
  }

  /**
   * Publish a token event (streaming LLM output)
   */
  async publishToken(userId: string, runId: string, token: string): Promise<void> {
    await this.publish(userId, runId, {
      type: 'agent.token',
      token,
    });
  }

  /**
   * Publish a tool call event (agent is invoking a tool)
   */
  async publishToolCall(
    userId: string,
    runId: string,
    toolId: string,
    toolName: string,
    input: unknown
  ): Promise<void> {
    await this.publish(userId, runId, {
      type: 'agent.tool_call',
      toolId,
      toolName,
      input,
    });
  }

  /**
   * Publish a tool result event (tool execution completed)
   */
  async publishToolResult(
    userId: string,
    runId: string,
    toolId: string,
    output: unknown,
    success: boolean
  ): Promise<void> {
    await this.publish(userId, runId, {
      type: 'agent.tool_result',
      toolId,
      output,
      success,
    });
  }

  /**
   * Publish a final response event (agent run complete with response)
   */
  async publishFinal(
    userId: string,
    runId: string,
    content: string,
    usage?: { totalTokens: number; totalCost: number }
  ): Promise<void> {
    await this.publish(userId, runId, {
      type: 'agent.final',
      content,
      usage,
    });
  }

  /**
   * Publish an error event
   */
  async publishError(
    userId: string,
    runId: string,
    message: string,
    code?: string
  ): Promise<void> {
    await this.publish(userId, runId, {
      type: 'agent.error',
      message,
      code,
    });
  }

  /**
   * Publish a status change event
   */
  async publishStatus(
    userId: string,
    runId: string,
    status: 'running' | 'completed' | 'failed' | 'cancelled'
  ): Promise<void> {
    await this.publish(userId, runId, {
      type: 'agent.status',
      status,
    });
  }
}
