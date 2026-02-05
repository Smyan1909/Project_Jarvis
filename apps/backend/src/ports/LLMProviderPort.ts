import type { LLMMessage, LLMResponse, ToolDefinition } from '@project-jarvis/shared-types';

// =============================================================================
// Generate Options
// =============================================================================

/**
 * Options for LLM generation requests
 */
export interface GenerateOptions {
  /** Override the default model */
  model?: string;
  /** Sampling temperature (0-2, default varies by provider) */
  temperature?: number;
  /** Maximum tokens to generate */
  maxTokens?: number;
  /** Tools available for the model to call */
  tools?: ToolDefinition[];
  /** System prompt to prepend to messages */
  systemPrompt?: string;
}

// =============================================================================
// Stream Chunk Types
// =============================================================================

/**
 * A chunk of streamed response from the LLM
 */
export type StreamChunk =
  | { type: 'token'; token: string }
  | { type: 'tool_call'; toolCall: { id: string; name: string; arguments: string } }
  | { type: 'done'; response: LLMResponse };

// =============================================================================
// LLM Provider Port
// =============================================================================

/**
 * Port interface for LLM providers (OpenAI, Claude, etc.)
 *
 * This port abstracts the details of different LLM APIs, providing a unified
 * interface for text generation with tool calling support.
 */
export interface LLMProviderPort {
  /**
   * Generate a complete response from the LLM
   *
   * @param messages - The conversation history
   * @param options - Generation options (model, temperature, tools, etc.)
   * @returns The complete LLM response with content, tool calls, and usage stats
   */
  generate(messages: LLMMessage[], options?: GenerateOptions): Promise<LLMResponse>;

  /**
   * Stream a response from the LLM token by token
   *
   * @param messages - The conversation history
   * @param options - Generation options (model, temperature, tools, etc.)
   * @yields StreamChunk objects containing tokens, tool calls, or final response
   */
  stream(messages: LLMMessage[], options?: GenerateOptions): AsyncGenerator<StreamChunk, void, unknown>;

  /**
   * Get the current model identifier
   *
   * @returns The model name/ID (e.g., "gpt-4o-mini", "claude-3-5-sonnet-20241022")
   */
  getModel(): string;

  /**
   * Calculate the cost for a given token usage
   *
   * @param promptTokens - Number of input tokens
   * @param completionTokens - Number of output tokens
   * @returns Cost in USD
   */
  calculateCost(promptTokens: number, completionTokens: number): number;
}
