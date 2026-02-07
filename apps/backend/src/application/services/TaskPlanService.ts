// =============================================================================
// Task Plan Service
// =============================================================================
// Manages the creation, validation, and execution of task plans (DAGs).
// Handles dependency resolution and determines which tasks are ready to run.

import { v4 as uuidv4 } from 'uuid';
import type {
  TaskPlan,
  TaskNode,
  TaskNodeStatus,
  AgentType,
  CreateTaskNodeInput,
} from '@project-jarvis/shared-types';
import type { IOrchestratorStateRepository } from '../../adapters/orchestrator/OrchestratorStateRepository.js';
import type { IOrchestratorCacheAdapter } from '../../adapters/orchestrator/OrchestratorCacheAdapter.js';

// =============================================================================
// Task Creation Input (from LLM tool call)
// =============================================================================

export interface TaskPlanInput {
  tasks: Array<{
    tempId: string;              // Temporary ID for referencing in dependencies
    description: string;         // What this task should accomplish
    agentType: AgentType;        // Which agent type to use
    dependencies: string[];      // Array of tempIds this task depends on
  }>;
  reasoning: string;             // LLM's reasoning for this plan structure
}

// =============================================================================
// Plan Validation Result
// =============================================================================

export interface PlanValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

// =============================================================================
// Ready Tasks Result
// =============================================================================

export interface ReadyTasksResult {
  readyTasks: TaskNode[];        // Tasks that can be started now
  waitingTasks: TaskNode[];      // Tasks waiting on dependencies
  completedTasks: TaskNode[];    // Already completed tasks
  failedTasks: TaskNode[];       // Failed tasks
}

// =============================================================================
// Task Plan Service
// =============================================================================

export class TaskPlanService {
  constructor(
    private repository: IOrchestratorStateRepository,
    private cache: IOrchestratorCacheAdapter
  ) {}

  // ===========================================================================
  // Plan Creation
  // ===========================================================================

  /**
   * Create a new task plan from the LLM's planning output.
   * Validates the DAG structure and creates task nodes.
   */
  async createPlan(runId: string, input: TaskPlanInput): Promise<TaskPlan> {
    // Validate the plan structure
    const validation = this.validatePlanInput(input);
    if (!validation.valid) {
      throw new Error(`Invalid plan: ${validation.errors.join(', ')}`);
    }

    // Create the plan
    const plan = await this.repository.createPlan(runId);

    // Map tempIds to real UUIDs
    const tempIdToRealId = new Map<string, string>();
    for (const task of input.tasks) {
      tempIdToRealId.set(task.tempId, uuidv4());
    }

    // Create task nodes with resolved dependencies
    const nodesToCreate = input.tasks.map(task => ({
      description: task.description,
      agentType: task.agentType,
      dependencies: task.dependencies.map(depTempId => {
        const realId = tempIdToRealId.get(depTempId);
        if (!realId) {
          throw new Error(`Unknown dependency: ${depTempId}`);
        }
        return realId;
      }),
    }));

    // Create nodes in the repository
    const nodes = await this.repository.createTaskNodes(plan.id, nodesToCreate);

    // Update the plan with nodes
    plan.nodes = nodes;
    plan.status = 'executing';
    await this.repository.updatePlanStatus(plan.id, 'executing');

    return plan;
  }

  /**
   * Validate a plan input before creation.
   */
  validatePlanInput(input: TaskPlanInput): PlanValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check for empty plan
    if (!input.tasks || input.tasks.length === 0) {
      errors.push('Plan must have at least one task');
      return { valid: false, errors, warnings };
    }

    // Check for duplicate tempIds
    const tempIds = new Set<string>();
    for (const task of input.tasks) {
      if (tempIds.has(task.tempId)) {
        errors.push(`Duplicate tempId: ${task.tempId}`);
      }
      tempIds.add(task.tempId);
    }

    // Check for valid agent types
    const validAgentTypes: AgentType[] = ['general', 'research', 'coding', 'scheduling', 'productivity', 'messaging'];
    for (const task of input.tasks) {
      if (!validAgentTypes.includes(task.agentType)) {
        errors.push(`Invalid agent type: ${task.agentType} for task ${task.tempId}`);
      }
    }

    // Check for valid dependencies
    for (const task of input.tasks) {
      for (const dep of task.dependencies) {
        if (!tempIds.has(dep)) {
          errors.push(`Unknown dependency: ${dep} in task ${task.tempId}`);
        }
        if (dep === task.tempId) {
          errors.push(`Task ${task.tempId} depends on itself`);
        }
      }
    }

    // Check for cycles (DFS)
    const hasCycle = this.detectCycle(input.tasks);
    if (hasCycle) {
      errors.push('Plan contains a cycle - not a valid DAG');
    }

    // Warnings
    if (input.tasks.length > 10) {
      warnings.push('Plan has more than 10 tasks - consider breaking it down');
    }

    const tasksWithNoDeps = input.tasks.filter(t => t.dependencies.length === 0);
    if (tasksWithNoDeps.length > 5) {
      warnings.push(`${tasksWithNoDeps.length} tasks have no dependencies - ensure parallelism is intentional`);
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  /**
   * Detect cycles in the task graph using DFS.
   */
  private detectCycle(tasks: TaskPlanInput['tasks']): boolean {
    const WHITE = 0; // Not visited
    const GRAY = 1;  // Being visited
    const BLACK = 2; // Fully visited

    const colors = new Map<string, number>();
    for (const task of tasks) {
      colors.set(task.tempId, WHITE);
    }

    const depMap = new Map<string, string[]>();
    for (const task of tasks) {
      depMap.set(task.tempId, task.dependencies);
    }

    const dfs = (taskId: string): boolean => {
      colors.set(taskId, GRAY);

      const deps = depMap.get(taskId) || [];
      for (const dep of deps) {
        if (colors.get(dep) === GRAY) {
          return true; // Cycle found
        }
        if (colors.get(dep) === WHITE) {
          if (dfs(dep)) {
            return true;
          }
        }
      }

      colors.set(taskId, BLACK);
      return false;
    };

    for (const task of tasks) {
      if (colors.get(task.tempId) === WHITE) {
        if (dfs(task.tempId)) {
          return true;
        }
      }
    }

    return false;
  }

  // ===========================================================================
  // Plan Retrieval
  // ===========================================================================

  /**
   * Get a plan by ID with all its nodes.
   */
  async getPlan(planId: string): Promise<TaskPlan | null> {
    return this.repository.getPlan(planId);
  }

  /**
   * Get a plan by run ID.
   */
  async getPlanByRunId(runId: string): Promise<TaskPlan | null> {
    return this.repository.getPlanByRunId(runId);
  }

  // ===========================================================================
  // Task Execution Management
  // ===========================================================================

  /**
   * Get tasks that are ready to be executed.
   * A task is ready if all its dependencies are completed.
   */
  async getReadyTasks(planId: string): Promise<ReadyTasksResult> {
    const nodes = await this.repository.getTaskNodesByPlan(planId);
    
    const completedIds = new Set(
      nodes.filter(n => n.status === 'completed').map(n => n.id)
    );

    const readyTasks: TaskNode[] = [];
    const waitingTasks: TaskNode[] = [];
    const completedTasks: TaskNode[] = [];
    const failedTasks: TaskNode[] = [];

    for (const node of nodes) {
      switch (node.status) {
        case 'completed':
          completedTasks.push(node);
          break;
        case 'failed':
        case 'cancelled':
          failedTasks.push(node);
          break;
        case 'pending':
          // Check if all dependencies are completed
          const allDepsCompleted = node.dependencies.every(depId => completedIds.has(depId));
          if (allDepsCompleted) {
            readyTasks.push(node);
          } else {
            waitingTasks.push(node);
          }
          break;
        case 'in_progress':
          // Currently running - don't include in ready
          waitingTasks.push(node);
          break;
      }
    }

    return { readyTasks, waitingTasks, completedTasks, failedTasks };
  }

  /**
   * Check if the plan is complete (all tasks done or failed).
   */
  async isPlanComplete(planId: string): Promise<{
    complete: boolean;
    success: boolean;
    summary: { completed: number; failed: number; pending: number };
  }> {
    const nodes = await this.repository.getTaskNodesByPlan(planId);
    
    const completed = nodes.filter(n => n.status === 'completed').length;
    const failed = nodes.filter(n => n.status === 'failed' || n.status === 'cancelled').length;
    const pending = nodes.filter(n => n.status === 'pending' || n.status === 'in_progress').length;

    const complete = pending === 0;
    const success = complete && failed === 0;

    return {
      complete,
      success,
      summary: { completed, failed, pending },
    };
  }

  /**
   * Get the upstream context for a task.
   * This is the combined results from all dependency tasks.
   */
  async getUpstreamContext(planId: string, taskNodeId: string): Promise<string> {
    const node = await this.repository.getTaskNode(taskNodeId);
    if (!node) {
      throw new Error(`Task node not found: ${taskNodeId}`);
    }

    if (node.dependencies.length === 0) {
      return '';
    }

    const contextParts: string[] = [];
    
    for (const depId of node.dependencies) {
      const depNode = await this.repository.getTaskNode(depId);
      if (depNode && depNode.status === 'completed' && depNode.result) {
        contextParts.push(
          `## Result from: ${depNode.description}\n${JSON.stringify(depNode.result, null, 2)}`
        );
      }
    }

    return contextParts.join('\n\n');
  }

  // ===========================================================================
  // Task Status Updates
  // ===========================================================================

  /**
   * Mark a task as started.
   */
  async startTask(taskNodeId: string, agentId: string): Promise<void> {
    await this.repository.updateTaskNodeStatus(taskNodeId, 'in_progress');
    await this.repository.assignAgentToNode(taskNodeId, agentId);
  }

  /**
   * Mark a task as completed with result.
   */
  async completeTask(taskNodeId: string, result: unknown): Promise<void> {
    await this.repository.updateTaskNodeResult(taskNodeId, result);
    await this.repository.updateTaskNodeStatus(taskNodeId, 'completed');
  }

  /**
   * Mark a task as failed.
   */
  async failTask(taskNodeId: string, error: string): Promise<void> {
    await this.repository.updateTaskNodeResult(taskNodeId, { error });
    await this.repository.updateTaskNodeStatus(taskNodeId, 'failed');
  }

  /**
   * Cancel a task.
   */
  async cancelTask(taskNodeId: string, reason: string): Promise<void> {
    await this.repository.updateTaskNodeResult(taskNodeId, { cancelled: true, reason });
    await this.repository.updateTaskNodeStatus(taskNodeId, 'cancelled');
  }

  // ===========================================================================
  // Plan Modification
  // ===========================================================================

  /**
   * Add a new task to an existing plan.
   */
  async addTask(
    planId: string,
    task: { description: string; agentType: AgentType; dependencies: string[] }
  ): Promise<TaskNode> {
    // Validate dependencies exist
    const existingNodes = await this.repository.getTaskNodesByPlan(planId);
    const existingIds = new Set(existingNodes.map(n => n.id));
    
    for (const depId of task.dependencies) {
      if (!existingIds.has(depId)) {
        throw new Error(`Unknown dependency: ${depId}`);
      }
    }

    return this.repository.createTaskNode(planId, task);
  }

  /**
   * Remove a task from a plan.
   * Only allowed if the task is pending and has no dependents.
   */
  async removeTask(planId: string, taskNodeId: string): Promise<void> {
    const node = await this.repository.getTaskNode(taskNodeId);
    if (!node) {
      throw new Error(`Task node not found: ${taskNodeId}`);
    }

    if (node.status !== 'pending') {
      throw new Error(`Cannot remove task in status: ${node.status}`);
    }

    // Check for dependents
    const allNodes = await this.repository.getTaskNodesByPlan(planId);
    const dependents = allNodes.filter(n => n.dependencies.includes(taskNodeId));
    
    if (dependents.length > 0) {
      throw new Error(`Cannot remove task with dependents: ${dependents.map(n => n.description).join(', ')}`);
    }

    await this.repository.updateTaskNodeStatus(taskNodeId, 'cancelled');
  }

  // ===========================================================================
  // Plan Analysis
  // ===========================================================================

  /**
   * Determine if the plan is a simple sequential list or a true DAG.
   */
  getPlanStructure(plan: TaskPlan): 'sequential' | 'dag' {
    // A plan is sequential if each task has at most one dependency
    // and there are no parallel branches
    const hasParallel = plan.nodes.some(node => {
      // Find all nodes that depend on this node
      const dependents = plan.nodes.filter(n => n.dependencies.includes(node.id));
      return dependents.length > 1;
    });

    // Also check if any node has multiple dependencies (joining branches)
    const hasJoin = plan.nodes.some(node => node.dependencies.length > 1);

    // Check if multiple nodes have no dependencies (parallel start)
    const rootNodes = plan.nodes.filter(n => n.dependencies.length === 0);
    const hasParallelStart = rootNodes.length > 1;

    return (hasParallel || hasJoin || hasParallelStart) ? 'dag' : 'sequential';
  }

  /**
   * Get a human-readable summary of the plan.
   */
  getPlanSummary(plan: TaskPlan): string {
    const structure = this.getPlanStructure(plan);
    const nodeDescriptions = plan.nodes.map((node, index) => {
      const deps = node.dependencies.length > 0
        ? ` (depends on: ${node.dependencies.length} tasks)`
        : ' (no dependencies)';
      return `${index + 1}. [${node.agentType}] ${node.description}${deps}`;
    });

    return `Plan (${structure}): ${plan.nodes.length} tasks\n${nodeDescriptions.join('\n')}`;
  }
}
