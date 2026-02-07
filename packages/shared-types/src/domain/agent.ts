import { z } from 'zod';

// =============================================================================
// Agent Run Status
// =============================================================================

export const AgentRunStatusSchema = z.enum([
  'pending',
  'running',
  'completed',
  'failed',
  'cancelled',
]);

export type AgentRunStatus = z.infer<typeof AgentRunStatusSchema>;

// =============================================================================
// Agent Run
// =============================================================================

export const AgentRunSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  status: AgentRunStatusSchema,
  totalTokens: z.number().int().nonnegative(),
  totalCost: z.number().nonnegative(), // Cost in USD
  startedAt: z.date(),
  completedAt: z.date().nullable(),
});

export type AgentRun = z.infer<typeof AgentRunSchema>;

// =============================================================================
// Message Role
// =============================================================================

export const MessageRoleSchema = z.enum(['user', 'assistant', 'system', 'tool']);

export type MessageRole = z.infer<typeof MessageRoleSchema>;

// =============================================================================
// Message
// =============================================================================

export const MessageSchema = z.object({
  id: z.string().uuid(),
  runId: z.string().uuid(),
  role: MessageRoleSchema,
  content: z.string(),
  toolCallId: z.string().nullable(), // Present when role is 'tool'
  createdAt: z.date(),
});

export type Message = z.infer<typeof MessageSchema>;

// =============================================================================
// Tool Call Status
// =============================================================================

export const ToolCallStatusSchema = z.enum(['pending', 'success', 'error']);

export type ToolCallStatus = z.infer<typeof ToolCallStatusSchema>;

// =============================================================================
// Tool Call
// =============================================================================

export const ToolCallSchema = z.object({
  id: z.string().uuid(),
  runId: z.string().uuid(),
  toolId: z.string(),
  input: z.record(z.string(), z.unknown()),
  output: z.record(z.string(), z.unknown()).nullable(),
  status: ToolCallStatusSchema,
  durationMs: z.number().int().nonnegative().nullable(),
  createdAt: z.date(),
});

export type ToolCall = z.infer<typeof ToolCallSchema>;

// =============================================================================
// LLM Tool Call (for LLM responses)
// =============================================================================

export const LLMToolCallSchema = z.object({
  id: z.string(),
  name: z.string(),
  arguments: z.string(), // JSON string - parsed by the caller
});

export type LLMToolCall = z.infer<typeof LLMToolCallSchema>;

// =============================================================================
// LLM Message (for sending to LLM providers)
// =============================================================================

export const LLMMessageSchema = z.object({
  role: z.enum(['user', 'assistant', 'system', 'tool']),
  content: z.string(),
  toolCallId: z.string().optional(),
  toolCalls: z.array(LLMToolCallSchema).optional(),
});

export type LLMMessage = z.infer<typeof LLMMessageSchema>;

// =============================================================================
// LLM Usage
// =============================================================================

export const LLMUsageSchema = z.object({
  promptTokens: z.number().int().nonnegative(),
  completionTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
});

export type LLMUsage = z.infer<typeof LLMUsageSchema>;

// =============================================================================
// LLM Finish Reason
// =============================================================================

export const LLMFinishReasonSchema = z.enum(['stop', 'tool_calls', 'length', 'error']);

export type LLMFinishReason = z.infer<typeof LLMFinishReasonSchema>;

// =============================================================================
// LLM Response
// =============================================================================

export const LLMResponseSchema = z.object({
  content: z.string().nullable(),
  toolCalls: z.array(LLMToolCallSchema),
  usage: LLMUsageSchema,
  finishReason: LLMFinishReasonSchema,
});

export type LLMResponse = z.infer<typeof LLMResponseSchema>;

// =============================================================================
// Tool Parameter
// =============================================================================

export const ToolParameterSchema: z.ZodType<ToolParameter> = z.lazy(() =>
  z.object({
    type: z.enum(['string', 'number', 'boolean', 'array', 'object']),
    description: z.string().optional(),
    enum: z.array(z.string()).optional(),
    items: ToolParameterSchema.optional(),
    // For object types - nested properties
    properties: z.record(z.string(), ToolParameterSchema).optional(),
    required: z.array(z.string()).optional(),
  })
);

export interface ToolParameter {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description?: string;
  enum?: string[];
  items?: ToolParameter;
  // For object types - nested properties
  properties?: Record<string, ToolParameter>;
  required?: string[];
}

// =============================================================================
// Tool Parameters (JSON Schema-like object)
// =============================================================================

export const ToolParametersSchema = z.object({
  type: z.literal('object'),
  properties: z.record(z.string(), ToolParameterSchema),
  required: z.array(z.string()).optional(),
});

export type ToolParameters = z.infer<typeof ToolParametersSchema>;

// =============================================================================
// Tool Definition
// =============================================================================

export const ToolDefinitionSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  parameters: ToolParametersSchema,
});

export type ToolDefinition = z.infer<typeof ToolDefinitionSchema>;

// =============================================================================
// Tool Result
// =============================================================================

export const ToolResultSchema = z.object({
  success: z.boolean(),
  output: z.unknown(),
  error: z.string().optional(),
});

export type ToolResult = z.infer<typeof ToolResultSchema>;
