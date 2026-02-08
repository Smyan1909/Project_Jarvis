import { z } from 'zod';
import {
  AgentTypeSchema,
  ReasoningStepSchema,
  InterventionActionSchema,
} from '../domain/orchestrator.js';
import { MCPConnectionStateSchema } from '../domain/mcp.js';

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
// MCP EVENTS
// =============================================================================

// =============================================================================
// MCP Server Connected Event
// =============================================================================

export const MCPServerConnectedEventSchema = z.object({
  type: z.literal('mcp.server_connected'),
  serverId: z.string().uuid(),
  serverName: z.string(),
  toolCount: z.number().int().nonnegative(),
});

export type MCPServerConnectedEvent = z.infer<typeof MCPServerConnectedEventSchema>;

// =============================================================================
// MCP Server Disconnected Event
// =============================================================================

export const MCPServerDisconnectedEventSchema = z.object({
  type: z.literal('mcp.server_disconnected'),
  serverId: z.string().uuid(),
  serverName: z.string(),
  reason: z.string().optional(),
});

export type MCPServerDisconnectedEvent = z.infer<typeof MCPServerDisconnectedEventSchema>;

// =============================================================================
// MCP Server Error Event
// =============================================================================

export const MCPServerErrorEventSchema = z.object({
  type: z.literal('mcp.server_error'),
  serverId: z.string().uuid(),
  serverName: z.string(),
  error: z.string(),
  willRetry: z.boolean(),
});

export type MCPServerErrorEvent = z.infer<typeof MCPServerErrorEventSchema>;

// =============================================================================
// MCP Tool Discovered Event
// =============================================================================

export const MCPToolDiscoveredEventSchema = z.object({
  type: z.literal('mcp.tool_discovered'),
  serverId: z.string().uuid(),
  serverName: z.string(),
  toolName: z.string(),
  toolDescription: z.string().optional(),
});

export type MCPToolDiscoveredEvent = z.infer<typeof MCPToolDiscoveredEventSchema>;

// =============================================================================
// MCP Connection State Change Event
// =============================================================================

export const MCPConnectionStateChangeEventSchema = z.object({
  type: z.literal('mcp.connection_state_change'),
  serverId: z.string().uuid(),
  serverName: z.string(),
  previousState: MCPConnectionStateSchema,
  newState: MCPConnectionStateSchema,
});

export type MCPConnectionStateChangeEvent = z.infer<typeof MCPConnectionStateChangeEventSchema>;

// =============================================================================
// MCP Event (Discriminated Union)
// =============================================================================

export const MCPEventSchema = z.discriminatedUnion('type', [
  MCPServerConnectedEventSchema,
  MCPServerDisconnectedEventSchema,
  MCPServerErrorEventSchema,
  MCPToolDiscoveredEventSchema,
  MCPConnectionStateChangeEventSchema,
]);

export type MCPEvent = z.infer<typeof MCPEventSchema>;

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
// MONITORING AGENT EVENTS
// =============================================================================

// =============================================================================
// Monitoring Event Received
// =============================================================================

export const MonitoringEventReceivedSchema = z.object({
  type: z.literal('monitoring.event_received'),
  eventId: z.string().uuid(),
  triggerType: z.string(),
  toolkit: z.enum(['GITHUB', 'SLACK']),
  title: z.string(),
  summary: z.string(),
  requiresApproval: z.boolean(),
  autoStarted: z.boolean(),
  sourceUrl: z.string().url().nullable(),
  orchestratorRunId: z.string().uuid().nullable(),
});

export type MonitoringEventReceived = z.infer<typeof MonitoringEventReceivedSchema>;

// =============================================================================
// Monitoring Event Status Change
// =============================================================================

export const MonitoringEventStatusChangeSchema = z.object({
  type: z.literal('monitoring.event_status'),
  eventId: z.string().uuid(),
  status: z.enum(['approved', 'rejected', 'in_progress', 'completed', 'failed']),
  orchestratorRunId: z.string().uuid().nullable(),
});

export type MonitoringEventStatusChange = z.infer<typeof MonitoringEventStatusChangeSchema>;

// =============================================================================
// Monitoring Source Reply
// =============================================================================

export const MonitoringSourceReplySchema = z.object({
  type: z.literal('monitoring.source_reply'),
  eventId: z.string().uuid(),
  platform: z.enum(['github', 'slack']),
  replyContent: z.string(),
});

export type MonitoringSourceReply = z.infer<typeof MonitoringSourceReplySchema>;

// =============================================================================
// Monitoring Event (Discriminated Union)
// =============================================================================

export const MonitoringEventSchema = z.discriminatedUnion('type', [
  MonitoringEventReceivedSchema,
  MonitoringEventStatusChangeSchema,
  MonitoringSourceReplySchema,
]);

export type MonitoringEvent = z.infer<typeof MonitoringEventSchema>;

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
  // MCP events
  MCPServerConnectedEventSchema,
  MCPServerDisconnectedEventSchema,
  MCPServerErrorEventSchema,
  MCPToolDiscoveredEventSchema,
  MCPConnectionStateChangeEventSchema,
  // Monitoring agent events
  MonitoringEventReceivedSchema,
  MonitoringEventStatusChangeSchema,
  MonitoringSourceReplySchema,
]);

export type StreamEvent = z.infer<typeof StreamEventSchema>;
