// =============================================================================
// Task Observability Context
// =============================================================================
// Global state for tracking orchestrator and sub-agent activity in real-time.

import React, { createContext, useContext, useReducer, useCallback, ReactNode } from 'react';

// =============================================================================
// Types
// =============================================================================

export type OrchestratorStatus = 'idle' | 'planning' | 'executing' | 'monitoring' | 'completed' | 'failed';
export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'failed';
export type AgentType = 'general' | 'research' | 'coding' | 'scheduling' | 'productivity' | 'messaging';

export interface TaskInfo {
  id: string;
  description: string;
  agentType: AgentType;
  status: TaskStatus;
  agentId: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  error: string | null;
}

export interface AgentInfo {
  id: string;
  type: AgentType;
  taskId: string;
  taskDescription: string;
  status: 'running' | 'completed' | 'failed';
  currentAction: string | null;
}

export interface ToolCallInfo {
  id: string;
  name: string;
  input: unknown;
  startedAt: Date;
}

export type ActivityLogEntryType =
  | 'status'
  | 'plan_created'
  | 'task_started'
  | 'task_completed'
  | 'agent_spawned'
  | 'agent_terminated'
  | 'tool_call'
  | 'tool_result'
  | 'reasoning'
  | 'intervention'
  | 'error'
  | 'token';

export interface ActivityLogEntry {
  id: string;
  timestamp: Date;
  type: ActivityLogEntryType;
  message: string;
  details?: unknown;
}

export interface PlanInfo {
  id: string;
  tasks: TaskInfo[];
  structure: 'dag' | 'sequential';
}

export interface TaskObservabilityState {
  currentRunId: string | null;
  status: OrchestratorStatus;
  statusMessage: string | null;
  plan: PlanInfo | null;
  activeAgents: Map<string, AgentInfo>;
  pendingToolCalls: Map<string, ToolCallInfo>;
  activityLog: ActivityLogEntry[];
  streamingContent: string;
}

// =============================================================================
// Actions
// =============================================================================

type TaskObservabilityAction =
  | { type: 'RESET'; runId: string | null }
  | { type: 'SET_STATUS'; status: OrchestratorStatus; message?: string }
  | { type: 'SET_PLAN'; plan: PlanInfo }
  | { type: 'UPDATE_TASK'; taskId: string; updates: Partial<TaskInfo> }
  | { type: 'ADD_AGENT'; agent: AgentInfo }
  | { type: 'UPDATE_AGENT'; agentId: string; updates: Partial<AgentInfo> }
  | { type: 'REMOVE_AGENT'; agentId: string }
  | { type: 'ADD_TOOL_CALL'; toolCall: ToolCallInfo }
  | { type: 'REMOVE_TOOL_CALL'; toolId: string }
  | { type: 'ADD_ACTIVITY'; entry: Omit<ActivityLogEntry, 'id' | 'timestamp'> }
  | { type: 'APPEND_TOKEN'; token: string }
  | { type: 'CLEAR_STREAMING' };

// =============================================================================
// Reducer
// =============================================================================

const MAX_ACTIVITY_LOG_ENTRIES = 100;

function taskObservabilityReducer(
  state: TaskObservabilityState,
  action: TaskObservabilityAction
): TaskObservabilityState {
  switch (action.type) {
    case 'RESET':
      return {
        ...initialState,
        currentRunId: action.runId,
      };

    case 'SET_STATUS':
      return {
        ...state,
        status: action.status,
        statusMessage: action.message ?? null,
      };

    case 'SET_PLAN':
      return {
        ...state,
        plan: action.plan,
      };

    case 'UPDATE_TASK': {
      if (!state.plan) return state;
      const tasks = state.plan.tasks.map((task) =>
        task.id === action.taskId ? { ...task, ...action.updates } : task
      );
      return {
        ...state,
        plan: { ...state.plan, tasks },
      };
    }

    case 'ADD_AGENT': {
      const newAgents = new Map(state.activeAgents);
      newAgents.set(action.agent.id, action.agent);
      return {
        ...state,
        activeAgents: newAgents,
      };
    }

    case 'UPDATE_AGENT': {
      const agent = state.activeAgents.get(action.agentId);
      if (!agent) return state;
      const newAgents = new Map(state.activeAgents);
      newAgents.set(action.agentId, { ...agent, ...action.updates });
      return {
        ...state,
        activeAgents: newAgents,
      };
    }

    case 'REMOVE_AGENT': {
      const newAgents = new Map(state.activeAgents);
      newAgents.delete(action.agentId);
      return {
        ...state,
        activeAgents: newAgents,
      };
    }

    case 'ADD_TOOL_CALL': {
      const newToolCalls = new Map(state.pendingToolCalls);
      newToolCalls.set(action.toolCall.id, action.toolCall);
      return {
        ...state,
        pendingToolCalls: newToolCalls,
      };
    }

    case 'REMOVE_TOOL_CALL': {
      const newToolCalls = new Map(state.pendingToolCalls);
      newToolCalls.delete(action.toolId);
      return {
        ...state,
        pendingToolCalls: newToolCalls,
      };
    }

    case 'ADD_ACTIVITY': {
      const newEntry: ActivityLogEntry = {
        id: `activity-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        timestamp: new Date(),
        ...action.entry,
      };
      const newLog = [newEntry, ...state.activityLog].slice(0, MAX_ACTIVITY_LOG_ENTRIES);
      return {
        ...state,
        activityLog: newLog,
      };
    }

    case 'APPEND_TOKEN':
      return {
        ...state,
        streamingContent: state.streamingContent + action.token,
      };

    case 'CLEAR_STREAMING':
      return {
        ...state,
        streamingContent: '',
      };

    default:
      return state;
  }
}

// =============================================================================
// Initial State
// =============================================================================

const initialState: TaskObservabilityState = {
  currentRunId: null,
  status: 'idle',
  statusMessage: null,
  plan: null,
  activeAgents: new Map(),
  pendingToolCalls: new Map(),
  activityLog: [],
  streamingContent: '',
};

// =============================================================================
// Context
// =============================================================================

interface TaskObservabilityContextValue {
  state: TaskObservabilityState;
  dispatch: React.Dispatch<TaskObservabilityAction>;
  resetState: (runId?: string | null) => void;
  addActivity: (type: ActivityLogEntryType, message: string, details?: unknown) => void;
}

const TaskObservabilityContext = createContext<TaskObservabilityContextValue | undefined>(undefined);

// =============================================================================
// Provider
// =============================================================================

export function TaskObservabilityProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(taskObservabilityReducer, initialState);

  const resetState = useCallback((runId: string | null = null) => {
    dispatch({ type: 'RESET', runId });
  }, []);

  const addActivity = useCallback(
    (type: ActivityLogEntryType, message: string, details?: unknown) => {
      dispatch({ type: 'ADD_ACTIVITY', entry: { type, message, details } });
    },
    []
  );

  return (
    <TaskObservabilityContext.Provider value={{ state, dispatch, resetState, addActivity }}>
      {children}
    </TaskObservabilityContext.Provider>
  );
}

// =============================================================================
// Hook
// =============================================================================

export function useTaskObservabilityContext(): TaskObservabilityContextValue {
  const context = useContext(TaskObservabilityContext);
  if (!context) {
    throw new Error('useTaskObservabilityContext must be used within a TaskObservabilityProvider');
  }
  return context;
}
