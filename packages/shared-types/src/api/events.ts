import { z } from 'zod';

// =============================================================================
// Agent Token Event
// =============================================================================

export const AgentTokenEventSchema = z.object({
  type: z.literal('agent.token'),
  token: z.string(),
});

export type AgentTokenEvent = z.infer<typeof AgentTokenEventSchema>;

// =============================================================================
// Agent Tool Call Event
// =============================================================================

export const AgentToolCallEventSchema = z.object({
  type: z.literal('agent.tool_call'),
  toolId: z.string(),
  toolName: z.string(),
  input: z.unknown(),
});

export type AgentToolCallEvent = z.infer<typeof AgentToolCallEventSchema>;

// =============================================================================
// Agent Tool Result Event
// =============================================================================

export const AgentToolResultEventSchema = z.object({
  type: z.literal('agent.tool_result'),
  toolId: z.string(),
  output: z.unknown(),
  success: z.boolean(),
});

export type AgentToolResultEvent = z.infer<typeof AgentToolResultEventSchema>;

// =============================================================================
// Agent Final Event
// =============================================================================

export const AgentFinalEventSchema = z.object({
  type: z.literal('agent.final'),
  content: z.string(),
  usage: z
    .object({
      totalTokens: z.number().int().nonnegative(),
      totalCost: z.number().nonnegative(),
    })
    .optional(),
});

export type AgentFinalEvent = z.infer<typeof AgentFinalEventSchema>;

// =============================================================================
// Agent Error Event
// =============================================================================

export const AgentErrorEventSchema = z.object({
  type: z.literal('agent.error'),
  message: z.string(),
  code: z.string().optional(),
});

export type AgentErrorEvent = z.infer<typeof AgentErrorEventSchema>;

// =============================================================================
// Agent Status Event
// =============================================================================

export const AgentStatusEventSchema = z.object({
  type: z.literal('agent.status'),
  status: z.enum(['running', 'completed', 'failed', 'cancelled']),
});

export type AgentStatusEvent = z.infer<typeof AgentStatusEventSchema>;

// =============================================================================
// Agent Event (Discriminated Union)
// =============================================================================

export const AgentEventSchema = z.discriminatedUnion('type', [
  AgentTokenEventSchema,
  AgentToolCallEventSchema,
  AgentToolResultEventSchema,
  AgentFinalEventSchema,
  AgentErrorEventSchema,
  AgentStatusEventSchema,
]);

export type AgentEvent = z.infer<typeof AgentEventSchema>;
