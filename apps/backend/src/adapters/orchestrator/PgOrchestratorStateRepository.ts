// =============================================================================
// PostgreSQL Orchestrator State Repository
// =============================================================================
// Drizzle ORM implementation for persisting orchestrator state, task plans,
// task nodes, and sub-agents to PostgreSQL.

import { eq, and, sql, inArray } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../../infrastructure/db/client.js';
import {
  taskPlans,
  taskNodes,
  subAgents,
  orchestratorStates,
} from '../../infrastructure/db/schema.js';
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
import type { IOrchestratorStateRepository } from './OrchestratorStateRepository.js';

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Convert database row to TaskNode domain object
 */
function rowToTaskNode(row: typeof taskNodes.$inferSelect): TaskNode {
  return {
    id: row.id,
    description: row.description,
    agentType: row.agentType as AgentType,
    status: row.status as TaskNodeStatus,
    dependencies: (row.dependencies as string[]) || [],
    assignedAgentId: row.assignedAgentId,
    result: row.result,
    retryCount: row.retryCount,
    createdAt: row.createdAt,
    completedAt: row.completedAt,
  };
}

/**
 * Convert database row to SubAgentState domain object
 */
function rowToSubAgentState(row: typeof subAgents.$inferSelect): SubAgentState {
  return {
    id: row.id,
    runId: row.runId,
    taskNodeId: row.taskNodeId,
    agentType: row.agentType as AgentType,
    status: row.status as SubAgentStatus,
    taskDescription: row.taskDescription,
    upstreamContext: row.upstreamContext,
    additionalTools: (row.additionalTools as string[]) || [],
    messages: (row.messages as LLMMessage[]) || [],
    toolCalls: (row.toolCalls as ToolCall[]) || [],
    reasoningSteps: (row.reasoningSteps as ReasoningStep[]) || [],
    artifacts: (row.artifacts as Artifact[]) || [],
    totalTokens: row.totalTokens,
    totalCost: row.totalCost,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
  };
}

// =============================================================================
// PostgreSQL Implementation
// =============================================================================

export class PgOrchestratorStateRepository implements IOrchestratorStateRepository {
  // ===========================================================================
  // Task Plans
  // ===========================================================================

  async createPlan(runId: string): Promise<TaskPlan> {
    const result = await db
      .insert(taskPlans)
      .values({ runId })
      .returning();

    const row = result[0];
    return {
      id: row.id,
      runId: row.runId,
      nodes: [],
      status: row.status as TaskPlanStatus,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async getPlan(planId: string): Promise<TaskPlan | null> {
    const planRows = await db
      .select()
      .from(taskPlans)
      .where(eq(taskPlans.id, planId))
      .limit(1);

    if (planRows.length === 0) return null;

    const row = planRows[0];
    const nodes = await this.getTaskNodesByPlan(planId);

    return {
      id: row.id,
      runId: row.runId,
      nodes,
      status: row.status as TaskPlanStatus,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async getPlanByRunId(runId: string): Promise<TaskPlan | null> {
    const planRows = await db
      .select()
      .from(taskPlans)
      .where(eq(taskPlans.runId, runId))
      .limit(1);

    if (planRows.length === 0) return null;

    return this.getPlan(planRows[0].id);
  }

  async updatePlanStatus(planId: string, status: TaskPlanStatus): Promise<void> {
    await db
      .update(taskPlans)
      .set({ status, updatedAt: new Date() })
      .where(eq(taskPlans.id, planId));
  }

  // ===========================================================================
  // Task Nodes
  // ===========================================================================

  async createTaskNode(
    planId: string,
    node: Omit<TaskNode, 'id' | 'createdAt' | 'completedAt' | 'retryCount' | 'assignedAgentId' | 'result' | 'status'>
  ): Promise<TaskNode> {
    // Format dependencies as PostgreSQL UUID array literal
    const deps = node.dependencies || [];
    const depsArrayLiteral = deps.length > 0 ? `{${deps.join(',')}}` : '{}';
    
    // Use raw SQL with proper UUID[] array syntax
    const result = await db.execute(sql`
      INSERT INTO task_nodes (plan_id, description, agent_type, dependencies, status)
      VALUES (${planId}, ${node.description}, ${node.agentType}, ${depsArrayLiteral}::uuid[], 'pending')
      RETURNING *
    `);

    const rows = result as unknown as Array<Record<string, unknown>>;
    const row = rows[0];
    return {
      id: row.id as string,
      description: row.description as string,
      agentType: row.agent_type as AgentType,
      status: row.status as TaskNodeStatus,
      dependencies: (row.dependencies as string[]) || [],
      assignedAgentId: row.assigned_agent_id as string | null,
      result: row.result,
      retryCount: row.retry_count as number,
      createdAt: new Date(row.created_at as string),
      completedAt: row.completed_at ? new Date(row.completed_at as string) : null,
    };
  }

  async createTaskNodes(
    planId: string,
    nodes: Array<Omit<TaskNode, 'id' | 'createdAt' | 'completedAt' | 'retryCount' | 'assignedAgentId' | 'result' | 'status'>>
  ): Promise<TaskNode[]> {
    if (nodes.length === 0) return [];

    // Insert nodes one at a time with proper UUID[] array handling for dependencies
    const results: TaskNode[] = [];
    for (const node of nodes) {
      // Format dependencies as PostgreSQL UUID array literal
      const deps = node.dependencies || [];
      const depsArrayLiteral = deps.length > 0 ? `{${deps.join(',')}}` : '{}';
      
      const result = await db.execute(sql`
        INSERT INTO task_nodes (plan_id, description, agent_type, dependencies, status)
        VALUES (${planId}, ${node.description}, ${node.agentType}, ${depsArrayLiteral}::uuid[], 'pending')
        RETURNING *
      `);
      const rows = result as unknown as Array<Record<string, unknown>>;
      const row = rows[0];
      results.push({
        id: row.id as string,
        description: row.description as string,
        agentType: row.agent_type as AgentType,
        status: row.status as TaskNodeStatus,
        dependencies: (row.dependencies as string[]) || [],
        assignedAgentId: row.assigned_agent_id as string | null,
        result: row.result,
        retryCount: row.retry_count as number,
        createdAt: new Date(row.created_at as string),
        completedAt: row.completed_at ? new Date(row.completed_at as string) : null,
      });
    }

    return results;
  }

  async getTaskNode(nodeId: string): Promise<TaskNode | null> {
    const rows = await db
      .select()
      .from(taskNodes)
      .where(eq(taskNodes.id, nodeId))
      .limit(1);

    if (rows.length === 0) return null;
    return rowToTaskNode(rows[0]);
  }

  async getTaskNodesByPlan(planId: string): Promise<TaskNode[]> {
    const rows = await db
      .select()
      .from(taskNodes)
      .where(eq(taskNodes.planId, planId));

    return rows.map(rowToTaskNode);
  }

  async updateTaskNodeStatus(nodeId: string, status: TaskNodeStatus): Promise<void> {
    const updates: Partial<typeof taskNodes.$inferInsert> = { status };
    
    if (status === 'completed' || status === 'failed' || status === 'cancelled') {
      updates.completedAt = new Date();
    }

    await db
      .update(taskNodes)
      .set(updates)
      .where(eq(taskNodes.id, nodeId));
  }

  async updateTaskNodeResult(nodeId: string, result: unknown): Promise<void> {
    await db
      .update(taskNodes)
      .set({ result })
      .where(eq(taskNodes.id, nodeId));
  }

  async assignAgentToNode(nodeId: string, agentId: string): Promise<void> {
    await db
      .update(taskNodes)
      .set({ assignedAgentId: agentId })
      .where(eq(taskNodes.id, nodeId));
  }

  async incrementRetryCount(nodeId: string): Promise<number> {
    const result = await db
      .update(taskNodes)
      .set({ retryCount: sql`${taskNodes.retryCount} + 1` })
      .where(eq(taskNodes.id, nodeId))
      .returning({ retryCount: taskNodes.retryCount });

    return result[0]?.retryCount ?? 0;
  }

  // ===========================================================================
  // Sub-Agents
  // ===========================================================================

  async createSubAgent(
    state: Omit<SubAgentState, 'id' | 'startedAt' | 'completedAt' | 'totalTokens' | 'totalCost' | 'messages' | 'toolCalls' | 'reasoningSteps' | 'artifacts'>
  ): Promise<SubAgentState> {
    // Format additionalTools as PostgreSQL TEXT[] array literal
    const tools = state.additionalTools || [];
    const toolsArrayLiteral = tools.length > 0 ? `{${tools.join(',')}}` : '{}';

    const result = await db.execute(sql`
      INSERT INTO sub_agents (run_id, task_node_id, agent_type, status, task_description, upstream_context, additional_tools)
      VALUES (${state.runId}, ${state.taskNodeId}, ${state.agentType}, ${state.status}, ${state.taskDescription}, ${state.upstreamContext}, ${toolsArrayLiteral}::text[])
      RETURNING *
    `);

    const rows = result as unknown as Array<Record<string, unknown>>;
    const row = rows[0];
    return {
      id: row.id as string,
      runId: row.run_id as string,
      taskNodeId: row.task_node_id as string,
      agentType: row.agent_type as AgentType,
      status: row.status as SubAgentStatus,
      taskDescription: row.task_description as string,
      upstreamContext: row.upstream_context as string | null,
      additionalTools: (row.additional_tools as string[]) || [],
      messages: (row.messages as LLMMessage[]) || [],
      toolCalls: (row.tool_calls as ToolCall[]) || [],
      reasoningSteps: (row.reasoning_steps as ReasoningStep[]) || [],
      artifacts: (row.artifacts as Artifact[]) || [],
      totalTokens: Number(row.total_tokens) || 0,
      totalCost: Number(row.total_cost) || 0,
      startedAt: new Date(row.started_at as string),
      completedAt: row.completed_at ? new Date(row.completed_at as string) : null,
    };
  }

  async getSubAgent(agentId: string): Promise<SubAgentState | null> {
    const rows = await db
      .select()
      .from(subAgents)
      .where(eq(subAgents.id, agentId))
      .limit(1);

    if (rows.length === 0) return null;
    return rowToSubAgentState(rows[0]);
  }

  async getSubAgentsByRun(runId: string): Promise<SubAgentState[]> {
    const rows = await db
      .select()
      .from(subAgents)
      .where(eq(subAgents.runId, runId));

    return rows.map(rowToSubAgentState);
  }

  async getActiveSubAgents(runId: string): Promise<SubAgentState[]> {
    const rows = await db
      .select()
      .from(subAgents)
      .where(
        and(
          eq(subAgents.runId, runId),
          inArray(subAgents.status, ['running', 'initializing'])
        )
      );

    return rows.map(rowToSubAgentState);
  }

  async updateSubAgentStatus(agentId: string, status: SubAgentStatus): Promise<void> {
    const updates: Partial<typeof subAgents.$inferInsert> = { status };
    
    if (status === 'completed' || status === 'failed' || status === 'cancelled') {
      updates.completedAt = new Date();
    }

    await db
      .update(subAgents)
      .set(updates)
      .where(eq(subAgents.id, agentId));
  }

  async appendMessage(agentId: string, message: LLMMessage): Promise<void> {
    // Use raw SQL to ensure proper JSONB concatenation
    await db.execute(sql`
      UPDATE sub_agents
      SET messages = messages::jsonb || ${JSON.stringify([message])}::jsonb
      WHERE id = ${agentId}
    `);
  }

  async appendToolCall(agentId: string, toolCall: ToolCall): Promise<void> {
    // Use raw SQL to ensure proper JSONB concatenation
    await db.execute(sql`
      UPDATE sub_agents
      SET tool_calls = tool_calls::jsonb || ${JSON.stringify([toolCall])}::jsonb
      WHERE id = ${agentId}
    `);
  }

  async appendReasoningStep(agentId: string, step: ReasoningStep): Promise<void> {
    // Use raw SQL to ensure proper JSONB concatenation
    await db.execute(sql`
      UPDATE sub_agents
      SET reasoning_steps = reasoning_steps::jsonb || ${JSON.stringify([step])}::jsonb
      WHERE id = ${agentId}
    `);
  }

  async appendArtifact(agentId: string, artifact: Artifact): Promise<void> {
    // Use raw SQL to ensure proper JSONB concatenation
    await db.execute(sql`
      UPDATE sub_agents
      SET artifacts = artifacts::jsonb || ${JSON.stringify([artifact])}::jsonb
      WHERE id = ${agentId}
    `);
  }

  async setGuidance(agentId: string, guidance: string): Promise<void> {
    await db
      .update(subAgents)
      .set({ pendingGuidance: guidance })
      .where(eq(subAgents.id, agentId));
  }

  async clearGuidance(agentId: string): Promise<void> {
    await db
      .update(subAgents)
      .set({ pendingGuidance: null })
      .where(eq(subAgents.id, agentId));
  }

  async updateSubAgentMetrics(agentId: string, tokens: number, cost: number): Promise<void> {
    await db
      .update(subAgents)
      .set({
        totalTokens: sql`${subAgents.totalTokens} + ${tokens}`,
        totalCost: sql`${subAgents.totalCost} + ${cost}`,
      })
      .where(eq(subAgents.id, agentId));
  }

  // ===========================================================================
  // Orchestrator State
  // ===========================================================================

  async createOrchestratorState(runId: string, userId: string): Promise<OrchestratorState> {
    const result = await db
      .insert(orchestratorStates)
      .values({ runId, userId })
      .returning();

    const row = result[0];
    return {
      id: row.id,
      runId: row.runId,
      userId: row.userId,
      status: row.status as OrchestratorStatus,
      plan: null,
      activeAgentIds: (row.activeAgentIds as string[]) || [],
      loopCounters: (row.loopCounters as Record<string, number>) || {},
      totalInterventions: row.totalInterventions,
      totalTokens: row.totalTokens,
      totalCost: row.totalCost,
      startedAt: row.startedAt,
      completedAt: row.completedAt,
    };
  }

  async getOrchestratorState(runId: string): Promise<OrchestratorState | null> {
    const rows = await db
      .select()
      .from(orchestratorStates)
      .where(eq(orchestratorStates.runId, runId))
      .limit(1);

    if (rows.length === 0) return null;

    const row = rows[0];
    
    // Hydrate plan if it exists
    let plan: TaskPlan | null = null;
    if (row.planId) {
      plan = await this.getPlan(row.planId);
    }

    return {
      id: row.id,
      runId: row.runId,
      userId: row.userId,
      status: row.status as OrchestratorStatus,
      plan,
      activeAgentIds: (row.activeAgentIds as string[]) || [],
      loopCounters: (row.loopCounters as Record<string, number>) || {},
      totalInterventions: row.totalInterventions,
      totalTokens: row.totalTokens,
      totalCost: row.totalCost,
      startedAt: row.startedAt,
      completedAt: row.completedAt,
    };
  }

  async updateOrchestratorStatus(runId: string, status: OrchestratorStatus): Promise<void> {
    const updates: Partial<typeof orchestratorStates.$inferInsert> = {
      status,
      updatedAt: new Date(),
    };
    
    if (status === 'completed' || status === 'failed') {
      updates.completedAt = new Date();
    }

    await db
      .update(orchestratorStates)
      .set(updates)
      .where(eq(orchestratorStates.runId, runId));
  }

  async updateOrchestratorPlan(runId: string, planId: string): Promise<void> {
    await db
      .update(orchestratorStates)
      .set({ planId, updatedAt: new Date() })
      .where(eq(orchestratorStates.runId, runId));
  }

  async addActiveAgent(runId: string, agentId: string): Promise<void> {
    // Use native PostgreSQL array concatenation for UUID[]
    await db.execute(sql`
      UPDATE orchestrator_states
      SET active_agent_ids = array_append(active_agent_ids, ${agentId}::uuid),
          updated_at = NOW()
      WHERE run_id = ${runId}
    `);
  }

  async removeActiveAgent(runId: string, agentId: string): Promise<void> {
    // Use native PostgreSQL array_remove for UUID[]
    await db.execute(sql`
      UPDATE orchestrator_states
      SET active_agent_ids = array_remove(active_agent_ids, ${agentId}::uuid),
          updated_at = NOW()
      WHERE run_id = ${runId}
    `);
  }

  async incrementLoopCounter(runId: string, taskNodeId: string): Promise<number> {
    // First, get current value
    const rows = await db
      .select({ loopCounters: orchestratorStates.loopCounters })
      .from(orchestratorStates)
      .where(eq(orchestratorStates.runId, runId))
      .limit(1);

    if (rows.length === 0) return 0;

    const counters = (rows[0].loopCounters as Record<string, number>) || {};
    const newCount = (counters[taskNodeId] || 0) + 1;
    counters[taskNodeId] = newCount;

    await db
      .update(orchestratorStates)
      .set({
        loopCounters: counters,
        updatedAt: new Date(),
      })
      .where(eq(orchestratorStates.runId, runId));

    return newCount;
  }

  async incrementInterventions(runId: string): Promise<number> {
    const result = await db
      .update(orchestratorStates)
      .set({
        totalInterventions: sql`${orchestratorStates.totalInterventions} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(orchestratorStates.runId, runId))
      .returning({ totalInterventions: orchestratorStates.totalInterventions });

    return result[0]?.totalInterventions ?? 0;
  }

  async updateOrchestratorMetrics(runId: string, tokens: number, cost: number): Promise<void> {
    await db
      .update(orchestratorStates)
      .set({
        totalTokens: sql`${orchestratorStates.totalTokens} + ${tokens}`,
        totalCost: sql`${orchestratorStates.totalCost} + ${cost}`,
        updatedAt: new Date(),
      })
      .where(eq(orchestratorStates.runId, runId));
  }
}
