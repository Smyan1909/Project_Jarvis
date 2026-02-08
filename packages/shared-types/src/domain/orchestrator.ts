import { z } from 'zod';
import { LLMMessageSchema, ToolCallSchema } from './agent.js';

// =============================================================================
// Agent Types (Specialized Agents)
// =============================================================================

export const AgentTypeSchema = z.enum([
  'general',      // General-purpose, fallback when unclear
  'research',     // Information gathering, web search, fact-checking
  'coding',       // Programming, code analysis, file operations
  'scheduling',   // Calendar management, appointments, reminders
  'productivity', // Todo lists, notes, document management
  'messaging',    // Email, SMS, notifications
]);

export type AgentType = z.infer<typeof AgentTypeSchema>;

// =============================================================================
// Task Node Status
// =============================================================================

export const TaskNodeStatusSchema = z.enum([
  'pending',      // Not yet started
  'in_progress',  // Currently being executed
  'completed',    // Successfully finished
  'failed',       // Failed after retries
  'cancelled',    // Cancelled by orchestrator
]);

export type TaskNodeStatus = z.infer<typeof TaskNodeStatusSchema>;

// =============================================================================
// Task Node (Node in the DAG)
// =============================================================================

export const TaskNodeSchema = z.object({
  id: z.string().uuid(),
  description: z.string(),                         // What this task should accomplish
  agentType: AgentTypeSchema,                      // Which specialized agent to use
  status: TaskNodeStatusSchema,
  dependencies: z.array(z.string().uuid()),        // IDs of tasks that must complete first
  assignedAgentId: z.string().uuid().nullable(),   // Sub-agent handling this task
  result: z.unknown().nullable(),                  // Output from the task
  retryCount: z.number().int().nonnegative(),      // For loop detection
  createdAt: z.date(),
  completedAt: z.date().nullable(),
});

export type TaskNode = z.infer<typeof TaskNodeSchema>;

// =============================================================================
// Task Plan Status
// =============================================================================

export const TaskPlanStatusSchema = z.enum([
  'planning',    // Plan is being created
  'executing',   // Plan is being executed
  'completed',   // All tasks completed successfully
  'failed',      // Plan failed (unrecoverable)
]);

export type TaskPlanStatus = z.infer<typeof TaskPlanStatusSchema>;

// =============================================================================
// Task Plan (DAG Structure)
// =============================================================================

export const TaskPlanSchema = z.object({
  id: z.string().uuid(),
  runId: z.string().uuid(),
  nodes: z.array(TaskNodeSchema),
  status: TaskPlanStatusSchema,
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type TaskPlan = z.infer<typeof TaskPlanSchema>;

// =============================================================================
// Reasoning Step (For Observability)
// =============================================================================

export const ReasoningStepTypeSchema = z.enum([
  'thinking',    // Internal reasoning/analysis
  'decision',    // A decision point
  'observation', // Observation about results or state
]);

export type ReasoningStepType = z.infer<typeof ReasoningStepTypeSchema>;

export const ReasoningStepSchema = z.object({
  id: z.string().uuid(),
  timestamp: z.date(),
  type: ReasoningStepTypeSchema,
  content: z.string(),
});

export type ReasoningStep = z.infer<typeof ReasoningStepSchema>;

// =============================================================================
// Artifact (Produced by Agents)
// =============================================================================

export const ArtifactTypeSchema = z.enum([
  'text',   // Plain text output
  'code',   // Code snippet or file
  'data',   // Structured data (JSON, etc.)
  'file',   // File reference
]);

export type ArtifactType = z.infer<typeof ArtifactTypeSchema>;

export const ArtifactSchema = z.object({
  id: z.string().uuid(),
  type: ArtifactTypeSchema,
  name: z.string(),
  content: z.unknown(),
  createdAt: z.date(),
});

export type Artifact = z.infer<typeof ArtifactSchema>;

// =============================================================================
// Sub-Agent Status
// =============================================================================

export const SubAgentStatusSchema = z.enum([
  'initializing', // Agent is being set up
  'running',      // Agent is actively executing
  'completed',    // Agent finished successfully
  'failed',       // Agent failed
  'cancelled',    // Agent was cancelled by orchestrator
]);

export type SubAgentStatus = z.infer<typeof SubAgentStatusSchema>;

// =============================================================================
// Sub-Agent State
// =============================================================================

export const SubAgentStateSchema = z.object({
  id: z.string().uuid(),
  runId: z.string().uuid(),
  taskNodeId: z.string().uuid(),
  agentType: AgentTypeSchema,
  status: SubAgentStatusSchema,

  // Task context
  taskDescription: z.string(),
  upstreamContext: z.string().nullable(),          // Results from dependency tasks
  additionalTools: z.array(z.string()),            // Extra tools granted by orchestrator

  // Execution state
  messages: z.array(LLMMessageSchema),
  toolCalls: z.array(ToolCallSchema),
  reasoningSteps: z.array(ReasoningStepSchema),
  artifacts: z.array(ArtifactSchema),

  // Metrics
  totalTokens: z.number().int().nonnegative(),
  totalCost: z.number().nonnegative(),
  startedAt: z.date(),
  completedAt: z.date().nullable(),
});

export type SubAgentState = z.infer<typeof SubAgentStateSchema>;

// =============================================================================
// Orchestrator Status
// =============================================================================

export const OrchestratorStatusSchema = z.enum([
  'idle',       // Waiting for input
  'planning',   // Creating task plan
  'executing',  // Executing tasks
  'monitoring', // Monitoring sub-agents
  'completed',  // All done
  'failed',     // Failed
]);

export type OrchestratorStatus = z.infer<typeof OrchestratorStatusSchema>;

// =============================================================================
// Orchestrator State
// =============================================================================

export const OrchestratorStateSchema = z.object({
  id: z.string().uuid(),
  runId: z.string().uuid(),
  userId: z.string().uuid(),
  status: OrchestratorStatusSchema,

  // The task plan (DAG)
  plan: TaskPlanSchema.nullable(),

  // Active sub-agents (stored as array, converted to Map in runtime)
  activeAgentIds: z.array(z.string().uuid()),

  // Loop detection
  loopCounters: z.record(z.string(), z.number().int().nonnegative()), // taskNodeId -> retry count
  totalInterventions: z.number().int().nonnegative(),

  // Metrics
  totalTokens: z.number().int().nonnegative(),
  totalCost: z.number().nonnegative(),
  startedAt: z.date(),
  completedAt: z.date().nullable(),
});

export type OrchestratorState = z.infer<typeof OrchestratorStateSchema>;

// =============================================================================
// Loop Detection Configuration
// =============================================================================

export const LoopDetectionConfigSchema = z.object({
  maxRetriesPerTask: z.number().int().positive().default(3),
  maxTotalInterventions: z.number().int().positive().default(10),
});

export type LoopDetectionConfig = z.infer<typeof LoopDetectionConfigSchema>;

// Default loop detection config (conservative)
export const DEFAULT_LOOP_DETECTION_CONFIG: LoopDetectionConfig = {
  maxRetriesPerTask: 3,
  maxTotalInterventions: 10,
};

// =============================================================================
// Create Task Node Input (For tool calls)
// =============================================================================

export const CreateTaskNodeInputSchema = z.object({
  description: z.string(),
  agentType: AgentTypeSchema,
  dependencies: z.array(z.string()).default([]),  // Can be temp IDs during planning
});

export type CreateTaskNodeInput = z.infer<typeof CreateTaskNodeInputSchema>;

// =============================================================================
// Plan Modification Actions
// =============================================================================

export const PlanModificationActionSchema = z.enum([
  'add',      // Add a new task
  'remove',   // Remove a task
  'reorder',  // Change task dependencies
  'update',   // Update task details
]);

export type PlanModificationAction = z.infer<typeof PlanModificationActionSchema>;

// =============================================================================
// Intervention Actions
// =============================================================================

export const InterventionActionSchema = z.enum([
  'guide',    // Provide guidance to keep agent on track
  'redirect', // Redirect agent to a different approach
  'cancel',   // Cancel the agent entirely
]);

export type InterventionAction = z.infer<typeof InterventionActionSchema>;

// =============================================================================
// Sub-Agent Result
// =============================================================================

export const SubAgentResultSchema = z.object({
  success: z.boolean(),
  output: z.unknown().nullable(),
  error: z.string().nullable(),
  artifacts: z.array(ArtifactSchema),
  totalTokens: z.number().int().nonnegative(),
  totalCost: z.number().nonnegative(),
});

export type SubAgentResult = z.infer<typeof SubAgentResultSchema>;

// =============================================================================
// Spawn Agent Configuration
// =============================================================================

export const SpawnAgentConfigSchema = z.object({
  taskNodeId: z.string().uuid(),
  agentType: AgentTypeSchema,
  taskDescription: z.string(),
  upstreamContext: z.string().nullable(),
  additionalTools: z.array(z.string()).default([]),
  instructions: z.string().optional(),  // Optional extra instructions from orchestrator
});

export type SpawnAgentConfig = z.infer<typeof SpawnAgentConfigSchema>;
