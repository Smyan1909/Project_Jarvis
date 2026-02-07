import { z } from 'zod';
import {
  AgentTypeSchema,
  ReasoningStepSchema,
  InterventionActionSchema,
} from '../domain/orchestrator.js';

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
// Agent Event (Discriminated Union) - Core Agent Events
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

// =============================================================================
// ORCHESTRATOR EVENTS
// =============================================================================

// =============================================================================
// Plan Created Event
// =============================================================================

export const PlanCreatedEventSchema = z.object({
  type: z.literal('plan.created'),
  planId: z.string().uuid(),
  taskCount: z.number().int().positive(),
  structure: z.enum(['dag', 'sequential']),
  tasks: z.array(
    z.object({
      id: z.string().uuid(),
      description: z.string(),
      agentType: AgentTypeSchema,
      dependencies: z.array(z.string().uuid()),
    })
  ),
});

export type PlanCreatedEvent = z.infer<typeof PlanCreatedEventSchema>;

// =============================================================================
// Plan Modified Event
// =============================================================================

export const PlanModifiedEventSchema = z.object({
  type: z.literal('plan.modified'),
  planId: z.string().uuid(),
  modification: z.enum(['task_added', 'task_removed', 'task_reordered', 'task_updated']),
  reason: z.string(),
  affectedTaskIds: z.array(z.string().uuid()),
});

export type PlanModifiedEvent = z.infer<typeof PlanModifiedEventSchema>;

// =============================================================================
// Task Started Event
// =============================================================================

export const TaskStartedEventSchema = z.object({
  type: z.literal('task.started'),
  taskId: z.string().uuid(),
  description: z.string(),
  agentType: AgentTypeSchema,
  agentId: z.string().uuid(),
});

export type TaskStartedEvent = z.infer<typeof TaskStartedEventSchema>;

// =============================================================================
// Task Progress Event
// =============================================================================

export const TaskProgressEventSchema = z.object({
  type: z.literal('task.progress'),
  taskId: z.string().uuid(),
  agentId: z.string().uuid(),
  progress: z.string(), // Human-readable progress description
});

export type TaskProgressEvent = z.infer<typeof TaskProgressEventSchema>;

// =============================================================================
// Task Completed Event
// =============================================================================

export const TaskCompletedEventSchema = z.object({
  type: z.literal('task.completed'),
  taskId: z.string().uuid(),
  success: z.boolean(),
  result: z.unknown().optional(),
  error: z.string().optional(),
});

export type TaskCompletedEvent = z.infer<typeof TaskCompletedEventSchema>;

// =============================================================================
// Agent Spawned Event
// =============================================================================

export const AgentSpawnedEventSchema = z.object({
  type: z.literal('agent.spawned'),
  agentId: z.string().uuid(),
  taskId: z.string().uuid(),
  agentType: AgentTypeSchema,
  taskDescription: z.string(),
});

export type AgentSpawnedEvent = z.infer<typeof AgentSpawnedEventSchema>;

// =============================================================================
// Agent Reasoning Event
// =============================================================================

export const AgentReasoningEventSchema = z.object({
  type: z.literal('agent.reasoning'),
  agentId: z.string().uuid(),
  step: ReasoningStepSchema,
});

export type AgentReasoningEvent = z.infer<typeof AgentReasoningEventSchema>;

// =============================================================================
// Agent Intervention Event
// =============================================================================

export const AgentInterventionEventSchema = z.object({
  type: z.literal('agent.intervention'),
  agentId: z.string().uuid(),
  taskId: z.string().uuid(),
  reason: z.string(),
  action: InterventionActionSchema,
  guidance: z.string().optional(),
});

export type AgentInterventionEvent = z.infer<typeof AgentInterventionEventSchema>;

// =============================================================================
// Agent Terminated Event
// =============================================================================

export const AgentTerminatedEventSchema = z.object({
  type: z.literal('agent.terminated'),
  agentId: z.string().uuid(),
  taskId: z.string().uuid(),
  reason: z.enum(['completed', 'failed', 'cancelled', 'loop_detected']),
  error: z.string().optional(),
});

export type AgentTerminatedEvent = z.infer<typeof AgentTerminatedEventSchema>;

// =============================================================================
// Orchestrator Status Event
// =============================================================================

export const OrchestratorStatusEventSchema = z.object({
  type: z.literal('orchestrator.status'),
  status: z.enum(['idle', 'planning', 'executing', 'monitoring', 'completed', 'failed']),
  message: z.string().optional(),
});

export type OrchestratorStatusEvent = z.infer<typeof OrchestratorStatusEventSchema>;

// =============================================================================
// Orchestrator Event (Discriminated Union)
// =============================================================================

export const OrchestratorEventSchema = z.discriminatedUnion('type', [
  // Plan events
  PlanCreatedEventSchema,
  PlanModifiedEventSchema,
  // Task events
  TaskStartedEventSchema,
  TaskProgressEventSchema,
  TaskCompletedEventSchema,
  // Agent lifecycle events
  AgentSpawnedEventSchema,
  AgentReasoningEventSchema,
  AgentInterventionEventSchema,
  AgentTerminatedEventSchema,
  // Orchestrator status
  OrchestratorStatusEventSchema,
]);

export type OrchestratorEvent = z.infer<typeof OrchestratorEventSchema>;

// =============================================================================
// Combined Event (All events that can be streamed to client)
// =============================================================================

export const StreamEventSchema = z.discriminatedUnion('type', [
  // Core agent events
  AgentTokenEventSchema,
  AgentToolCallEventSchema,
  AgentToolResultEventSchema,
  AgentFinalEventSchema,
  AgentErrorEventSchema,
  AgentStatusEventSchema,
  // Orchestrator events
  PlanCreatedEventSchema,
  PlanModifiedEventSchema,
  TaskStartedEventSchema,
  TaskProgressEventSchema,
  TaskCompletedEventSchema,
  AgentSpawnedEventSchema,
  AgentReasoningEventSchema,
  AgentInterventionEventSchema,
  AgentTerminatedEventSchema,
  OrchestratorStatusEventSchema,
]);

export type StreamEvent = z.infer<typeof StreamEventSchema>;
