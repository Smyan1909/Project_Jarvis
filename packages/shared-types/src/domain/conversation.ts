// =============================================================================
// Conversation Domain Types
// =============================================================================
// Types for the continuous conversation history feature.
// Supports session-scoped chat with summarization and metadata.

import { z } from 'zod';

// =============================================================================
// Message Metadata
// =============================================================================

/**
 * Metadata attached to messages for context and organization
 */
export const MessageMetadataSchema = z.object({
  /** Subject/topic of this message or conversation segment */
  subject: z.string().optional(),

  /** Time gap indicator (e.g., "2 days later", "3 hours later") */
  timeSinceLastMessage: z.string().optional(),

  /** Extracted intent of the message */
  intent: z.enum(['query', 'task_request', 'followup', 'clarification', 'feedback']).optional(),

  /** Source of the message (e.g., 'monitoring_agent', 'user', 'system') */
  source: z.string().optional(),

  /** Monitoring agent event ID (when source is 'monitoring_agent') */
  eventId: z.string().optional(),

  /** Trigger type for monitoring agent messages */
  triggerType: z.string().optional(),

  /** Toolkit used for monitoring agent messages (e.g., 'GITHUB', 'SLACK') */
  toolkit: z.string().optional(),

  /** Associated orchestrator run ID */
  orchestratorRunId: z.string().optional(),
});

export type MessageMetadata = z.infer<typeof MessageMetadataSchema>;

// =============================================================================
// Tool Call Storage
// =============================================================================

/**
 * Flattened tool call for storage in messages
 */
export const StoredToolCallSchema = z.object({
  /** Tool call ID (LLM-generated) */
  id: z.string(),

  /** Tool name */
  name: z.string(),

  /** Tool arguments as JSON string */
  arguments: z.string(),
});

export type StoredToolCall = z.infer<typeof StoredToolCallSchema>;

// =============================================================================
// Conversation Message
// =============================================================================

/**
 * A message in the conversation history
 */
export const ConversationMessageSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  runId: z.string().uuid().nullable(),
  role: z.enum(['user', 'assistant', 'system', 'tool']),
  content: z.string(),
  toolCallId: z.string().nullable(),
  toolCalls: z.array(StoredToolCallSchema).nullable(),
  metadata: MessageMetadataSchema.nullable(),
  createdAt: z.date(),
});

export type ConversationMessage = z.infer<typeof ConversationMessageSchema>;

// =============================================================================
// Conversation Summary
// =============================================================================

/**
 * A rolling summary of older conversation messages
 */
export const ConversationSummarySchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  content: z.string(),
  summarizedMessageCount: z.number().int().positive(),
  summarizedUpToMessageId: z.string().uuid().nullable(),
  originalTokenCount: z.number().int().nonnegative(),
  summaryTokenCount: z.number().int().nonnegative(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type ConversationSummary = z.infer<typeof ConversationSummarySchema>;

// =============================================================================
// Conversation Context (for LLM)
// =============================================================================

/**
 * Context loaded for an LLM request, including history and summary
 */
export const ConversationContextSchema = z.object({
  /** Messages to include in LLM context (may include summary as system message) */
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant', 'system', 'tool']),
    content: z.string(),
    toolCallId: z.string().optional(),
    toolCalls: z.array(StoredToolCallSchema).optional(),
  })),

  /** Whether a summary was included */
  hasSummary: z.boolean(),

  /** Total estimated tokens for this context */
  estimatedTokens: z.number().int().nonnegative(),

  /** Number of messages loaded (excluding summary) */
  messageCount: z.number().int().nonnegative(),
});

export type ConversationContext = z.infer<typeof ConversationContextSchema>;

// =============================================================================
// API Types
// =============================================================================

/**
 * Request to delete a message
 */
export const DeleteMessageRequestSchema = z.object({
  messageId: z.string().uuid(),
});

export type DeleteMessageRequest = z.infer<typeof DeleteMessageRequestSchema>;

/**
 * Response for conversation history
 */
export const ConversationHistoryResponseSchema = z.object({
  messages: z.array(ConversationMessageSchema),
  hasMore: z.boolean(),
  totalCount: z.number().int().nonnegative(),
});

export type ConversationHistoryResponse = z.infer<typeof ConversationHistoryResponseSchema>;
