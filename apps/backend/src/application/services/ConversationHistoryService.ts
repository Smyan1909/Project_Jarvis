// =============================================================================
// Conversation History Service
// =============================================================================
// Manages continuous conversation history for users. Handles:
// - Loading conversation context for LLM requests
// - Persisting messages after runs complete
// - Automatic summarization of older messages
// - Subject extraction and time gap detection
// - User-controlled message deletion

import type { LLMMessage, ConversationContext, MessageMetadata, StoredToolCall } from '@project-jarvis/shared-types';
import type { LLMProviderPort } from '../../ports/LLMProviderPort.js';
import { MessageRepository, type Message, type CreateMessageData } from '../../adapters/storage/message-repository.js';
import { ConversationSummaryRepository } from '../../adapters/storage/conversation-summary-repository.js';
import { TokenCounterService } from './TokenCounterService.js';
import { logger } from '../../infrastructure/logging/logger.js';

// =============================================================================
// Configuration
// =============================================================================

export interface ConversationHistoryConfig {
  /** Maximum tokens to allocate for conversation history (default: 2500) */
  maxHistoryTokens: number;

  /** Number of recent messages to load if no token limit (default: 30) */
  maxRecentMessages: number;

  /** Trigger summarization after this many unsummarized messages (default: 30) */
  summarizationThreshold: number;

  /** Keep this many recent messages after summarization (default: 10) */
  keepRecentCount: number;

  /** Time gap threshold in milliseconds to add time indicator (default: 1 hour) */
  timeGapThresholdMs: number;
}

const DEFAULT_CONFIG: ConversationHistoryConfig = {
  maxHistoryTokens: 2500,
  maxRecentMessages: 30,
  summarizationThreshold: 30,
  keepRecentCount: 10,
  timeGapThresholdMs: 60 * 60 * 1000, // 1 hour
};

// =============================================================================
// Prompts
// =============================================================================

const SUBJECT_EXTRACTION_PROMPT = `You are a concise topic extractor. Given a user message, respond with ONLY a 3-5 word topic/subject that describes what this message is about.

Examples:
- "Can you book me a flight to New York next Tuesday?" → "Flight booking to NYC"
- "What's the weather like today?" → "Weather inquiry"
- "Remind me to call mom at 5pm" → "Phone reminder for mom"
- "I need help debugging this Python code that keeps crashing" → "Python debugging help"

Respond with ONLY the topic, no explanation or punctuation.`;

const CONVERSATION_SUMMARY_PROMPT = `You are a conversation summarizer for a personal AI assistant. Create a concise summary of the following conversation history that preserves:

1. Key facts learned about the user (preferences, context, important info)
2. Tasks that were completed and their outcomes
3. Ongoing topics or unfinished business
4. Important decisions made

Format as bullet points. Be concise but preserve critical context needed to continue the conversation naturally.

Previous summary (if any):
{previousSummary}

New messages to incorporate:
{messages}

Provide an updated summary:`;

// =============================================================================
// Service
// =============================================================================

export class ConversationHistoryService {
  private config: ConversationHistoryConfig;
  private log = logger.child({ service: 'ConversationHistoryService' });

  constructor(
    private messageRepo: MessageRepository,
    private summaryRepo: ConversationSummaryRepository,
    private tokenCounter: TokenCounterService,
    private summaryLLM: LLMProviderPort,
    config?: Partial<ConversationHistoryConfig>
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ===========================================================================
  // Load Context
  // ===========================================================================

  /**
   * Load conversation context for an LLM request.
   * Returns recent messages (optionally with a summary prefix) formatted for the LLM.
   */
  async loadContext(userId: string, maxTokens?: number): Promise<ConversationContext> {
    const tokenLimit = maxTokens ?? this.config.maxHistoryTokens;
    this.log.debug('Loading conversation context', { userId, tokenLimit });

    // Validate userId is a valid UUID (required for database queries)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(userId)) {
      this.log.warn('Invalid userId format, returning empty context', { userId });
      return {
        messages: [],
        hasSummary: false,
        estimatedTokens: 0,
        messageCount: 0,
      };
    }

    // Get existing summary
    let summary = null;
    try {
      summary = await this.summaryRepo.findByUser(userId);
    } catch (error) {
      this.log.warn('Failed to load summary, continuing without', { userId, error });
    }

    // Load recent messages
    let recentMessages: Message[] = [];
    try {
      if (summary?.summarizedUpToMessageId) {
        // Get messages after the summarization point
        recentMessages = await this.messageRepo.findByUserAfterMessage(
          userId,
          summary.summarizedUpToMessageId,
          this.config.maxRecentMessages
        );
      } else {
        // No summary, get recent messages
        recentMessages = await this.messageRepo.findRecentByUser(
          userId,
          this.config.maxRecentMessages
        );
      }
    } catch (error) {
      this.log.warn('Failed to load messages, continuing without history', { userId, error });
    }

    // Convert to LLM message format with time gap detection
    const llmMessages = this.convertToLLMMessages(recentMessages);

    // Add time gaps
    const messagesWithTimeGaps = this.addTimeGapIndicators(llmMessages, recentMessages);

    // Trim to token budget
    const trimmedMessages = this.trimToTokenBudget(messagesWithTimeGaps, tokenLimit);

    // Prepend summary if exists
    const contextMessages: LLMMessage[] = [];
    if (summary) {
      contextMessages.push({
        role: 'system',
        content: `Previous conversation summary:\n${summary.content}`,
      });
    }
    contextMessages.push(...trimmedMessages);

    const estimatedTokens = this.tokenCounter.estimateMessagesTokens(contextMessages);

    this.log.debug('Context loaded', {
      userId,
      hasSummary: !!summary,
      messageCount: trimmedMessages.length,
      estimatedTokens,
    });

    return {
      messages: contextMessages,
      hasSummary: !!summary,
      estimatedTokens,
      messageCount: trimmedMessages.length,
    };
  }

  // ===========================================================================
  // Persist Messages
  // ===========================================================================

  /**
   * Persist messages from a completed run.
   * Filters to user/assistant messages and extracts subject for new conversations.
   * 
   * Note: runId is optional because the orchestrator doesn't always create an agent_run
   * record in the database. Messages are still linked to the user.
   */
  async persistRunMessages(
    userId: string,
    runId: string | null,
    llmMessages: LLMMessage[]
  ): Promise<void> {
    this.log.debug('Persisting run messages', { userId, runId, messageCount: llmMessages.length });

    // Validate userId is a valid UUID
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(userId)) {
      this.log.warn('Invalid userId format, skipping message persistence', { userId });
      return;
    }

    // Filter to persistable messages (user, assistant, tool responses)
    // Skip internal system messages
    const persistableMessages = llmMessages.filter(
      msg => msg.role === 'user' || msg.role === 'assistant' || (msg.role === 'tool' && msg.toolCallId)
    );

    if (persistableMessages.length === 0) {
      this.log.debug('No persistable messages');
      return;
    }

    // Get the last message to calculate time gap
    const lastMessage = await this.messageRepo.findLastByUser(userId);
    const now = new Date();

    // Extract subject from first user message if this is a new topic
    let subject: string | undefined;
    const firstUserMessage = persistableMessages.find(m => m.role === 'user');
    if (firstUserMessage) {
      // Check if we should extract a new subject (new conversation or time gap)
      const shouldExtractSubject = !lastMessage || 
        (now.getTime() - lastMessage.createdAt.getTime() > this.config.timeGapThresholdMs);
      
      if (shouldExtractSubject) {
        subject = await this.extractSubject(firstUserMessage.content);
        this.log.debug('Extracted subject', { subject });
      }
    }

    // Calculate time gap for first message
    let timeSinceLastMessage: string | undefined;
    if (lastMessage) {
      const gapMs = now.getTime() - lastMessage.createdAt.getTime();
      if (gapMs > this.config.timeGapThresholdMs) {
        timeSinceLastMessage = this.formatTimeGap(gapMs);
      }
    }

    // Create message records
    for (let i = 0; i < persistableMessages.length; i++) {
      const msg = persistableMessages[i];
      const isFirst = i === 0;

      const metadata: MessageMetadata = {};
      if (isFirst && subject) {
        metadata.subject = subject;
      }
      if (isFirst && timeSinceLastMessage) {
        metadata.timeSinceLastMessage = timeSinceLastMessage;
      }

      const createData: CreateMessageData = {
        userId,
        runId: runId, // Link to agent_run if provided
        role: msg.role as 'user' | 'assistant' | 'system' | 'tool',
        content: msg.content,
        toolCallId: msg.toolCallId,
        toolCalls: msg.toolCalls as StoredToolCall[] | undefined,
        metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
      };

      try {
        await this.messageRepo.create(createData);
      } catch (error) {
        this.log.error('Failed to persist message', { userId, role: msg.role, error });
        // Continue with other messages
      }
    }

    this.log.info('Messages persisted', {
      userId,
      runId,
      count: persistableMessages.length,
      subject,
    });
  }

  // ===========================================================================
  // Summarization
  // ===========================================================================

  /**
   * Check if summarization is needed and perform it if so.
   * Returns true if summarization was performed.
   */
  async maybeSummarize(userId: string): Promise<boolean> {
    // Validate userId is a valid UUID
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(userId)) {
      this.log.warn('Invalid userId format, skipping summarization check', { userId });
      return false;
    }

    // Count unsummarized messages
    let summary = null;
    try {
      summary = await this.summaryRepo.findByUser(userId);
    } catch (error) {
      this.log.warn('Failed to check summary, skipping summarization', { userId, error });
      return false;
    }
    
    let unsummarizedCount: number;
    if (summary?.summarizedUpToMessageId) {
      unsummarizedCount = await this.messageRepo.countByUserAfterMessage(
        userId,
        summary.summarizedUpToMessageId
      );
    } else {
      unsummarizedCount = await this.messageRepo.countByUser(userId);
    }

    this.log.debug('Checking summarization', { userId, unsummarizedCount, threshold: this.config.summarizationThreshold });

    if (unsummarizedCount < this.config.summarizationThreshold) {
      return false;
    }

    this.log.info('Triggering summarization', { userId, unsummarizedCount });

    // Get messages to summarize
    let messagesToProcess: Message[];
    if (summary?.summarizedUpToMessageId) {
      messagesToProcess = await this.messageRepo.findByUserAfterMessage(
        userId,
        summary.summarizedUpToMessageId,
        this.config.summarizationThreshold + this.config.keepRecentCount
      );
    } else {
      messagesToProcess = await this.messageRepo.findRecentByUser(
        userId,
        this.config.summarizationThreshold + this.config.keepRecentCount
      );
    }

    // Keep the last N messages, summarize the rest
    const keepCount = Math.min(this.config.keepRecentCount, messagesToProcess.length);
    const toSummarize = messagesToProcess.slice(0, -keepCount);
    
    if (toSummarize.length === 0) {
      this.log.debug('Nothing to summarize after keeping recent');
      return false;
    }

    const lastSummarizedMessage = toSummarize[toSummarize.length - 1];

    // Generate summary
    const newSummaryContent = await this.generateSummary(
      summary?.content || null,
      toSummarize
    );

    // Calculate token counts
    const originalTokens = this.tokenCounter.estimateMessagesTokens(
      this.convertToLLMMessages(toSummarize)
    );
    const summaryTokens = this.tokenCounter.estimateTokens(newSummaryContent);

    // Upsert summary
    await this.summaryRepo.upsert(userId, {
      content: newSummaryContent,
      summarizedMessageCount: (summary?.summarizedMessageCount || 0) + toSummarize.length,
      summarizedUpToMessageId: lastSummarizedMessage.id,
      originalTokenCount: (summary?.originalTokenCount || 0) + originalTokens,
      summaryTokenCount: summaryTokens,
    });

    this.log.info('Summarization complete', {
      userId,
      summarizedCount: toSummarize.length,
      originalTokens,
      summaryTokens,
      compressionRatio: (1 - summaryTokens / originalTokens).toFixed(2),
    });

    return true;
  }

  /**
   * Generate a summary of messages, optionally incorporating a previous summary.
   */
  private async generateSummary(
    previousSummary: string | null,
    messages: Message[]
  ): Promise<string> {
    const formattedMessages = messages
      .map(m => `[${m.role.toUpperCase()}]: ${m.content}`)
      .join('\n\n');

    const prompt = CONVERSATION_SUMMARY_PROMPT
      .replace('{previousSummary}', previousSummary || '(none)')
      .replace('{messages}', formattedMessages);

    const response = await this.summaryLLM.generate(
      [{ role: 'user', content: prompt }],
      {
        temperature: 0.3,
        maxTokens: 1000,
      }
    );

    return response.content || 'Unable to generate summary.';
  }

  // ===========================================================================
  // Subject Extraction
  // ===========================================================================

  /**
   * Extract a subject/topic from a user message.
   */
  async extractSubject(userMessage: string): Promise<string> {
    try {
      const response = await this.summaryLLM.generate(
        [
          { role: 'system', content: SUBJECT_EXTRACTION_PROMPT },
          { role: 'user', content: userMessage },
        ],
        {
          temperature: 0.3,
          maxTokens: 50,
        }
      );

      return response.content?.trim() || 'General conversation';
    } catch (error) {
      this.log.warn('Failed to extract subject', { error });
      return 'General conversation';
    }
  }

  // ===========================================================================
  // Message Deletion
  // ===========================================================================

  /**
   * Delete a specific message (user-controlled deletion).
   */
  async deleteMessage(userId: string, messageId: string): Promise<boolean> {
    this.log.info('Deleting message', { userId, messageId });
    return this.messageRepo.deleteByIdAndUser(messageId, userId);
  }

  /**
   * Clear all conversation history for a user.
   */
  async clearHistory(userId: string): Promise<void> {
    this.log.info('Clearing conversation history', { userId });
    
    // Delete summary first (due to foreign key)
    await this.summaryRepo.deleteByUser(userId);
    
    // Delete all messages
    const deletedCount = await this.messageRepo.deleteAllByUser(userId);
    
    this.log.info('History cleared', { userId, deletedCount });
  }

  // ===========================================================================
  // History Retrieval (for UI)
  // ===========================================================================

  /**
   * Get conversation history for display in the UI.
   */
  async getHistory(
    userId: string,
    limit: number = 50
  ): Promise<{ messages: Message[]; totalCount: number }> {
    const messages = await this.messageRepo.findRecentByUser(userId, limit);
    const totalCount = await this.messageRepo.countByUser(userId);

    return { messages, totalCount };
  }

  // ===========================================================================
  // Helper Methods
  // ===========================================================================

  /**
   * Convert database messages to LLM message format.
   */
  private convertToLLMMessages(messages: Message[]): LLMMessage[] {
    return messages.map(m => ({
      role: m.role as 'user' | 'assistant' | 'system' | 'tool',
      content: m.content,
      toolCallId: m.toolCallId || undefined,
      toolCalls: m.toolCalls || undefined,
    }));
  }

  /**
   * Add time gap indicators to messages.
   */
  private addTimeGapIndicators(llmMessages: LLMMessage[], dbMessages: Message[]): LLMMessage[] {
    const result: LLMMessage[] = [];

    for (let i = 0; i < llmMessages.length; i++) {
      const msg = llmMessages[i];
      const dbMsg = dbMessages[i];

      // Check if this message has a time gap in metadata
      if (dbMsg.metadata?.timeSinceLastMessage) {
        // Prepend time gap to the message content
        const modifiedContent = `[${dbMsg.metadata.timeSinceLastMessage}]\n${msg.content}`;
        result.push({ ...msg, content: modifiedContent });
      } else {
        result.push(msg);
      }
    }

    return result;
  }

  /**
   * Trim messages to fit within token budget, keeping most recent.
   * Ensures tool call sequences are not broken (tool messages must have preceding assistant with tool_calls).
   */
  private trimToTokenBudget(messages: LLMMessage[], maxTokens: number): LLMMessage[] {
    if (messages.length === 0) return [];

    // First, validate and fix message sequences
    const validatedMessages = this.validateAndFixMessageSequence(messages);

    // Start from the end (most recent) and work backwards
    const result: LLMMessage[] = [];
    let tokenCount = 0;

    for (let i = validatedMessages.length - 1; i >= 0; i--) {
      const msgTokens = this.tokenCounter.estimateMessageTokens(validatedMessages[i]);
      
      if (tokenCount + msgTokens > maxTokens && result.length > 0) {
        // Before breaking, check if we're in the middle of a tool call sequence
        // If the first message in result is a 'tool' message, we need to also include
        // all preceding tool messages and their assistant message
        if (result.length > 0 && result[0].role === 'tool') {
          // Find and remove orphaned tool messages from the start
          while (result.length > 0 && result[0].role === 'tool') {
            result.shift();
          }
        }
        break; // Would exceed budget
      }

      result.unshift(validatedMessages[i]);
      tokenCount += msgTokens;
    }

    // Final validation: ensure we don't start with a tool message
    while (result.length > 0 && result[0].role === 'tool') {
      result.shift();
    }

    return result;
  }

  /**
   * Validate and fix message sequences to ensure OpenAI API compatibility.
   * Rules:
   * - Tool messages must be preceded by an assistant message with tool_calls
   * - Assistant messages with tool_calls must be followed by matching tool messages
   */
  private validateAndFixMessageSequence(messages: LLMMessage[]): LLMMessage[] {
    const result: LLMMessage[] = [];
    let lastAssistantWithToolCalls: LLMMessage | null = null;
    const pendingToolCallIds = new Set<string>();

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];

      if (msg.role === 'assistant') {
        // If there are pending tool calls from a previous assistant, those tool results are missing
        // We need to skip those orphaned sequences
        if (pendingToolCallIds.size > 0) {
          this.log.warn('Orphaned assistant message with pending tool calls, removing', {
            pendingCount: pendingToolCallIds.size,
          });
          // Remove the previous assistant message that had tool_calls without results
          if (result.length > 0 && result[result.length - 1] === lastAssistantWithToolCalls) {
            result.pop();
          }
          pendingToolCallIds.clear();
        }

        result.push(msg);

        if (msg.toolCalls && msg.toolCalls.length > 0) {
          lastAssistantWithToolCalls = msg;
          for (const tc of msg.toolCalls) {
            pendingToolCallIds.add(tc.id);
          }
        } else {
          lastAssistantWithToolCalls = null;
        }
      } else if (msg.role === 'tool') {
        const toolCallId = msg.toolCallId;
        
        if (!toolCallId || !pendingToolCallIds.has(toolCallId)) {
          // This tool message doesn't match any pending tool call - skip it
          this.log.warn('Orphaned tool message without matching tool_call, skipping', {
            toolCallId,
            hasPending: pendingToolCallIds.size > 0,
          });
          continue;
        }

        result.push(msg);
        pendingToolCallIds.delete(toolCallId);

        // If all tool calls are satisfied, clear the reference
        if (pendingToolCallIds.size === 0) {
          lastAssistantWithToolCalls = null;
        }
      } else {
        // user or system message
        // If there are pending tool calls, that sequence is broken
        if (pendingToolCallIds.size > 0) {
          this.log.warn('Tool call sequence interrupted by user/system message, removing incomplete sequence', {
            role: msg.role,
            pendingCount: pendingToolCallIds.size,
          });
          // Remove the orphaned assistant message
          if (result.length > 0 && result[result.length - 1] === lastAssistantWithToolCalls) {
            result.pop();
          }
          pendingToolCallIds.clear();
          lastAssistantWithToolCalls = null;
        }

        result.push(msg);
      }
    }

    // If there are still pending tool calls at the end, the sequence is incomplete
    if (pendingToolCallIds.size > 0 && lastAssistantWithToolCalls) {
      this.log.warn('Incomplete tool call sequence at end of history, removing', {
        pendingCount: pendingToolCallIds.size,
      });
      // Remove the assistant message and any partial tool results
      const assistantIndex = result.indexOf(lastAssistantWithToolCalls);
      if (assistantIndex >= 0) {
        result.splice(assistantIndex);
      }
    }

    return result;
  }

  /**
   * Format a time gap in milliseconds to a human-readable string.
   */
  private formatTimeGap(gapMs: number): string {
    const minutes = Math.floor(gapMs / (60 * 1000));
    const hours = Math.floor(gapMs / (60 * 60 * 1000));
    const days = Math.floor(gapMs / (24 * 60 * 60 * 1000));

    if (days > 0) {
      return days === 1 ? '1 day later' : `${days} days later`;
    } else if (hours > 0) {
      return hours === 1 ? '1 hour later' : `${hours} hours later`;
    } else if (minutes > 0) {
      return minutes === 1 ? '1 minute later' : `${minutes} minutes later`;
    }
    return 'moments later';
  }

  /**
   * Update configuration at runtime.
   */
  updateConfig(config: Partial<ConversationHistoryConfig>): void {
    this.config = { ...this.config, ...config };
    this.log.info('Configuration updated', { config: this.config });
  }
}
