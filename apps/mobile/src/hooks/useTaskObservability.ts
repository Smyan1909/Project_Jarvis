// =============================================================================
// useTaskObservability Hook
// =============================================================================
// Hook for processing StreamEvents and updating task observability state.

import { useCallback, useRef } from 'react';
import {
  useTaskObservabilityContext,
  TaskInfo,
  AgentInfo,
  AgentType,
  OrchestratorStatus,
} from '../features/observability/TaskObservabilityContext';
import type { StreamEvent } from '../services/websocket';

// =============================================================================
// Helper Functions
// =============================================================================

function parseAgentType(type: string): AgentType {
  const validTypes: AgentType[] = ['general', 'research', 'coding', 'scheduling', 'productivity', 'messaging'];
  return validTypes.includes(type as AgentType) ? (type as AgentType) : 'general';
}

function parseOrchestratorStatus(status: string): OrchestratorStatus {
  const validStatuses: OrchestratorStatus[] = ['idle', 'planning', 'executing', 'monitoring', 'completed', 'failed'];
  return validStatuses.includes(status as OrchestratorStatus) ? (status as OrchestratorStatus) : 'idle';
}

// =============================================================================
// Hook
// =============================================================================

export function useTaskObservability() {
  const { state, dispatch, resetState, addActivity } = useTaskObservabilityContext();

  // Use ref to avoid stale closure issues with activeAgents in callbacks
  const activeAgentsRef = useRef(state.activeAgents);
  activeAgentsRef.current = state.activeAgents;

  /**
   * Process a StreamEvent and update observability state accordingly.
   */
  const processEvent = useCallback(
    (event: StreamEvent) => {
      // Type guard helper to safely access properties
      const getEventProp = <T>(key: string, defaultValue: T): T => {
        return (event as Record<string, unknown>)[key] as T ?? defaultValue;
      };

      switch (event.type) {
        // =====================================================================
        // Orchestrator Status Events
        // =====================================================================
        case 'orchestrator.status': {
          const eventData = event as { type: 'orchestrator.status'; status: string; message?: string };
          const status = parseOrchestratorStatus(eventData.status);
          dispatch({ type: 'SET_STATUS', status, message: eventData.message });
          addActivity('status', `Orchestrator: ${status}${eventData.message ? ` - ${eventData.message}` : ''}`);
          break;
        }

        // =====================================================================
        // Plan Events
        // =====================================================================
        case 'plan.created': {
          const eventData = event as { type: 'plan.created'; planId: string; taskCount: number; structure: string; tasks: any[] };
          const tasks: TaskInfo[] = (eventData.tasks || []).map((task: any) => ({
            id: task.id as string,
            description: task.description as string,
            agentType: parseAgentType(task.agentType),
            status: 'pending' as const,
            agentId: null,
            startedAt: null,
            completedAt: null,
            error: null,
          }));

          dispatch({
            type: 'SET_PLAN',
            plan: {
              id: eventData.planId,
              tasks,
              structure: (eventData.structure as 'dag' | 'sequential') || 'sequential',
            },
          });
          addActivity('plan_created', `Plan created with ${eventData.taskCount} tasks`);
          break;
        }

        case 'plan.modified': {
          const eventData = event as { type: 'plan.modified'; planId: string; modification: string; reason: string; affectedTaskIds: string[] };
          addActivity(
            'status',
            `Plan modified: ${eventData.modification} - ${eventData.reason}`,
            { affectedTaskIds: eventData.affectedTaskIds }
          );
          break;
        }

        // =====================================================================
        // Task Events
        // =====================================================================
        case 'task.started': {
          const eventData = event as { type: 'task.started'; taskId: string; description: string; agentType: string; agentId: string };
          dispatch({
            type: 'UPDATE_TASK',
            taskId: eventData.taskId,
            updates: {
              status: 'in_progress',
              agentId: eventData.agentId,
              startedAt: new Date(),
            },
          });
          addActivity('task_started', `Starting: ${eventData.description}`);
          break;
        }

        case 'task.progress': {
          const eventData = event as { type: 'task.progress'; taskId: string; agentId: string; progress: string };
          addActivity('status', `Progress: ${eventData.progress}`, { taskId: eventData.taskId });
          
          // Update agent's current action
          if (eventData.agentId) {
            dispatch({
              type: 'UPDATE_AGENT',
              agentId: eventData.agentId,
              updates: { currentAction: eventData.progress },
            });
          }
          break;
        }

        case 'task.completed': {
          const eventData = event as { type: 'task.completed'; taskId: string; success: boolean; result?: unknown; error?: string };
          dispatch({
            type: 'UPDATE_TASK',
            taskId: eventData.taskId,
            updates: {
              status: eventData.success ? 'completed' : 'failed',
              completedAt: new Date(),
              error: eventData.error || null,
            },
          });
          addActivity(
            'task_completed',
            eventData.success ? 'Task completed successfully' : `Task failed: ${eventData.error}`,
            { taskId: eventData.taskId }
          );
          break;
        }

        // =====================================================================
        // Agent Lifecycle Events
        // =====================================================================
        case 'agent.spawned': {
          const eventData = event as { type: 'agent.spawned'; agentId: string; taskId: string; agentType: string; taskDescription: string };
          const agent: AgentInfo = {
            id: eventData.agentId,
            type: parseAgentType(eventData.agentType),
            taskId: eventData.taskId,
            taskDescription: eventData.taskDescription,
            status: 'running',
            currentAction: null,
          };
          dispatch({ type: 'ADD_AGENT', agent });
          addActivity('agent_spawned', `Agent (${eventData.agentType}) started: ${eventData.taskDescription}`);
          break;
        }

        case 'agent.terminated': {
          const eventData = event as { type: 'agent.terminated'; agentId: string; taskId: string; reason: string; error?: string };
          dispatch({ type: 'REMOVE_AGENT', agentId: eventData.agentId });
          addActivity(
            'agent_terminated',
            `Agent terminated: ${eventData.reason}${eventData.error ? ` - ${eventData.error}` : ''}`
          );
          break;
        }

        case 'agent.reasoning': {
          const eventData = event as { type: 'agent.reasoning'; agentId: string; step: { id: string; type: string; content: string } };
          addActivity('reasoning', `[${eventData.step.type}] ${eventData.step.content}`);
          break;
        }

        case 'agent.intervention': {
          const eventData = event as { type: 'agent.intervention'; agentId: string; taskId: string; reason: string; action: string; guidance?: string };
          addActivity(
            'intervention',
            `Intervention: ${eventData.reason} - Action: ${eventData.action}`,
            { guidance: eventData.guidance }
          );
          break;
        }

        // =====================================================================
        // Tool Events
        // =====================================================================
        case 'agent.tool_call': {
          const eventData = event as { type: 'agent.tool_call'; toolId: string; toolName: string; input: unknown };
          dispatch({
            type: 'ADD_TOOL_CALL',
            toolCall: {
              id: eventData.toolId,
              name: eventData.toolName,
              input: eventData.input,
              startedAt: new Date(),
            },
          });
          addActivity('tool_call', `Using tool: ${eventData.toolName}`);

          // Update agent's current action
          const agentIdForToolCall = findAgentByToolCall(activeAgentsRef.current);
          if (agentIdForToolCall) {
            dispatch({
              type: 'UPDATE_AGENT',
              agentId: agentIdForToolCall,
              updates: { currentAction: `Using tool: ${eventData.toolName}` },
            });
          }
          break;
        }

        case 'agent.tool_result': {
          const eventData = event as { type: 'agent.tool_result'; toolId: string; output: unknown; success: boolean };
          dispatch({ type: 'REMOVE_TOOL_CALL', toolId: eventData.toolId });
          addActivity(
            'tool_result',
            `Tool completed: ${eventData.success ? 'success' : 'failed'}`
          );

          // Clear agent's current action
          const agentIdForToolResult = findAgentByToolCall(activeAgentsRef.current);
          if (agentIdForToolResult) {
            dispatch({
              type: 'UPDATE_AGENT',
              agentId: agentIdForToolResult,
              updates: { currentAction: null },
            });
          }
          break;
        }

        // =====================================================================
        // Token Streaming
        // =====================================================================
        case 'agent.token': {
          const eventData = event as { type: 'agent.token'; token: string };
          dispatch({ type: 'APPEND_TOKEN', token: eventData.token });
          // Don't add to activity log - too noisy
          break;
        }

        // =====================================================================
        // Error Events
        // =====================================================================
        case 'agent.error': {
          const eventData = event as { type: 'agent.error'; message: string; code?: string };
          addActivity('error', `Error: ${eventData.message}`, { code: eventData.code });
          break;
        }

        // =====================================================================
        // Completion Events
        // =====================================================================
        case 'agent.final': {
          dispatch({ type: 'CLEAR_STREAMING' });
          addActivity('status', 'Response completed');
          break;
        }

        case 'agent.status': {
          const eventData = event as { type: 'agent.status'; status: 'running' | 'completed' | 'failed' | 'cancelled' };
          if (eventData.status === 'completed' || eventData.status === 'failed') {
            const status = eventData.status === 'completed' ? 'completed' : 'failed';
            dispatch({ type: 'SET_STATUS', status });
          }
          break;
        }

        case 'orchestrator.complete': {
          dispatch({ type: 'SET_STATUS', status: 'completed' });
          addActivity('status', 'All tasks completed');
          break;
        }

        // =====================================================================
        // Monitoring Events
        // =====================================================================
        case 'monitoring.event_received': {
          const eventData = event as { type: 'monitoring.event_received'; eventId: string; triggerType: string; toolkit: string; title: string; summary: string };
          addActivity(
            'status',
            `[${eventData.toolkit}] ${eventData.title}: ${eventData.summary}`
          );
          break;
        }

        default:
          // Handle unknown event types gracefully
          console.log('[Observability] Unknown event type:', event.type);
      }
    },
    [dispatch, addActivity]
  );

  /**
   * Start tracking a new run.
   */
  const startRun = useCallback(
    (runId: string) => {
      resetState(runId);
      dispatch({ type: 'SET_STATUS', status: 'planning', message: 'Analyzing request...' });
      addActivity('status', 'Run started');
    },
    [resetState, dispatch, addActivity]
  );

  /**
   * Clear all tracking state.
   */
  const clearRun = useCallback(() => {
    resetState(null);
  }, [resetState]);

  return {
    // State
    currentRunId: state.currentRunId,
    status: state.status,
    statusMessage: state.statusMessage,
    plan: state.plan,
    activeAgents: state.activeAgents,
    pendingToolCalls: state.pendingToolCalls,
    activityLog: state.activityLog,
    streamingContent: state.streamingContent,

    // Actions
    processEvent,
    startRun,
    clearRun,
    resetState,
    addActivity,
  };
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Find the first running agent (simple heuristic for single-agent runs).
 * In multi-agent scenarios, tool calls should include agentId.
 */
function findAgentByToolCall(agents: Map<string, AgentInfo>): string | null {
  for (const [agentId, agent] of agents) {
    if (agent.status === 'running') {
      return agentId;
    }
  }
  return null;
}
