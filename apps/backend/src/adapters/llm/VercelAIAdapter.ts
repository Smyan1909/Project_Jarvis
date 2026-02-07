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
    const model = getLanguageModel(modelId);

    const result = await generateText({
      model,
      messages: this.convertMessagesToCore(messages),
      system: options?.systemPrompt,
      temperature: options?.temperature,
      maxTokens: options?.maxTokens,
      tools: options?.tools ? convertToolDefinitions(options.tools) : undefined,
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
  }

  /**
   * Stream a response from the LLM token by token
   */
  async *stream(
    messages: LLMMessage[],
    options?: GenerateOptions
  ): AsyncGenerator<StreamChunk, void, unknown> {
    const modelId = options?.model ?? this.modelId;
    const model = getLanguageModel(modelId);

    const result = streamText({
      model,
      messages: this.convertMessagesToCore(messages),
      system: options?.systemPrompt,
      temperature: options?.temperature,
      maxTokens: options?.maxTokens,
      tools: options?.tools ? convertToolDefinitions(options.tools) : undefined,
    });

    // Track accumulated data for final response
    let accumulatedText = '';
    const toolCalls: LLMToolCall[] = [];

    for await (const part of result.fullStream) {
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
          // Get final usage - need to await the promises
          const usage = await result.usage;
          const finishReason = await result.finishReason;
          
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
      }
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
