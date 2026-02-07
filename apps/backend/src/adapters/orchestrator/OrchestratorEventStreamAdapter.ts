// =============================================================================
// Orchestrator Event Stream Adapter
// =============================================================================
// Implements the EventStreamPort interface for streaming events to clients.
// Supports both SSE (Server-Sent Events) and the Vercel AI SDK data stream format.

import type { StreamEvent } from '@project-jarvis/shared-types';
import type { EventStreamPort } from '../../ports/EventStreamPort.js';
import type { IOrchestratorCacheAdapter } from './OrchestratorCacheAdapter.js';

// =============================================================================
// SSE Stream Writer Interface
// =============================================================================

export interface SSEStreamWriter {
  write(data: string): void | Promise<void>;
  writeEvent(event: string, data: string): void | Promise<void>;
  close(): void | Promise<void>;
}

// =============================================================================
// Event Serialization
// =============================================================================

/**
 * Serialize a StreamEvent to SSE format.
 */
export function serializeEventToSSE(event: StreamEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

/**
 * Serialize a StreamEvent to Vercel AI SDK data stream format.
 * The AI SDK expects specific message types for streaming.
 */
export function serializeEventToAISDK(event: StreamEvent): string {
  switch (event.type) {
    case 'agent.token':
      // Text delta: 0:string
      return `0:${JSON.stringify(event.token)}\n`;

    case 'agent.tool_call':
      // Tool call start: 9:{...}
      return `9:${JSON.stringify({
        toolCallId: event.toolId,
        toolName: event.toolName,
        args: event.input,
      })}\n`;

    case 'agent.tool_result':
      // Tool result: a:{...}
      return `a:${JSON.stringify({
        toolCallId: event.toolId,
        result: event.output,
      })}\n`;

    case 'agent.final':
      // Finish message: d:{...}
      return `d:${JSON.stringify({
        finishReason: 'stop',
        usage: event.usage ? {
          promptTokens: 0,
          completionTokens: event.usage.totalTokens,
        } : undefined,
      })}\n`;

    case 'agent.error':
      // Error: 3:string
      return `3:${JSON.stringify(event.message)}\n`;

    default:
      // For orchestrator-specific events, use a custom format
      // 8: for custom data
      return `8:${JSON.stringify(event)}\n`;
  }
}

// =============================================================================
// Event Stream Adapter Implementation
// =============================================================================

export class OrchestratorEventStreamAdapter implements EventStreamPort {
  private writers: Map<string, SSEStreamWriter[]> = new Map();

  constructor(private cache: IOrchestratorCacheAdapter) {}

  // ===========================================================================
  // EventStreamPort Implementation
  // ===========================================================================

  async publish(userId: string, runId: string, event: StreamEvent): Promise<void> {
    // Write to cache for Redis pub/sub
    await this.cache.publishEvent(runId, event);

    // Write directly to any connected SSE writers
    const writers = this.writers.get(runId);
    if (writers) {
      const sseData = serializeEventToSSE(event);
      for (const writer of writers) {
        try {
          await writer.write(sseData);
        } catch (error) {
          console.error('Error writing to SSE stream:', error);
        }
      }
    }
  }

  async publishToken(userId: string, runId: string, token: string): Promise<void> {
    await this.publish(userId, runId, {
      type: 'agent.token',
      token,
    });
  }

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

  // ===========================================================================
  // SSE Stream Management
  // ===========================================================================

  /**
   * Register an SSE writer for a run.
   * Multiple clients can subscribe to the same run.
   */
  registerWriter(runId: string, writer: SSEStreamWriter): void {
    if (!this.writers.has(runId)) {
      this.writers.set(runId, []);
    }
    this.writers.get(runId)!.push(writer);
  }

  /**
   * Unregister an SSE writer.
   */
  unregisterWriter(runId: string, writer: SSEStreamWriter): void {
    const writers = this.writers.get(runId);
    if (writers) {
      const index = writers.indexOf(writer);
      if (index >= 0) {
        writers.splice(index, 1);
      }
      if (writers.length === 0) {
        this.writers.delete(runId);
      }
    }
  }

  /**
   * Get the number of connected writers for a run.
   */
  getWriterCount(runId: string): number {
    return this.writers.get(runId)?.length ?? 0;
  }
}

// =============================================================================
// Hono SSE Helper
// =============================================================================

/**
 * Create an SSE response for Hono.
 * Usage:
 * ```typescript
 * return streamSSE(c, async (stream) => {
 *   const writer = createHonoSSEWriter(stream);
 *   eventStreamAdapter.registerWriter(runId, writer);
 *   await orchestrator.executeRun(userId, runId, input);
 *   eventStreamAdapter.unregisterWriter(runId, writer);
 * });
 * ```
 */
export function createHonoSSEWriter(stream: {
  writeSSE: (data: { data: string; event?: string; id?: string }) => Promise<void>;
  close: () => void;
}): SSEStreamWriter {
  return {
    write: async (data: string) => {
      // Parse the SSE formatted string and write
      const lines = data.trim().split('\n');
      let event = 'message';
      let eventData = '';

      for (const line of lines) {
        if (line.startsWith('event: ')) {
          event = line.slice(7);
        } else if (line.startsWith('data: ')) {
          eventData = line.slice(6);
        }
      }

      await stream.writeSSE({ data: eventData, event });
    },
    writeEvent: async (event: string, data: string) => {
      await stream.writeSSE({ data, event });
    },
    close: () => {
      stream.close();
    },
  };
}

// =============================================================================
// AI SDK Data Stream Helper
// =============================================================================

/**
 * Create a writer that outputs in Vercel AI SDK data stream format.
 * This allows compatibility with @ai-sdk/react useChat hook.
 */
export function createAISDKStreamWriter(
  writeFn: (chunk: string) => void | Promise<void>,
  closeFn: () => void | Promise<void>
): SSEStreamWriter {
  return {
    write: async (data: string) => {
      // Data is already in SSE format, we need to convert to AI SDK format
      const lines = data.trim().split('\n');
      let eventData = '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          eventData = line.slice(6);
        }
      }

      if (eventData) {
        try {
          const event = JSON.parse(eventData) as StreamEvent;
          const aiSdkData = serializeEventToAISDK(event);
          await writeFn(aiSdkData);
        } catch {
          // If parsing fails, just write the raw data
          await writeFn(data);
        }
      }
    },
    writeEvent: async (event: string, data: string) => {
      try {
        const parsedEvent = JSON.parse(data) as StreamEvent;
        const aiSdkData = serializeEventToAISDK(parsedEvent);
        await writeFn(aiSdkData);
      } catch {
        await writeFn(data);
      }
    },
    close: closeFn,
  };
}
