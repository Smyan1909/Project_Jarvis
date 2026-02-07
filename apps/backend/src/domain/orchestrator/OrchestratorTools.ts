// =============================================================================
// Orchestrator Tools
// =============================================================================
// Tools available exclusively to the orchestrator LLM for autonomous operation.
// These tools allow the orchestrator to plan, delegate, monitor, and control.

import type { ToolDefinition } from '@project-jarvis/shared-types';

// =============================================================================
// Tool: create_task_plan
// =============================================================================

export const CREATE_TASK_PLAN_TOOL: ToolDefinition = {
  id: 'create_task_plan',
  name: 'create_task_plan',
  description: `Create a plan (DAG) of tasks to accomplish the user's request. 
Use this when the request requires multiple steps or coordination between different capabilities.
Each task should be assigned to the most appropriate agent type.
Tasks with no dependencies can run in parallel.
Tasks that depend on other tasks will wait for their dependencies to complete.`,
  parameters: {
    type: 'object',
    properties: {
      reasoning: {
        type: 'string',
        description: 'Your reasoning for why this plan structure is optimal',
      },
      tasks: {
        type: 'array',
        description: 'Array of tasks in the plan',
        items: {
          type: 'object',
          description: 'A single task node',
        },
      },
    },
    required: ['reasoning', 'tasks'],
  },
};

// Task item schema (for documentation - actual validation in service)
// {
//   tempId: string,           // Temporary ID for referencing in dependencies (e.g., "task_1")
//   description: string,      // Clear description of what this task should accomplish
//   agentType: AgentType,     // Which agent type to use
//   dependencies: string[],   // Array of tempIds this task depends on
// }

// =============================================================================
// Tool: modify_plan
// =============================================================================

export const MODIFY_PLAN_TOOL: ToolDefinition = {
  id: 'modify_plan',
  name: 'modify_plan',
  description: `Modify the current task plan. Use this to:
- Add new tasks discovered during execution
- Remove tasks that are no longer needed
- Update task descriptions or agent assignments
- Reorder dependencies based on new information`,
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['add', 'remove', 'update', 'reorder'],
        description: 'The type of modification to make',
      },
      reason: {
        type: 'string',
        description: 'Why this modification is needed',
      },
      taskId: {
        type: 'string',
        description: 'ID of the task to modify (for remove/update/reorder)',
      },
      newTask: {
        type: 'object',
        description: 'New task details (for add/update)',
      },
      newDependencies: {
        type: 'array',
        description: 'New dependency list (for reorder)',
        items: { type: 'string' },
      },
    },
    required: ['action', 'reason'],
  },
};

// =============================================================================
// Tool: start_agent
// =============================================================================

export const START_AGENT_TOOL: ToolDefinition = {
  id: 'start_agent',
  name: 'start_agent',
  description: `Spawn a sub-agent to execute a specific task from the plan.
The agent will have access to tools based on its type, plus any additional tools you specify.
The agent will receive context from completed dependency tasks automatically.
You can provide additional instructions to guide the agent's behavior.`,
  parameters: {
    type: 'object',
    properties: {
      taskId: {
        type: 'string',
        description: 'ID of the task to execute',
      },
      additionalTools: {
        type: 'array',
        description: 'Optional additional tool IDs to grant this agent',
        items: { type: 'string' },
      },
      instructions: {
        type: 'string',
        description: 'Optional specific instructions for this agent',
      },
    },
    required: ['taskId'],
  },
};

// =============================================================================
// Tool: monitor_agent
// =============================================================================

export const MONITOR_AGENT_TOOL: ToolDefinition = {
  id: 'monitor_agent',
  name: 'monitor_agent',
  description: `Check the current state of a running sub-agent.
Returns the agent's status, recent reasoning steps, tool calls, and progress.
Use this to decide if intervention is needed.`,
  parameters: {
    type: 'object',
    properties: {
      agentId: {
        type: 'string',
        description: 'ID of the agent to monitor',
      },
    },
    required: ['agentId'],
  },
};

// =============================================================================
// Tool: intervene_agent
// =============================================================================

export const INTERVENE_AGENT_TOOL: ToolDefinition = {
  id: 'intervene_agent',
  name: 'intervene_agent',
  description: `Intervene in a running sub-agent's execution.
Use this when you observe an agent:
- Going off-track from its assigned task
- Making repeated mistakes
- Stuck in an unproductive loop
- Missing important context

Actions:
- guide: Send guidance message to help the agent
- redirect: Provide new instructions and refocus the agent
- cancel: Stop the agent entirely (use mark_task_failed after)`,
  parameters: {
    type: 'object',
    properties: {
      agentId: {
        type: 'string',
        description: 'ID of the agent to intervene',
      },
      action: {
        type: 'string',
        enum: ['guide', 'redirect', 'cancel'],
        description: 'Type of intervention',
      },
      reason: {
        type: 'string',
        description: 'Why intervention is needed',
      },
      guidance: {
        type: 'string',
        description: 'Guidance message to send to the agent (for guide/redirect)',
      },
    },
    required: ['agentId', 'action', 'reason'],
  },
};

// =============================================================================
// Tool: cancel_agent
// =============================================================================

export const CANCEL_AGENT_TOOL: ToolDefinition = {
  id: 'cancel_agent',
  name: 'cancel_agent',
  description: `Immediately terminate a sub-agent.
Use this for agents that need to be stopped without intervention.
The task will be marked as cancelled automatically.`,
  parameters: {
    type: 'object',
    properties: {
      agentId: {
        type: 'string',
        description: 'ID of the agent to cancel',
      },
      reason: {
        type: 'string',
        description: 'Why the agent is being cancelled',
      },
    },
    required: ['agentId', 'reason'],
  },
};

// =============================================================================
// Tool: mark_task_complete
// =============================================================================

export const MARK_TASK_COMPLETE_TOOL: ToolDefinition = {
  id: 'mark_task_complete',
  name: 'mark_task_complete',
  description: `Mark a task as successfully completed.
Use this when you've verified the task result is satisfactory.
The result will be passed as context to dependent tasks.`,
  parameters: {
    type: 'object',
    properties: {
      taskId: {
        type: 'string',
        description: 'ID of the task to mark complete',
      },
      result: {
        type: 'object',
        description: 'The result/output of the task',
      },
      summary: {
        type: 'string',
        description: 'Brief summary of what was accomplished',
      },
    },
    required: ['taskId', 'summary'],
  },
};

// =============================================================================
// Tool: mark_task_failed
// =============================================================================

export const MARK_TASK_FAILED_TOOL: ToolDefinition = {
  id: 'mark_task_failed',
  name: 'mark_task_failed',
  description: `Mark a task as failed.
Use this when a task cannot be completed after retries.
Consider modifying the plan to work around the failure if possible.`,
  parameters: {
    type: 'object',
    properties: {
      taskId: {
        type: 'string',
        description: 'ID of the task to mark failed',
      },
      error: {
        type: 'string',
        description: 'Description of why the task failed',
      },
      shouldRetry: {
        type: 'boolean',
        description: 'Whether to retry this task with a different approach',
      },
      retryStrategy: {
        type: 'string',
        description: 'If retrying, what approach to try next',
      },
    },
    required: ['taskId', 'error'],
  },
};

// =============================================================================
// Tool: store_memory
// =============================================================================

export const STORE_MEMORY_TOOL: ToolDefinition = {
  id: 'store_memory',
  name: 'store_memory',
  description: `Store important information in long-term memory for future reference.
Use this to remember:
- User preferences
- Important facts the user shared
- Key decisions made
- Recurring patterns

Do NOT store:
- Transient task details
- Obvious context
- Temporary information`,
  parameters: {
    type: 'object',
    properties: {
      content: {
        type: 'string',
        description: 'The information to remember',
      },
      category: {
        type: 'string',
        enum: ['preference', 'fact', 'decision', 'pattern', 'general'],
        description: 'Category of the memory',
      },
      metadata: {
        type: 'object',
        description: 'Optional additional metadata',
      },
    },
    required: ['content', 'category'],
  },
};

// =============================================================================
// Tool: respond_to_user
// =============================================================================

export const RESPOND_TO_USER_TOOL: ToolDefinition = {
  id: 'respond_to_user',
  name: 'respond_to_user',
  description: `Send the final response to the user.
Use this when:
- All tasks are complete
- You can directly answer a simple question
- You need to report on task progress or results

The response should be helpful, concise, and include relevant artifacts if produced.`,
  parameters: {
    type: 'object',
    properties: {
      content: {
        type: 'string',
        description: 'The response message to send to the user',
      },
      includeArtifacts: {
        type: 'boolean',
        description: 'Whether to include artifacts produced by sub-agents',
      },
      artifactIds: {
        type: 'array',
        description: 'Specific artifact IDs to include (if not all)',
        items: { type: 'string' },
      },
    },
    required: ['content'],
  },
};

// =============================================================================
// Tool: get_plan_status
// =============================================================================

export const GET_PLAN_STATUS_TOOL: ToolDefinition = {
  id: 'get_plan_status',
  name: 'get_plan_status',
  description: `Get the current status of the task plan.
Returns information about all tasks, their status, and running agents.
Use this to understand overall progress and decide next actions.`,
  parameters: {
    type: 'object',
    properties: {},
  },
};

// =============================================================================
// Orchestrator-Only Tools Collection
// =============================================================================

export const ORCHESTRATOR_TOOLS: ToolDefinition[] = [
  CREATE_TASK_PLAN_TOOL,
  MODIFY_PLAN_TOOL,
  START_AGENT_TOOL,
  MONITOR_AGENT_TOOL,
  INTERVENE_AGENT_TOOL,
  CANCEL_AGENT_TOOL,
  MARK_TASK_COMPLETE_TOOL,
  MARK_TASK_FAILED_TOOL,
  STORE_MEMORY_TOOL,
  RESPOND_TO_USER_TOOL,
  GET_PLAN_STATUS_TOOL,
];

// IDs of tools that only the orchestrator can use (sub-agents cannot)
export const ORCHESTRATOR_ONLY_TOOL_IDS = new Set([
  'create_task_plan',
  'modify_plan',
  'start_agent',
  'monitor_agent',
  'intervene_agent',
  'cancel_agent',
  'mark_task_complete',
  'mark_task_failed',
  'store_memory',
  'respond_to_user',
  'get_plan_status',
]);
