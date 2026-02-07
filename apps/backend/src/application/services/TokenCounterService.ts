// =============================================================================
// Token Counter Service
// =============================================================================
// Provides token estimation for context management. Uses a simple heuristic
// approach that approximates token counts without requiring external libraries.
// This is suitable for context management where exact counts aren't critical.

import type { LLMMessage, ToolDefinition } from '@project-jarvis/shared-types';

// =============================================================================
// Constants
// =============================================================================

/**
 * Average characters per token for estimation.
 * GPT models average ~4 characters per token for English text.
 * We use a slightly conservative estimate to avoid underounting.
 */
const CHARS_PER_TOKEN = 3.5;

/**
 * Base overhead tokens for message structure (role, formatting, etc.)
 */
const MESSAGE_OVERHEAD_TOKENS = 4;

/**
 * Base overhead for tool definition structure
 */
const TOOL_DEFINITION_OVERHEAD = 10;

/**
 * Overhead for system prompt wrapper
 */
const SYSTEM_PROMPT_OVERHEAD = 10;

// =============================================================================
// Token Counter Service
// =============================================================================

/**
 * Service for estimating token counts in messages and context.
 * 
 * Uses a heuristic approach that provides reasonable estimates for
 * context management purposes. For production use with strict token
 * limits, consider integrating tiktoken or similar libraries.
 */
export class TokenCounterService {
  /**
   * Estimate the number of tokens in a text string.
   * 
   * @param text - The text to estimate tokens for
   * @returns Estimated token count
   */
  estimateTokens(text: string): number {
    if (!text) return 0;
    
    // Basic estimation: characters / average chars per token
    const baseEstimate = Math.ceil(text.length / CHARS_PER_TOKEN);
    
    // Add overhead for special tokens, whitespace, etc.
    // JSON structures tend to have more tokens than plain text
    const jsonPenalty = this.containsJson(text) ? 1.2 : 1.0;
    
    return Math.ceil(baseEstimate * jsonPenalty);
  }

  /**
   * Estimate the number of tokens for a single LLM message.
   * Includes message structure overhead.
   * 
   * @param message - The message to estimate
   * @returns Estimated token count including overhead
   */
  estimateMessageTokens(message: LLMMessage): number {
    let tokens = MESSAGE_OVERHEAD_TOKENS;
    
    // Content tokens
    tokens += this.estimateTokens(message.content);
    
    // Tool call ID if present
    if (message.toolCallId) {
      tokens += this.estimateTokens(message.toolCallId);
    }
    
    // Tool calls if present
    if (message.toolCalls && message.toolCalls.length > 0) {
      for (const tc of message.toolCalls) {
        tokens += this.estimateTokens(tc.id);
        tokens += this.estimateTokens(tc.name);
        tokens += this.estimateTokens(tc.arguments);
        tokens += 5; // Overhead per tool call
      }
    }
    
    return tokens;
  }

  /**
   * Estimate the total tokens for an array of messages.
   * 
   * @param messages - Array of messages to estimate
   * @returns Total estimated token count
   */
  estimateMessagesTokens(messages: LLMMessage[]): number {
    return messages.reduce((total, msg) => total + this.estimateMessageTokens(msg), 0);
  }

  /**
   * Estimate the tokens for tool definitions.
   * 
   * @param tools - Array of tool definitions
   * @returns Estimated token count for all tools
   */
  estimateToolsTokens(tools: ToolDefinition[]): number {
    if (!tools || tools.length === 0) return 0;
    
    let tokens = 0;
    
    for (const tool of tools) {
      tokens += TOOL_DEFINITION_OVERHEAD;
      tokens += this.estimateTokens(tool.id);
      tokens += this.estimateTokens(tool.name);
      tokens += this.estimateTokens(tool.description);
      
      // Parameters schema
      if (tool.parameters) {
        tokens += this.estimateTokens(JSON.stringify(tool.parameters));
      }
    }
    
    return tokens;
  }

  /**
   * Estimate the total context usage including all components.
   * 
   * @param systemPrompt - The system prompt
   * @param messages - Array of messages
   * @param tools - Optional array of tool definitions
   * @returns Total estimated context token usage
   */
  estimateTotalContext(
    systemPrompt: string,
    messages: LLMMessage[],
    tools?: ToolDefinition[]
  ): number {
    let total = 0;
    
    // System prompt
    if (systemPrompt) {
      total += SYSTEM_PROMPT_OVERHEAD;
      total += this.estimateTokens(systemPrompt);
    }
    
    // Messages
    total += this.estimateMessagesTokens(messages);
    
    // Tools
    if (tools) {
      total += this.estimateToolsTokens(tools);
    }
    
    return total;
  }

  /**
   * Get a breakdown of token usage by component.
   * Useful for debugging and monitoring.
   * 
   * @param systemPrompt - The system prompt
   * @param messages - Array of messages
   * @param tools - Optional array of tool definitions
   * @returns Object with token counts per component
   */
  getTokenBreakdown(
    systemPrompt: string,
    messages: LLMMessage[],
    tools?: ToolDefinition[]
  ): {
    systemPrompt: number;
    messages: number;
    tools: number;
    total: number;
  } {
    const systemPromptTokens = systemPrompt 
      ? SYSTEM_PROMPT_OVERHEAD + this.estimateTokens(systemPrompt) 
      : 0;
    const messagesTokens = this.estimateMessagesTokens(messages);
    const toolsTokens = tools ? this.estimateToolsTokens(tools) : 0;
    
    return {
      systemPrompt: systemPromptTokens,
      messages: messagesTokens,
      tools: toolsTokens,
      total: systemPromptTokens + messagesTokens + toolsTokens,
    };
  }

  /**
   * Find the index at which cumulative tokens from the start
   * exceed a threshold. Useful for finding summarization boundaries.
   * 
   * @param messages - Array of messages
   * @param tokenThreshold - The token threshold to find
   * @returns Index of the first message that exceeds the threshold, or -1
   */
  findTokenThresholdIndex(messages: LLMMessage[], tokenThreshold: number): number {
    let cumulative = 0;
    
    for (let i = 0; i < messages.length; i++) {
      cumulative += this.estimateMessageTokens(messages[i]);
      if (cumulative > tokenThreshold) {
        return i;
      }
    }
    
    return -1; // Never exceeded
  }

  /**
   * Check if a string likely contains JSON.
   * Used to apply JSON token penalty.
   */
  private containsJson(text: string): boolean {
    // Quick check for JSON-like structures
    return (text.includes('{') && text.includes('}')) || 
           (text.includes('[') && text.includes(']'));
  }
}
