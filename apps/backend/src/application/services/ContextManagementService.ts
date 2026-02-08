// =============================================================================
// Context Management Service
// =============================================================================
// Handles automatic context summarization when conversation history approaches
// the model's context limit. Uses an incremental sliding window approach that
// summarizes older messages while preserving recent context.

import { v4 as uuidv4 } from 'uuid';
import type {
  LLMMessage,
  ToolDefinition,
  ContextSummary,
  ContextManagementResult,
} from '@project-jarvis/shared-types';
import type { LLMProviderPort } from '../../ports/LLMProviderPort.js';
import { TokenCounterService } from './TokenCounterService.js';
import {
  getModelContextLimit,
  DEFAULT_CONTEXT_SUMMARIZATION_CONFIG,
  type ContextSummarizationConfig,
} from '../../infrastructure/ai/config.js';
import { logger } from '../../infrastructure/logging/logger.js';

// =============================================================================
// Summarization Prompt
// =============================================================================

const SUMMARIZATION_SYSTEM_PROMPT = `You are a context summarizer for an AI assistant. Your task is to create a concise summary of conversation history that preserves critical information.

You MUST preserve:
1. Key tool calls made and their results (including specific data values)
2. Important decisions and reasoning steps taken
3. Any errors or issues encountered and how they were handled
4. Critical information discovered during the conversation
5. The current state and progress toward the goal

Rules:
- Be concise but comprehensive - aim for 20-30% of original length
- Preserve specific data values, IDs, and important details
- Maintain chronological order of key events
- Focus on information needed to continue the task
- Use bullet points for clarity
- Do NOT include pleasantries or redundant information

Output format:
Start with "Previous conversation summary:" followed by the bullet-point summary.`;

const SUMMARIZATION_USER_PROMPT = `Please summarize the following conversation history. Focus on preserving tool calls, their results, reasoning steps, and any critical information discovered.

Conversation to summarize:
`;

// =============================================================================
// Context Management Service
// =============================================================================

/**
 * Service that manages context window limits by automatically summarizing
 * older messages when the context approaches the model's limit.
 * 
 * Uses an incremental sliding window approach:
 * 1. Monitors token usage against model context limits
 * 2. When threshold is exceeded, summarizes oldest messages
 * 3. Replaces summarized messages with a summary message
 * 4. Preserves recent messages and system context
 */
export class ContextManagementService {
  private config: ContextSummarizationConfig;
  private log = logger.child({ service: 'ContextManagementService' });

  constructor(
    private tokenCounter: TokenCounterService,
    private summaryLLM: LLMProviderPort,
    config?: Partial<ContextSummarizationConfig>
  ) {
    this.config = { ...DEFAULT_CONTEXT_SUMMARIZATION_CONFIG, ...config };
  }

  // ===========================================================================
  // Main Public Method
  // ===========================================================================

  /**
   * Manage context for a set of messages before sending to LLM.
   * Automatically summarizes older messages if context limit is approached.
   * 
   * @param messages - Current message history
   * @param options - Context options including model ID, system prompt, and tools
   * @returns Result with potentially modified messages and summary info
   */
  async manageContext(
    messages: LLMMessage[],
    options: {
      modelId: string;
      systemPrompt: string;
      tools?: ToolDefinition[];
    }
  ): Promise<ContextManagementResult> {
    // If disabled, pass through unchanged
    if (!this.config.enabled) {
      const estimatedTokens = this.tokenCounter.estimateTotalContext(
        options.systemPrompt,
        messages,
        options.tools
      );
      return {
        messages,
        summarized: false,
        estimatedTokens,
        contextLimit: getModelContextLimit(options.modelId),
      };
    }

    const contextLimit = getModelContextLimit(options.modelId);
    const effectiveLimit = contextLimit - this.config.outputReserve;
    const triggerThreshold = effectiveLimit * this.config.triggerThreshold;
    const targetThreshold = effectiveLimit * this.config.targetThreshold;

    // Estimate current token usage
    const currentTokens = this.tokenCounter.estimateTotalContext(
      options.systemPrompt,
      messages,
      options.tools
    );

    this.log.debug('Checking context usage', {
      currentTokens,
      triggerThreshold,
      contextLimit,
      messageCount: messages.length,
    });

    // Check if we need to summarize
    if (currentTokens <= triggerThreshold) {
      return {
        messages,
        summarized: false,
        estimatedTokens: currentTokens,
        contextLimit,
      };
    }

    this.log.info('Context threshold exceeded, initiating summarization', {
      currentTokens,
      triggerThreshold,
      targetThreshold,
    });

    // Calculate fixed token usage (system prompt + tools)
    const fixedTokens = this.tokenCounter.estimateTotalContext(
      options.systemPrompt,
      [],
      options.tools
    );

    // Calculate how many tokens we can use for messages
    const targetMessageTokens = targetThreshold - fixedTokens;

    // Find summarization boundary
    const { startIndex, endIndex, tokensToSummarize } = this.calculateSummarizationBoundary(
      messages,
      targetMessageTokens
    );

    if (startIndex === -1 || endIndex <= startIndex) {
      // Nothing meaningful to summarize
      this.log.warn('Cannot find meaningful summarization boundary', {
        messageCount: messages.length,
        minToKeep: this.config.minMessagesToKeep,
      });
      return {
        messages,
        summarized: false,
        estimatedTokens: currentTokens,
        contextLimit,
      };
    }

    // Extract messages to summarize
    const messagesToSummarize = messages.slice(startIndex, endIndex);
    const messagesToKeep = messages.slice(endIndex);

    // Generate summary
    const summary = await this.summarizeMessages(messagesToSummarize, tokensToSummarize);

    // Create new message array with summary
    const summaryMessage: LLMMessage = {
      role: 'system',
      content: summary.content,
    };

    // Reconstruct messages: [summary] + [kept messages]
    const newMessages: LLMMessage[] = [summaryMessage, ...messagesToKeep];

    // Verify new token count
    const newTokens = this.tokenCounter.estimateTotalContext(
      options.systemPrompt,
      newMessages,
      options.tools
    );

    this.log.info('Context summarization complete', {
      originalMessages: messages.length,
      summarizedMessages: messagesToSummarize.length,
      keptMessages: messagesToKeep.length,
      originalTokens: currentTokens,
      newTokens,
      compressionRatio: (1 - newTokens / currentTokens).toFixed(2),
    });

    return {
      messages: newMessages,
      summarized: true,
      summary,
      estimatedTokens: newTokens,
      contextLimit,
    };
  }

  // ===========================================================================
  // Summarization Logic
  // ===========================================================================

  /**
   * Generate a summary of messages using the summary LLM.
   */
  private async summarizeMessages(
    messages: LLMMessage[],
    originalTokenCount: number
  ): Promise<ContextSummary> {
    const startTime = Date.now();

    // Format messages for summarization
    const formattedMessages = this.formatMessagesForSummary(messages);

    // Generate summary
    const response = await this.summaryLLM.generate(
      [
        {
          role: 'user',
          content: SUMMARIZATION_USER_PROMPT + formattedMessages,
        },
      ],
      {
        systemPrompt: SUMMARIZATION_SYSTEM_PROMPT,
        temperature: 0.3, // Lower temperature for more consistent summaries
        maxTokens: Math.min(2000, Math.ceil(originalTokenCount * 0.3)), // Cap summary size
      }
    );

    const summaryContent = response.content || 'Previous conversation summary: Unable to generate summary.';
    const summaryTokens = this.tokenCounter.estimateTokens(summaryContent);

    this.log.debug('Summary generated', {
      originalTokens: originalTokenCount,
      summaryTokens,
      durationMs: Date.now() - startTime,
      messagesSummarized: messages.length,
    });

    return {
      id: uuidv4(),
      content: summaryContent,
      summarizedMessageCount: messages.length,
      originalTokenCount,
      summaryTokenCount: summaryTokens,
      createdAt: new Date(),
    };
  }

  /**
   * Format messages into a readable format for summarization.
   */
  private formatMessagesForSummary(messages: LLMMessage[]): string {
    return messages.map((msg, index) => {
      let formatted = `[${index + 1}] ${msg.role.toUpperCase()}:`;

      if (msg.content) {
        formatted += ` ${msg.content}`;
      }

      if (msg.toolCalls && msg.toolCalls.length > 0) {
        formatted += '\n  Tool Calls:';
        for (const tc of msg.toolCalls) {
          formatted += `\n    - ${tc.name}(${this.truncateString(tc.arguments, 200)})`;
        }
      }

      if (msg.toolCallId) {
        formatted += ` [Response to tool: ${msg.toolCallId}]`;
      }

      return formatted;
    }).join('\n\n');
  }

  // ===========================================================================
  // Boundary Calculation
  // ===========================================================================

  /**
   * Calculate which messages should be summarized to meet target token count.
   * Uses a sliding window approach that keeps recent messages.
   */
  private calculateSummarizationBoundary(
    messages: LLMMessage[],
    targetMessageTokens: number
  ): { startIndex: number; endIndex: number; tokensToSummarize: number } {
    const minKeep = this.config.minMessagesToKeep;
    
    // Can't summarize if we don't have enough messages
    if (messages.length <= minKeep) {
      return { startIndex: -1, endIndex: -1, tokensToSummarize: 0 };
    }

    // Calculate tokens for each message from the end (most recent first)
    const messageTokens = messages.map(m => this.tokenCounter.estimateMessageTokens(m));
    
    // Find how many messages we can keep while staying under target
    let keptTokens = 0;
    let keepFromIndex = messages.length;

    // Work backwards from the end, keeping messages until we hit target
    for (let i = messages.length - 1; i >= 0; i--) {
      const newTotal = keptTokens + messageTokens[i];
      
      // Always keep minimum messages
      if (messages.length - i <= minKeep) {
        keptTokens = newTotal;
        keepFromIndex = i;
        continue;
      }

      // Stop if adding this message would exceed target
      if (newTotal > targetMessageTokens) {
        break;
      }

      keptTokens = newTotal;
      keepFromIndex = i;
    }

    // Calculate tokens being summarized
    let tokensToSummarize = 0;
    for (let i = 0; i < keepFromIndex; i++) {
      tokensToSummarize += messageTokens[i];
    }

    // Don't summarize if there's not much to summarize
    if (keepFromIndex <= 1) {
      return { startIndex: -1, endIndex: -1, tokensToSummarize: 0 };
    }

    return {
      startIndex: 0,
      endIndex: keepFromIndex,
      tokensToSummarize,
    };
  }

  // ===========================================================================
  // Utility Methods
  // ===========================================================================

  /**
   * Truncate a string to a maximum length, adding ellipsis if needed.
   */
  private truncateString(str: string, maxLength: number): string {
    if (str.length <= maxLength) return str;
    return str.slice(0, maxLength - 3) + '...';
  }

  /**
   * Update configuration at runtime.
   */
  updateConfig(config: Partial<ContextSummarizationConfig>): void {
    this.config = { ...this.config, ...config };
    this.log.info('Configuration updated', { config: this.config });
  }

  /**
   * Get current configuration.
   */
  getConfig(): ContextSummarizationConfig {
    return { ...this.config };
  }

  /**
   * Check if summarization would be triggered for given context.
   * Useful for monitoring without actually summarizing.
   */
  wouldTriggerSummarization(
    messages: LLMMessage[],
    options: {
      modelId: string;
      systemPrompt: string;
      tools?: ToolDefinition[];
    }
  ): { wouldTrigger: boolean; currentTokens: number; threshold: number } {
    const contextLimit = getModelContextLimit(options.modelId);
    const effectiveLimit = contextLimit - this.config.outputReserve;
    const threshold = effectiveLimit * this.config.triggerThreshold;

    const currentTokens = this.tokenCounter.estimateTotalContext(
      options.systemPrompt,
      messages,
      options.tools
    );

    return {
      wouldTrigger: currentTokens > threshold,
      currentTokens,
      threshold,
    };
  }
}
