// =============================================================================
// Orchestrator State Repository
// =============================================================================
// Postgres adapter for persisting orchestrator state, task plans, and sub-agents.
// Uses interfaces to allow for dependency injection and testing.

import { v4 as uuidv4 } from 'uuid';
import type {
  TaskPlan,
  TaskNode,
  SubAgentState,
  OrchestratorState,
  TaskPlanStatus,
  TaskNodeStatus,
  SubAgentStatus,
  OrchestratorStatus,
  AgentType,
  ReasoningStep,
  Artifact,
  LLMMessage,
  ToolCall,
} from '@project-jarvis/shared-types';

// =============================================================================
// Database Row Types (matching Postgres schema)
// =============================================================================

interface TaskPlanRow {
  id: string;
  run_id: string;
  status: TaskPlanStatus;
  created_at: Date;
  updated_at: Date;
}

interface TaskNodeRow {
  id: string;
  plan_id: string;
  description: string;
  agent_type: AgentType;
  status: TaskNodeStatus;
  dependencies: string[];
  assigned_agent_id: string | null;
  result: unknown | null;
  retry_count: number;
  created_at: Date;
  completed_at: Date | null;
}

interface SubAgentRow {
  id: string;
  run_id: string;
  task_node_id: string;
  agent_type: AgentType;
  status: SubAgentStatus;
  task_description: string;
  upstream_context: string | null;
  additional_tools: string[];
  messages: LLMMessage[];
  tool_calls: ToolCall[];
  reasoning_steps: ReasoningStep[];
  artifacts: Artifact[];
  pending_guidance: string | null;
  total_tokens: number;
  total_cost: number;
  started_at: Date;
  completed_at: Date | null;
}

interface OrchestratorStateRow {
  id: string;
  run_id: string;
  user_id: string;
  status: OrchestratorStatus;
  plan_id: string | null;
  active_agent_ids: string[];
  loop_counters: Record<string, number>;
  total_interventions: number;
  total_tokens: number;
  total_cost: number;
  started_at: Date;
  completed_at: Date | null;
  updated_at: Date;
}

// =============================================================================
// Database Client Interface
// =============================================================================
// Abstract interface for database operations. Implementations can use
// pg, postgres.js, Drizzle, Prisma, or any other Postgres client.

export interface DatabaseClient {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  queryOne<T>(sql: string, params?: unknown[]): Promise<T | null>;
  execute(sql: string, params?: unknown[]): Promise<void>;
}

// =============================================================================
// Repository Interface
// =============================================================================

export interface IOrchestratorStateRepository {
  // Task Plans
  createPlan(runId: string): Promise<TaskPlan>;
  getPlan(planId: string): Promise<TaskPlan | null>;
  getPlanByRunId(runId: string): Promise<TaskPlan | null>;
  updatePlanStatus(planId: string, status: TaskPlanStatus): Promise<void>;

  // Task Nodes
  createTaskNode(planId: string, node: Omit<TaskNode, 'id' | 'createdAt' | 'completedAt' | 'retryCount' | 'assignedAgentId' | 'result' | 'status'> & { id?: string }): Promise<TaskNode>;
  createTaskNodes(planId: string, nodes: Array<Omit<TaskNode, 'id' | 'createdAt' | 'completedAt' | 'retryCount' | 'assignedAgentId' | 'result' | 'status'> & { id?: string }>): Promise<TaskNode[]>;
  getTaskNode(nodeId: string): Promise<TaskNode | null>;
  getTaskNodesByPlan(planId: string): Promise<TaskNode[]>;
  updateTaskNodeStatus(nodeId: string, status: TaskNodeStatus): Promise<void>;
  updateTaskNodeResult(nodeId: string, result: unknown): Promise<void>;
  assignAgentToNode(nodeId: string, agentId: string): Promise<void>;
  incrementRetryCount(nodeId: string): Promise<number>;

  // Sub-Agents
  createSubAgent(state: Omit<SubAgentState, 'id' | 'startedAt' | 'completedAt' | 'totalTokens' | 'totalCost' | 'messages' | 'toolCalls' | 'reasoningSteps' | 'artifacts'>): Promise<SubAgentState>;
  getSubAgent(agentId: string): Promise<SubAgentState | null>;
  getSubAgentsByRun(runId: string): Promise<SubAgentState[]>;
  getActiveSubAgents(runId: string): Promise<SubAgentState[]>;
  updateSubAgentStatus(agentId: string, status: SubAgentStatus): Promise<void>;
  appendMessage(agentId: string, message: LLMMessage): Promise<void>;
  appendToolCall(agentId: string, toolCall: ToolCall): Promise<void>;
  appendReasoningStep(agentId: string, step: ReasoningStep): Promise<void>;
  appendArtifact(agentId: string, artifact: Artifact): Promise<void>;
  setGuidance(agentId: string, guidance: string): Promise<void>;
  clearGuidance(agentId: string): Promise<void>;
  updateSubAgentMetrics(agentId: string, tokens: number, cost: number): Promise<void>;

  // Orchestrator State
  createOrchestratorState(runId: string, userId: string): Promise<OrchestratorState>;
  getOrchestratorState(runId: string): Promise<OrchestratorState | null>;
  updateOrchestratorStatus(runId: string, status: OrchestratorStatus): Promise<void>;
  updateOrchestratorPlan(runId: string, planId: string): Promise<void>;
  addActiveAgent(runId: string, agentId: string): Promise<void>;
  removeActiveAgent(runId: string, agentId: string): Promise<void>;
  incrementLoopCounter(runId: string, taskNodeId: string): Promise<number>;
  incrementInterventions(runId: string): Promise<number>;
  updateOrchestratorMetrics(runId: string, tokens: number, cost: number): Promise<void>;
}

// =============================================================================
// In-Memory Implementation (for testing and MVP)
// =============================================================================

export class InMemoryOrchestratorStateRepository implements IOrchestratorStateRepository {
  private plans: Map<string, TaskPlan> = new Map();
  private plansByRun: Map<string, string> = new Map();
  private nodes: Map<string, TaskNode> = new Map();
  private nodesByPlan: Map<string, string[]> = new Map();
  private subAgents: Map<string, SubAgentState> = new Map();
  private subAgentsByRun: Map<string, string[]> = new Map();
  private orchestratorStates: Map<string, OrchestratorState> = new Map();

  // Task Plans
  async createPlan(runId: string): Promise<TaskPlan> {
    const plan: TaskPlan = {
      id: uuidv4(),
      runId,
      nodes: [],
      status: 'planning',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.plans.set(plan.id, plan);
    this.plansByRun.set(runId, plan.id);
    this.nodesByPlan.set(plan.id, []);
    return plan;
  }

  async getPlan(planId: string): Promise<TaskPlan | null> {
    const plan = this.plans.get(planId);
    if (!plan) return null;
    
    // Hydrate nodes
    const nodeIds = this.nodesByPlan.get(planId) || [];
    const nodes = nodeIds.map(id => this.nodes.get(id)).filter(Boolean) as TaskNode[];
    return { ...plan, nodes };
  }

  async getPlanByRunId(runId: string): Promise<TaskPlan | null> {
    const planId = this.plansByRun.get(runId);
    if (!planId) return null;
    return this.getPlan(planId);
  }

  async updatePlanStatus(planId: string, status: TaskPlanStatus): Promise<void> {
    const plan = this.plans.get(planId);
    if (plan) {
      plan.status = status;
      plan.updatedAt = new Date();
    }
  }

  // Task Nodes
  async createTaskNode(
    planId: string,
    node: Omit<TaskNode, 'id' | 'createdAt' | 'completedAt' | 'retryCount' | 'assignedAgentId' | 'result' | 'status'> & { id?: string }
  ): Promise<TaskNode> {
    const taskNode: TaskNode = {
      ...node,
      id: node.id || uuidv4(),  // Use provided ID or generate new one
      status: 'pending',
      assignedAgentId: null,
      result: null,
      retryCount: 0,
      createdAt: new Date(),
      completedAt: null,
    };
    this.nodes.set(taskNode.id, taskNode);
    
    const planNodes = this.nodesByPlan.get(planId) || [];
    planNodes.push(taskNode.id);
    this.nodesByPlan.set(planId, planNodes);
    
    return taskNode;
  }

  async createTaskNodes(
    planId: string,
    nodes: Array<Omit<TaskNode, 'id' | 'createdAt' | 'completedAt' | 'retryCount' | 'assignedAgentId' | 'result' | 'status'> & { id?: string }>
  ): Promise<TaskNode[]> {
    const results: TaskNode[] = [];
    for (const node of nodes) {
      const created = await this.createTaskNode(planId, node);
      results.push(created);
    }
    return results;
  }

  async getTaskNode(nodeId: string): Promise<TaskNode | null> {
    return this.nodes.get(nodeId) || null;
  }

  async getTaskNodesByPlan(planId: string): Promise<TaskNode[]> {
    const nodeIds = this.nodesByPlan.get(planId) || [];
    return nodeIds.map(id => this.nodes.get(id)).filter(Boolean) as TaskNode[];
  }

  async updateTaskNodeStatus(nodeId: string, status: TaskNodeStatus): Promise<void> {
    const node = this.nodes.get(nodeId);
    if (node) {
      node.status = status;
      if (status === 'completed' || status === 'failed' || status === 'cancelled') {
        node.completedAt = new Date();
      }
    }
  }

  async updateTaskNodeResult(nodeId: string, result: unknown): Promise<void> {
    const node = this.nodes.get(nodeId);
    if (node) {
      node.result = result;
    }
  }

  async assignAgentToNode(nodeId: string, agentId: string): Promise<void> {
    const node = this.nodes.get(nodeId);
    if (node) {
      node.assignedAgentId = agentId;
    }
  }

  async incrementRetryCount(nodeId: string): Promise<number> {
    const node = this.nodes.get(nodeId);
    if (node) {
      node.retryCount++;
      return node.retryCount;
    }
    return 0;
  }

  // Sub-Agents
  async createSubAgent(
    state: Omit<SubAgentState, 'id' | 'startedAt' | 'completedAt' | 'totalTokens' | 'totalCost' | 'messages' | 'toolCalls' | 'reasoningSteps' | 'artifacts'>
  ): Promise<SubAgentState> {
    const subAgent: SubAgentState = {
      ...state,
      id: uuidv4(),
      messages: [],
      toolCalls: [],
      reasoningSteps: [],
      artifacts: [],
      totalTokens: 0,
      totalCost: 0,
      startedAt: new Date(),
      completedAt: null,
    };
    this.subAgents.set(subAgent.id, subAgent);
    
    const runAgents = this.subAgentsByRun.get(state.runId) || [];
    runAgents.push(subAgent.id);
    this.subAgentsByRun.set(state.runId, runAgents);
    
    return subAgent;
  }

  async getSubAgent(agentId: string): Promise<SubAgentState | null> {
    return this.subAgents.get(agentId) || null;
  }

  async getSubAgentsByRun(runId: string): Promise<SubAgentState[]> {
    const agentIds = this.subAgentsByRun.get(runId) || [];
    return agentIds.map(id => this.subAgents.get(id)).filter(Boolean) as SubAgentState[];
  }

  async getActiveSubAgents(runId: string): Promise<SubAgentState[]> {
    const agents = await this.getSubAgentsByRun(runId);
    return agents.filter(a => a.status === 'running' || a.status === 'initializing');
  }

  async updateSubAgentStatus(agentId: string, status: SubAgentStatus): Promise<void> {
    const agent = this.subAgents.get(agentId);
    if (agent) {
      agent.status = status;
      if (status === 'completed' || status === 'failed' || status === 'cancelled') {
        agent.completedAt = new Date();
      }
    }
  }

  async appendMessage(agentId: string, message: LLMMessage): Promise<void> {
    const agent = this.subAgents.get(agentId);
    if (agent) {
      agent.messages.push(message);
    }
  }

  async appendToolCall(agentId: string, toolCall: ToolCall): Promise<void> {
    const agent = this.subAgents.get(agentId);
    if (agent) {
      agent.toolCalls.push(toolCall);
    }
  }

  async appendReasoningStep(agentId: string, step: ReasoningStep): Promise<void> {
    const agent = this.subAgents.get(agentId);
    if (agent) {
      agent.reasoningSteps.push(step);
    }
  }

  async appendArtifact(agentId: string, artifact: Artifact): Promise<void> {
    const agent = this.subAgents.get(agentId);
    if (agent) {
      agent.artifacts.push(artifact);
    }
  }

  async setGuidance(agentId: string, guidance: string): Promise<void> {
    const agent = this.subAgents.get(agentId);
    if (agent) {
      // Store guidance in upstreamContext or create a new field
      // For now, prepend to upstreamContext
      agent.upstreamContext = guidance + (agent.upstreamContext ? '\n\n' + agent.upstreamContext : '');
    }
  }

  async clearGuidance(agentId: string): Promise<void> {
    // Guidance is consumed when read, so nothing to do here for in-memory
  }

  async updateSubAgentMetrics(agentId: string, tokens: number, cost: number): Promise<void> {
    const agent = this.subAgents.get(agentId);
    if (agent) {
      agent.totalTokens += tokens;
      agent.totalCost += cost;
    }
  }

  // Orchestrator State
  async createOrchestratorState(runId: string, userId: string): Promise<OrchestratorState> {
    const state: OrchestratorState = {
      id: uuidv4(),
      runId,
      userId,
      status: 'idle',
      plan: null,
      activeAgentIds: [],
      loopCounters: {},
      totalInterventions: 0,
      totalTokens: 0,
      totalCost: 0,
      startedAt: new Date(),
      completedAt: null,
    };
    this.orchestratorStates.set(runId, state);
    return state;
  }

  async getOrchestratorState(runId: string): Promise<OrchestratorState | null> {
    const state = this.orchestratorStates.get(runId);
    if (!state) return null;
    
    // Hydrate plan if exists
    if (state.plan) {
      const plan = await this.getPlan(state.plan.id);
      return { ...state, plan };
    }
    return state;
  }

  async updateOrchestratorStatus(runId: string, status: OrchestratorStatus): Promise<void> {
    const state = this.orchestratorStates.get(runId);
    if (state) {
      state.status = status;
      if (status === 'completed' || status === 'failed') {
        state.completedAt = new Date();
      }
    }
  }

  async updateOrchestratorPlan(runId: string, planId: string): Promise<void> {
    const state = this.orchestratorStates.get(runId);
    if (state) {
      const plan = await this.getPlan(planId);
      state.plan = plan;
    }
  }

  async addActiveAgent(runId: string, agentId: string): Promise<void> {
    const state = this.orchestratorStates.get(runId);
    if (state && !state.activeAgentIds.includes(agentId)) {
      state.activeAgentIds.push(agentId);
    }
  }

  async removeActiveAgent(runId: string, agentId: string): Promise<void> {
    const state = this.orchestratorStates.get(runId);
    if (state) {
      state.activeAgentIds = state.activeAgentIds.filter(id => id !== agentId);
    }
  }

  async incrementLoopCounter(runId: string, taskNodeId: string): Promise<number> {
    const state = this.orchestratorStates.get(runId);
    if (state) {
      state.loopCounters[taskNodeId] = (state.loopCounters[taskNodeId] || 0) + 1;
      return state.loopCounters[taskNodeId];
    }
    return 0;
  }

  async incrementInterventions(runId: string): Promise<number> {
    const state = this.orchestratorStates.get(runId);
    if (state) {
      state.totalInterventions++;
      return state.totalInterventions;
    }
    return 0;
  }

  async updateOrchestratorMetrics(runId: string, tokens: number, cost: number): Promise<void> {
    const state = this.orchestratorStates.get(runId);
    if (state) {
      state.totalTokens += tokens;
      state.totalCost += cost;
    }
  }

  // Utility: Clear all data (for testing)
  clear(): void {
    this.plans.clear();
    this.plansByRun.clear();
    this.nodes.clear();
    this.nodesByPlan.clear();
    this.subAgents.clear();
    this.subAgentsByRun.clear();
    this.orchestratorStates.clear();
  }
}
