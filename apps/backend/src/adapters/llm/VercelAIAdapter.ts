// =============================================================================
// Vercel AI SDK Adapter
// =============================================================================
// Implements LLMProviderPort using the Vercel AI SDK

import { generateText, streamText, type CoreMessage } from 'ai';
import type {
  LLMProviderPort,
  GenerateOptions,
  StreamChunk,
} from '../../ports/LLMProviderPort.js';
import type {
  LLMMessage,
  LLMResponse,
  LLMToolCall,
  LLMFinishReason,
} from '@project-jarvis/shared-types';
import { getLanguageModel } from '../../infrastructure/ai/registry.js';
import { calculateModelCost } from '../../infrastructure/ai/config.js';
import { convertToolDefinitions } from './tools.js';
import { createTracer, SpanKind, SpanStatusCode, context, trace } from '../../infrastructure/observability/index.js';

// =============================================================================
// Tracing
// =============================================================================

const tracer = createTracer('llm-provider', '1.0.0');

/**
 * LLM Provider adapter using Vercel AI SDK
 *
 * Wraps the AI SDK's generateText and streamText functions to implement
 * the LLMProviderPort interface, allowing seamless integration with
 * the hexagonal architecture.
 *
 * @example
 * ```typescript
 * const adapter = new VercelAIAdapter('openai:gpt-4o-mini');
 * const response = await adapter.generate([
 *   { role: 'user', content: 'Hello!' }
 * ]);
 * ```
 */
export class VercelAIAdapter implements LLMProviderPort {
  private modelId: string;

  /**
   * Create a new Vercel AI adapter
   * @param modelId - Model ID in format "provider:model" (e.g., "openai:gpt-4o-mini")
   */
  constructor(modelId: string) {
    this.modelId = modelId;
  }

  /**
   * Generate a complete response from the LLM
   */
  async generate(
    messages: LLMMessage[],
    options?: GenerateOptions
  ): Promise<LLMResponse> {
    const modelId = options?.model ?? this.modelId;
    const [provider] = modelId.split(':');

    return tracer.startActiveSpan(
      `llm.generate ${modelId}`,
      {
        kind: SpanKind.CLIENT,
        attributes: {
          'gen_ai.system': provider,
          'gen_ai.request.model': modelId,
          'gen_ai.request.temperature': options?.temperature,
          'gen_ai.request.max_tokens': options?.maxTokens,
          'gen_ai.request.message_count': messages.length,
          'gen_ai.request.has_tools': options?.tools ? options.tools.length > 0 : false,
        },
      },
      async (span) => {
        try {
          const model = getLanguageModel(modelId);

          const result = await generateText({
            model,
            messages: this.convertMessagesToCore(messages),
            system: options?.systemPrompt,
            temperature: options?.temperature,
            maxTokens: options?.maxTokens,
            tools: options?.tools ? convertToolDefinitions(options.tools) : undefined,
          });

          // Record usage metrics
          span.setAttributes({
            'gen_ai.usage.prompt_tokens': result.usage.promptTokens,
            'gen_ai.usage.completion_tokens': result.usage.completionTokens,
            'gen_ai.usage.total_tokens': result.usage.totalTokens,
            'gen_ai.response.finish_reason': result.finishReason,
            'gen_ai.response.tool_calls': result.toolCalls?.length || 0,
          });

          return {
            content: result.text || null,
            toolCalls: this.extractToolCalls(result.toolCalls),
            usage: {
              promptTokens: result.usage.promptTokens,
              completionTokens: result.usage.completionTokens,
              totalTokens: result.usage.totalTokens,
            },
            finishReason: this.mapFinishReason(result.finishReason),
          };
        } catch (error) {
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

  /**
   * Stream a response from the LLM token by token
   */
  async *stream(
    messages: LLMMessage[],
    options?: GenerateOptions
  ): AsyncGenerator<StreamChunk, void, unknown> {
    const modelId = options?.model ?? this.modelId;
    const [provider] = modelId.split(':');
    const model = getLanguageModel(modelId);

    // Create span for the entire stream operation
    const span = tracer.startSpan(`llm.stream ${modelId}`, {
      kind: SpanKind.CLIENT,
      attributes: {
        'gen_ai.system': provider,
        'gen_ai.request.model': modelId,
        'gen_ai.request.temperature': options?.temperature,
        'gen_ai.request.max_tokens': options?.maxTokens,
        'gen_ai.request.message_count': messages.length,
        'gen_ai.request.streaming': true,
        'gen_ai.request.has_tools': options?.tools ? options.tools.length > 0 : false,
      },
    });

    // Run the stream in the span's context
    const ctx = trace.setSpan(context.active(), span);

    try {
      const result = context.with(ctx, () =>
        streamText({
          model,
          messages: this.convertMessagesToCore(messages),
          system: options?.systemPrompt,
          temperature: options?.temperature,
          maxTokens: options?.maxTokens,
          tools: options?.tools ? convertToolDefinitions(options.tools) : undefined,
        })
      );

    // Track accumulated data for final response
    let accumulatedText = '';
    const toolCalls: LLMToolCall[] = [];
    let finishReceived = false;
    let eventCount = 0;

    console.log(`[VercelAIAdapter] Starting stream for model: ${modelId}`);

    for await (const part of result.fullStream) {
      eventCount++;
      
      // Log all event types for debugging
      if (eventCount <= 5 || part.type === 'finish' || part.type === 'tool-call' || part.type === 'error') {
        console.log(`[VercelAIAdapter] Stream event #${eventCount}: ${part.type}`);
      }

      switch (part.type) {
        case 'text-delta':
          accumulatedText += part.textDelta;
          yield { type: 'token', token: part.textDelta };
          break;

        case 'tool-call':
          const toolCall: LLMToolCall = {
            id: part.toolCallId,
            name: part.toolName,
            arguments: JSON.stringify(part.args),
          };
          toolCalls.push(toolCall);
          yield {
            type: 'tool_call',
            toolCall: {
              id: part.toolCallId,
              name: part.toolName,
              arguments: JSON.stringify(part.args),
            },
          };
          break;

        case 'finish':
          finishReceived = true;
          console.log(`[VercelAIAdapter] Finish event received after ${eventCount} events`);
          // Get final usage - need to await the promises
          const usage = await result.usage;
          const finishReason = await result.finishReason;

          // Record span metrics
          span.setAttributes({
            'gen_ai.usage.prompt_tokens': usage.promptTokens,
            'gen_ai.usage.completion_tokens': usage.completionTokens,
            'gen_ai.usage.total_tokens': usage.totalTokens,
            'gen_ai.response.finish_reason': finishReason,
            'gen_ai.response.tool_calls': toolCalls.length,
            'gen_ai.stream.event_count': eventCount,
          });
          
          yield {
            type: 'done',
            response: {
              content: accumulatedText || null,
              toolCalls,
              usage: {
                promptTokens: usage.promptTokens,
                completionTokens: usage.completionTokens,
                totalTokens: usage.totalTokens,
              },
              finishReason: this.mapFinishReason(finishReason),
            },
          };
          break;

        case 'error':
          console.error(`[VercelAIAdapter] Stream error:`, (part as { type: 'error'; error: unknown }).error);
          const streamError = (part as { type: 'error'; error: unknown }).error;
          span.recordException(streamError as Error);
          span.setStatus({ code: SpanStatusCode.ERROR, message: String(streamError) });
          throw streamError;
      }
    }

    console.log(`[VercelAIAdapter] Stream ended after ${eventCount} events, finishReceived: ${finishReceived}`);

    // If we didn't receive a finish event, still emit a done with what we have
    if (!finishReceived) {
      console.warn('[VercelAIAdapter] Stream ended without finish event, emitting done with accumulated data');
      const usage = await result.usage;
      const finishReason = await result.finishReason;

      // Record span metrics
      span.setAttributes({
        'gen_ai.usage.prompt_tokens': usage?.promptTokens ?? 0,
        'gen_ai.usage.completion_tokens': usage?.completionTokens ?? 0,
        'gen_ai.usage.total_tokens': usage?.totalTokens ?? 0,
        'gen_ai.response.finish_reason': finishReason ?? 'unknown',
        'gen_ai.response.tool_calls': toolCalls.length,
        'gen_ai.stream.event_count': eventCount,
        'gen_ai.stream.early_end': true,
      });
      
      yield {
        type: 'done',
        response: {
          content: accumulatedText || null,
          toolCalls,
          usage: {
            promptTokens: usage?.promptTokens ?? 0,
            completionTokens: usage?.completionTokens ?? 0,
            totalTokens: usage?.totalTokens ?? 0,
          },
          finishReason: this.mapFinishReason(finishReason ?? 'stop'),
        },
      };
    }

    // End the span when stream completes successfully
    span.end();

    } catch (error) {
      // Record error and end span
      span.recordException(error as Error);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: (error as Error).message,
      });
      span.end();
      throw error;
    }
  }

  /**
   * Get the current model identifier
   */
  getModel(): string {
    return this.modelId;
  }

  /**
   * Calculate the cost for a given token usage
   */
  calculateCost(promptTokens: number, completionTokens: number): number {
    return calculateModelCost(this.modelId, promptTokens, completionTokens);
  }

  // ===========================================================================
  // Private Helper Methods
  // ===========================================================================

  /**
   * Convert our LLMMessage format to AI SDK CoreMessage format
   */
  private convertMessagesToCore(messages: LLMMessage[]): CoreMessage[] {
    return messages.map((m): CoreMessage => {
      switch (m.role) {
        case 'user':
          return { role: 'user', content: m.content };
        case 'assistant':
          // Handle assistant messages with tool calls
          if (m.toolCalls && m.toolCalls.length > 0) {
            return {
              role: 'assistant',
              content: [
                // Include text content if present
                ...(m.content ? [{ type: 'text' as const, text: m.content }] : []),
                // Include tool calls
                ...m.toolCalls.map((tc) => ({
                  type: 'tool-call' as const,
                  toolCallId: tc.id,
                  toolName: tc.name,
                  args: JSON.parse(tc.arguments),
                })),
              ],
            };
          }
          return { role: 'assistant', content: m.content };
        case 'system':
          return { role: 'system', content: m.content };
        case 'tool':
          return {
            role: 'tool',
            content: [
              {
                type: 'tool-result',
                toolCallId: m.toolCallId ?? '',
                toolName: '', // Will be filled by the model
                result: m.content,
              },
            ],
          };
        default:
          return { role: 'user', content: m.content };
      }
    });
  }

  /**
   * Extract tool calls from AI SDK result
   */
  private extractToolCalls(
    toolCalls: Array<{ toolCallId: string; toolName: string; args: unknown }> | undefined
  ): LLMToolCall[] {
    if (!toolCalls) return [];

    return toolCalls.map((tc) => ({
      id: tc.toolCallId,
      name: tc.toolName,
      arguments: JSON.stringify(tc.args),
    }));
  }

  /**
   * Map AI SDK finish reason to our LLMFinishReason type
   */
  private mapFinishReason(reason: string): LLMFinishReason {
    switch (reason) {
      case 'stop':
        return 'stop';
      case 'tool-calls':
        return 'tool_calls';
      case 'length':
        return 'length';
      case 'error':
        return 'error';
      default:
        // Handle any unexpected finish reasons
        return 'stop';
    }
  }
}
