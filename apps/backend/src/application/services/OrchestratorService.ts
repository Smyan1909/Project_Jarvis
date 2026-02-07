// =============================================================================
// Orchestrator Service
// =============================================================================
// The main autonomous orchestrator that acts as the "brain" of Project Jarvis.
// Handles:
// - Receiving user input
// - Deciding whether to respond directly or create a plan
// - Creating and executing task plans (DAGs)
// - Spawning and monitoring sub-agents
// - Intervening when agents go off-track
// - Consolidating results and responding to users

import { v4 as uuidv4 } from 'uuid';
import type {
  OrchestratorState,
  TaskPlan,
  TaskNode,
  StreamEvent,
  LLMMessage,
  ToolDefinition,
  AgentType,
} from '@project-jarvis/shared-types';
import type { LLMProviderPort, StreamChunk } from '../../ports/LLMProviderPort.js';
import type { ToolInvokerPort } from '../../ports/ToolInvokerPort.js';
import type { MemoryStorePort } from '../../ports/MemoryStorePort.js';
import type { IOrchestratorStateRepository } from '../../adapters/orchestrator/OrchestratorStateRepository.js';
import type { IOrchestratorCacheAdapter } from '../../adapters/orchestrator/OrchestratorCacheAdapter.js';
import type { AgentRunRepository } from '../../adapters/storage/agent-run-repository.js';
import { TaskPlanService, type TaskPlanInput } from './TaskPlanService.js';
import { SubAgentManager, type AgentHandle } from './SubAgentManager.js';
import { LoopDetectionService } from './LoopDetectionService.js';
import type { ContextManagementService } from './ContextManagementService.js';
import type { ConversationHistoryService } from './ConversationHistoryService.js';
import {
  ORCHESTRATOR_TOOLS,
  ORCHESTRATOR_ONLY_TOOL_IDS,
} from '../../domain/orchestrator/OrchestratorTools.js';
import { ORCHESTRATOR_SYSTEM_PROMPT } from '../../domain/orchestrator/prompts.js';
import { logger } from '../../infrastructure/logging/logger.js';

// =============================================================================
// Orchestrator Configuration
// =============================================================================

export interface OrchestratorConfig {
  /** Maximum iterations for the orchestrator loop */
  maxIterations?: number;
  /** Whether to enable direct tool execution for simple tasks */
  enableDirectExecution?: boolean;
  /** Callback for streaming events to client */
  onEvent?: (event: StreamEvent) => void;
}

// =============================================================================
// Orchestrator Run Result
// =============================================================================

export interface OrchestratorRunResult {
  success: boolean;
  response: string | null;
  error: string | null;
  totalTokens: number;
  totalCost: number;
  planId: string | null;
  tasksCompleted: number;
  tasksFailed: number;
  /** All messages from this run (for persistence) */
  allMessages?: LLMMessage[];
}

// =============================================================================
// Orchestrator Service
// =============================================================================

export class OrchestratorService {
  private maxIterations: number;
  private enableDirectExecution: boolean;
  private onEvent: ((event: StreamEvent) => void) | null;

  constructor(
    private llm: LLMProviderPort,
    private toolInvoker: ToolInvokerPort,
    private memoryStore: MemoryStorePort,
    private repository: IOrchestratorStateRepository,
    private cache: IOrchestratorCacheAdapter,
    private planService: TaskPlanService,
    private agentManager: SubAgentManager,
    private loopDetection: LoopDetectionService,
    private contextManager?: ContextManagementService,
    private conversationHistory?: ConversationHistoryService,
    private agentRunRepository?: AgentRunRepository,
    config: OrchestratorConfig = {}
  ) {
    this.maxIterations = config.maxIterations ?? 50;
    this.enableDirectExecution = config.enableDirectExecution ?? true;
    this.onEvent = config.onEvent ?? null;
  }

  // ===========================================================================
  // Main Entry Point
  // ===========================================================================

  /**
   * Execute an orchestrator run for a user's input.
   * This is the main entry point called from the API.
   */
  async executeRun(
    userId: string,
    runId: string,
    input: string
  ): Promise<OrchestratorRunResult> {
    const log = logger.child({ runId, userId, service: 'OrchestratorService' });
    log.info('executeRun started', { inputLength: input.length });

    // Create agent run record in database (for message persistence)
    let dbRunId: string | null = null;
    if (this.agentRunRepository) {
      try {
        const agentRun = await this.agentRunRepository.create(userId);
        dbRunId = agentRun.id;
        log.debug('Agent run record created', { dbRunId });
      } catch (error) {
        log.warn('Failed to create agent run record, messages will not be linked to run', { error });
      }
    }

    // Initialize in-memory state (uses provided runId for SSE events)
    const state = await this.repository.createOrchestratorState(runId, userId);
    await this.cache.setOrchestratorState(state);
    log.debug('State initialized');

    try {
      // Emit starting status
      await this.emitEvent({
        type: 'orchestrator.status',
        status: 'planning',
        message: 'Analyzing request...',
      });
      await this.repository.updateOrchestratorStatus(runId, 'planning');

      // Load conversation history (if enabled)
      let historyMessages: LLMMessage[] = [];
      if (this.conversationHistory) {
        log.debug('Loading conversation history');
        const historyContext = await this.conversationHistory.loadContext(userId);
        historyMessages = historyContext.messages;
        log.debug('History loaded', { 
          messageCount: historyContext.messageCount,
          hasSummary: historyContext.hasSummary,
          estimatedTokens: historyContext.estimatedTokens,
        });
      }

      // Retrieve relevant memories for context
      log.debug('Searching memories');
      const memories = await this.memoryStore.search(userId, input, 5);
      const memoryContext = memories.length > 0
        ? `\n\nRelevant context from memory:\n${memories.map(m => `- ${m.content}`).join('\n')}`
        : '';
      log.debug('Memories retrieved', { count: memories.length });

      // Get all available tools (orchestrator + standard)
      log.debug('Getting orchestrator tools');
      const allTools = await this.getOrchestratorTools(userId);
      log.debug('Tools retrieved', { count: allTools.length });

      // Run the orchestrator loop
      log.info('Starting orchestrator loop', { 
        model: this.llm.getModel(),
        toolCount: allTools.length,
        historyMessageCount: historyMessages.length,
      });
      const result = await this.runOrchestratorLoop(
        userId,
        runId,
        input,
        memoryContext,
        historyMessages,
        allTools,
        state
      );

      // Persist messages and maybe summarize (if enabled)
      if (this.conversationHistory && result.allMessages) {
        log.debug('Persisting run messages', { dbRunId });
        await this.conversationHistory.persistRunMessages(userId, dbRunId, result.allMessages);
        await this.conversationHistory.maybeSummarize(userId);
      }

      // Update agent run record with final stats
      if (this.agentRunRepository && dbRunId) {
        try {
          await this.agentRunRepository.updateStatus(dbRunId, {
            status: 'completed',
            totalTokens: result.totalTokens,
            totalCost: result.totalCost,
          });
        } catch (error) {
          log.warn('Failed to update agent run record', { dbRunId, error });
        }
      }

      // Mark as completed
      await this.repository.updateOrchestratorStatus(runId, 'completed');
      await this.emitEvent({
        type: 'orchestrator.status',
        status: 'completed',
      });

      log.info('executeRun completed successfully', { 
        totalTokens: result.totalTokens,
        success: result.success,
      });
      return result;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      
      log.error('executeRun failed', error, { 
        errorMessage,
        errorStack,
      });

      await this.repository.updateOrchestratorStatus(runId, 'failed');
      await this.emitEvent({
        type: 'orchestrator.status',
        status: 'failed',
        message: errorMessage,
      });
      await this.emitEvent({
        type: 'agent.error',
        message: errorMessage,
        code: 'ORCHESTRATOR_ERROR',
      });

      // Cancel any running agents
      await this.agentManager.cancelAllAgents(runId, 'Orchestrator error');

      return {
        success: false,
        response: null,
        error: errorMessage,
        totalTokens: 0,
        totalCost: 0,
        planId: null,
        tasksCompleted: 0,
        tasksFailed: 0,
      };
    }
  }

  // ===========================================================================
  // Orchestrator Loop
  // ===========================================================================

  private async runOrchestratorLoop(
    userId: string,
    runId: string,
    input: string,
    memoryContext: string,
    historyMessages: LLMMessage[],
    tools: ToolDefinition[],
    state: OrchestratorState
  ): Promise<OrchestratorRunResult> {
    const log = logger.child({ runId, userId, method: 'runOrchestratorLoop' });
    
    // Start with conversation history, then add current user input
    const messages: LLMMessage[] = [
      ...historyMessages,
      { role: 'user', content: input + memoryContext },
    ];
    
    // Track which messages are new in this run (for persistence)
    const newMessagesStartIndex = historyMessages.length;

    let totalTokens = 0;
    let totalCost = 0;
    let finalResponse: string | null = null;
    let planId: string | null = null;
    let tasksCompleted = 0;
    let tasksFailed = 0;

    // Track active agent handles
    const activeAgents = new Map<string, AgentHandle>();

    for (let iteration = 0; iteration < this.maxIterations; iteration++) {
      log.debug('Starting iteration', { iteration, messageCount: messages.length });
      
      // Check for active agents that have completed
      await this.checkCompletedAgents(runId, activeAgents);

      // Manage context before LLM call (automatic summarization if needed)
      let messagesToSend = messages;
      if (this.contextManager) {
        const contextResult = await this.contextManager.manageContext(
          messages,
          {
            modelId: this.llm.getModel(),
            systemPrompt: ORCHESTRATOR_SYSTEM_PROMPT,
            tools,
          }
        );

        if (contextResult.summarized && contextResult.summary) {
          // Replace messages array with summarized version
          messages.length = 0;
          messages.push(...contextResult.messages);
          messagesToSend = messages;

          log.info('Context summarized', {
            summarizedMessages: contextResult.summary.summarizedMessageCount,
            originalTokens: contextResult.summary.originalTokenCount,
            newTokens: contextResult.summary.summaryTokenCount,
          });

          await this.emitEvent({
            type: 'orchestrator.status',
            status: 'executing',
            message: 'Context summarized to fit within limits',
          });
        }
      }

      // Stream LLM response
      let content = '';
      const toolCalls: Array<{ id: string; name: string; arguments: string }> = [];

      try {
        log.debug('Starting LLM stream', { 
          model: this.llm.getModel(),
          toolCount: tools.length,
        });
        
        for await (const chunk of this.llm.stream(messagesToSend, {
          systemPrompt: ORCHESTRATOR_SYSTEM_PROMPT,
          tools,
          temperature: 0.7,
          maxTokens: 4096,
        })) {
          switch (chunk.type) {
            case 'token':
              content += chunk.token;
              // Only emit tokens if we're in direct response mode
              if (!state.plan) {
                await this.emitEvent({ type: 'agent.token', token: chunk.token });
              }
              break;

            case 'tool_call':
              log.debug('Tool call received', { toolName: chunk.toolCall.name });
              toolCalls.push(chunk.toolCall);
              break;

            case 'done':
              log.debug('LLM stream done', { 
                usage: chunk.response.usage,
                finishReason: chunk.response.finishReason,
              });
              totalTokens += chunk.response.usage.totalTokens;
              totalCost += this.llm.calculateCost(
                chunk.response.usage.promptTokens,
                chunk.response.usage.completionTokens
              );
              break;
          }
        }
      } catch (streamError) {
        log.error('LLM stream error', streamError, {
          iteration,
          model: this.llm.getModel(),
        });
        throw streamError;
      }

      // Add assistant message
      const assistantMessage: LLMMessage = {
        role: 'assistant',
        content: content || '',
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      };
      messages.push(assistantMessage);

      // Process tool calls
      if (toolCalls.length > 0) {
        for (const tc of toolCalls) {
          const result = await this.handleToolCall(
            userId,
            runId,
            tc,
            activeAgents
          );

          // Add tool result to messages
          messages.push({
            role: 'tool',
            content: JSON.stringify(result),
            toolCallId: tc.id,
          });

          // Check for special tool results
          const typedResult = result as Record<string, unknown>;
          if (tc.name === 'respond_to_user') {
            finalResponse = (typedResult.content as string) || content;
            await this.emitEvent({
              type: 'agent.final',
              content: finalResponse || '',
              usage: { totalTokens, totalCost },
            });
            
            // Get plan stats if we have a plan
            if (planId) {
              const planStatus = await this.planService.isPlanComplete(planId);
              tasksCompleted = planStatus.summary.completed;
              tasksFailed = planStatus.summary.failed;
            }

            return {
              success: true,
              response: finalResponse,
              error: null,
              totalTokens,
              totalCost,
              planId,
              tasksCompleted,
              tasksFailed,
              allMessages: messages.slice(newMessagesStartIndex),
            };
          }

          if (tc.name === 'create_task_plan' && typedResult.planId) {
            planId = typedResult.planId as string;
            state.plan = await this.planService.getPlan(planId);
            await this.repository.updateOrchestratorPlan(runId, planId);
            await this.repository.updateOrchestratorStatus(runId, 'executing');
            await this.emitEvent({
              type: 'orchestrator.status',
              status: 'executing',
              message: 'Executing plan...',
            });
          }
        }

        continue; // Continue the loop
      }

      // No tool calls - if we have content, it's a direct response
      if (content && !state.plan) {
        finalResponse = content;
        await this.emitEvent({
          type: 'agent.final',
          content: finalResponse,
          usage: { totalTokens, totalCost },
        });

        return {
          success: true,
          response: finalResponse,
          error: null,
          totalTokens,
          totalCost,
          planId: null,
          tasksCompleted: 0,
          tasksFailed: 0,
          allMessages: messages.slice(newMessagesStartIndex),
        };
      }

      // If we have a plan, check if it's complete
      if (planId) {
        const planStatus = await this.planService.isPlanComplete(planId);
        if (planStatus.complete) {
          // Plan is done, prompt for final response
          messages.push({
            role: 'user',
            content: 'All tasks are complete. Please provide a summary response to the user.',
          });
        }
      }
    }

    // Reached max iterations
    throw new Error(`Orchestrator reached maximum iterations (${this.maxIterations})`);
  }

  // ===========================================================================
  // Tool Call Handling
  // ===========================================================================

  private async handleToolCall(
    userId: string,
    runId: string,
    toolCall: { id: string; name: string; arguments: string },
    activeAgents: Map<string, AgentHandle>
  ): Promise<unknown> {
    const args = JSON.parse(toolCall.arguments);

    switch (toolCall.name) {
      case 'create_task_plan':
        return this.handleCreatePlan(runId, args);

      case 'modify_plan':
        return this.handleModifyPlan(runId, args);

      case 'start_agent':
        return this.handleStartAgent(runId, args, activeAgents);

      case 'monitor_agent':
        return this.handleMonitorAgent(args.agentId);

      case 'intervene_agent':
        return this.handleInterveneAgent(runId, args, activeAgents);

      case 'cancel_agent':
        return this.handleCancelAgent(args, activeAgents);

      case 'mark_task_complete':
        return this.handleMarkTaskComplete(runId, args);

      case 'mark_task_failed':
        return this.handleMarkTaskFailed(runId, args);

      case 'store_memory':
        return this.handleStoreMemory(userId, args);

      case 'respond_to_user':
        return { success: true, content: args.content };

      case 'get_plan_status':
        return this.handleGetPlanStatus(runId);

      default:
        // Handle standard tools (direct execution)
        if (this.enableDirectExecution && !ORCHESTRATOR_ONLY_TOOL_IDS.has(toolCall.name)) {
          return this.toolInvoker.invoke(userId, toolCall.name, args);
        }
        return { success: false, error: `Unknown tool: ${toolCall.name}` };
    }
  }

  // ===========================================================================
  // Tool Handlers
  // ===========================================================================

  private async handleCreatePlan(
    runId: string,
    args: { reasoning: string; tasks: TaskPlanInput['tasks'] }
  ): Promise<{ success: boolean; planId?: string; error?: string }> {
    try {
      const plan = await this.planService.createPlan(runId, {
        tasks: args.tasks,
        reasoning: args.reasoning,
      });

      const structure = this.planService.getPlanStructure(plan);

      await this.emitEvent({
        type: 'plan.created',
        planId: plan.id,
        taskCount: plan.nodes.length,
        structure,
        tasks: plan.nodes.map(n => ({
          id: n.id,
          description: n.description,
          agentType: n.agentType,
          dependencies: n.dependencies,
        })),
      });

      return { success: true, planId: plan.id };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { success: false, error: errorMessage };
    }
  }

  private async handleModifyPlan(
    runId: string,
    args: { action: string; reason: string; taskId?: string; newTask?: unknown }
  ): Promise<{ success: boolean; error?: string }> {
    const plan = await this.planService.getPlanByRunId(runId);
    if (!plan) {
      return { success: false, error: 'No plan exists for this run' };
    }

    try {
      switch (args.action) {
        case 'add':
          if (args.newTask) {
            const task = args.newTask as { description: string; agentType: AgentType; dependencies: string[] };
            await this.planService.addTask(plan.id, task);
          }
          break;

        case 'remove':
          if (args.taskId) {
            await this.planService.removeTask(plan.id, args.taskId);
          }
          break;

        // TODO: Implement update and reorder
      }

      await this.emitEvent({
        type: 'plan.modified',
        planId: plan.id,
        modification: args.action as 'task_added' | 'task_removed',
        reason: args.reason,
        affectedTaskIds: args.taskId ? [args.taskId] : [],
      });

      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { success: false, error: errorMessage };
    }
  }

  private async handleStartAgent(
    runId: string,
    args: { taskId: string; additionalTools?: string[]; instructions?: string },
    activeAgents: Map<string, AgentHandle>
  ): Promise<{ success: boolean; agentId?: string; error?: string }> {
    const plan = await this.planService.getPlanByRunId(runId);
    if (!plan) {
      return { success: false, error: 'No plan exists for this run' };
    }

    const taskNode = plan.nodes.find(n => n.id === args.taskId);
    if (!taskNode) {
      return { success: false, error: `Task not found: ${args.taskId}` };
    }

    if (taskNode.status !== 'pending') {
      return { success: false, error: `Task is not pending: ${taskNode.status}` };
    }

    // Get upstream context
    const upstreamContext = await this.planService.getUpstreamContext(plan.id, args.taskId);

    // Spawn the agent
    const handle = await this.agentManager.spawnAgent(runId, {
      taskNodeId: args.taskId,
      agentType: taskNode.agentType,
      taskDescription: taskNode.description,
      upstreamContext: upstreamContext || null,
      additionalTools: args.additionalTools || [],
      instructions: args.instructions,
    });

    // Track the agent
    activeAgents.set(handle.id, handle);

    // Update task status
    await this.planService.startTask(args.taskId, handle.id);

    // Emit events
    await this.emitEvent({
      type: 'task.started',
      taskId: args.taskId,
      description: taskNode.description,
      agentType: taskNode.agentType,
      agentId: handle.id,
    });

    await this.emitEvent({
      type: 'agent.spawned',
      agentId: handle.id,
      taskId: args.taskId,
      agentType: taskNode.agentType,
      taskDescription: taskNode.description,
    });

    // Set up completion handler
    handle.waitForCompletion().then(async (result) => {
      if (result.success) {
        await this.planService.completeTask(args.taskId, result.output);
        await this.emitEvent({
          type: 'task.completed',
          taskId: args.taskId,
          success: true,
          result: result.output,
        });
      } else {
        await this.planService.failTask(args.taskId, result.error || 'Unknown error');
        await this.emitEvent({
          type: 'task.completed',
          taskId: args.taskId,
          success: false,
          error: result.error || 'Unknown error',
        });
      }
      activeAgents.delete(handle.id);
    });

    return { success: true, agentId: handle.id };
  }

  private async handleMonitorAgent(
    agentId: string
  ): Promise<{ success: boolean; state?: unknown; error?: string }> {
    const state = await this.agentManager.getAgentState(agentId);
    if (!state) {
      return { success: false, error: `Agent not found: ${agentId}` };
    }

    return {
      success: true,
      state: {
        id: state.id,
        status: state.status,
        taskDescription: state.taskDescription,
        messageCount: state.messages.length,
        toolCallCount: state.toolCalls.length,
        recentReasoning: state.reasoningSteps.slice(-3).map(s => s.content),
        tokens: state.totalTokens,
        cost: state.totalCost,
      },
    };
  }

  private async handleInterveneAgent(
    runId: string,
    args: { agentId: string; action: string; reason: string; guidance?: string },
    activeAgents: Map<string, AgentHandle>
  ): Promise<{ success: boolean; error?: string }> {
    // Check loop detection
    const canIntervene = await this.loopDetection.canIntervene(runId);
    if (!canIntervene.allowed) {
      return { success: false, error: canIntervene.reason };
    }

    const handle = activeAgents.get(args.agentId);
    if (!handle) {
      return { success: false, error: `Agent not active: ${args.agentId}` };
    }

    // Record the intervention
    await this.loopDetection.recordIntervention(runId);

    const state = handle.getState();

    switch (args.action) {
      case 'guide':
      case 'redirect':
        if (args.guidance) {
          handle.sendGuidance(args.guidance);
        }
        break;

      case 'cancel':
        handle.cancel(args.reason);
        break;
    }

    await this.emitEvent({
      type: 'agent.intervention',
      agentId: args.agentId,
      taskId: state.taskNodeId,
      reason: args.reason,
      action: args.action as 'guide' | 'redirect' | 'cancel',
      guidance: args.guidance,
    });

    return { success: true };
  }

  private async handleCancelAgent(
    args: { agentId: string; reason: string },
    activeAgents: Map<string, AgentHandle>
  ): Promise<{ success: boolean; error?: string }> {
    const handle = activeAgents.get(args.agentId);
    if (!handle) {
      return { success: false, error: `Agent not active: ${args.agentId}` };
    }

    handle.cancel(args.reason);
    activeAgents.delete(args.agentId);

    return { success: true };
  }

  private async handleMarkTaskComplete(
    runId: string,
    args: { taskId: string; result?: unknown; summary: string }
  ): Promise<{ success: boolean; error?: string }> {
    try {
      await this.planService.completeTask(args.taskId, args.result || { summary: args.summary });

      await this.emitEvent({
        type: 'task.completed',
        taskId: args.taskId,
        success: true,
        result: args.result,
      });

      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { success: false, error: errorMessage };
    }
  }

  private async handleMarkTaskFailed(
    runId: string,
    args: { taskId: string; error: string; shouldRetry?: boolean; retryStrategy?: string }
  ): Promise<{ success: boolean; canRetry?: boolean; error?: string }> {
    // Check if we can retry
    if (args.shouldRetry) {
      const canRetry = await this.loopDetection.canRetryTask(runId, args.taskId);
      if (!canRetry.allowed) {
        await this.planService.failTask(args.taskId, args.error);
        await this.emitEvent({
          type: 'task.completed',
          taskId: args.taskId,
          success: false,
          error: `${args.error} (max retries reached)`,
        });
        return { success: true, canRetry: false };
      }

      // Record the retry
      await this.loopDetection.recordTaskRetry(runId, args.taskId);

      // Reset task to pending for retry
      await this.repository.updateTaskNodeStatus(args.taskId, 'pending');

      return { success: true, canRetry: true };
    }

    await this.planService.failTask(args.taskId, args.error);
    await this.emitEvent({
      type: 'task.completed',
      taskId: args.taskId,
      success: false,
      error: args.error,
    });

    return { success: true, canRetry: false };
  }

  private async handleStoreMemory(
    userId: string,
    args: { content: string; category: string; metadata?: unknown }
  ): Promise<{ success: boolean; memoryId?: string; error?: string }> {
    try {
      const memory = await this.memoryStore.store(userId, args.content, {
        category: args.category,
        ...(args.metadata as Record<string, unknown> || {}),
      });

      return { success: true, memoryId: memory.id };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { success: false, error: errorMessage };
    }
  }

  private async handleGetPlanStatus(
    runId: string
  ): Promise<{ success: boolean; status?: unknown; error?: string }> {
    const plan = await this.planService.getPlanByRunId(runId);
    if (!plan) {
      return { success: false, error: 'No plan exists for this run' };
    }

    const readyTasks = await this.planService.getReadyTasks(plan.id);
    const completionStatus = await this.planService.isPlanComplete(plan.id);

    return {
      success: true,
      status: {
        planId: plan.id,
        status: plan.status,
        totalTasks: plan.nodes.length,
        completed: completionStatus.summary.completed,
        failed: completionStatus.summary.failed,
        pending: completionStatus.summary.pending,
        readyToStart: readyTasks.readyTasks.map(t => ({
          id: t.id,
          description: t.description,
          agentType: t.agentType,
        })),
        isComplete: completionStatus.complete,
        isSuccess: completionStatus.success,
      },
    };
  }

  // ===========================================================================
  // Helper Methods
  // ===========================================================================

  private async getOrchestratorTools(userId: string): Promise<ToolDefinition[]> {
    // Get standard tools from registry
    const standardTools = await this.toolInvoker.getTools(userId);

    // Combine with orchestrator-only tools
    return [...ORCHESTRATOR_TOOLS, ...standardTools];
  }

  private async checkCompletedAgents(
    runId: string,
    activeAgents: Map<string, AgentHandle>
  ): Promise<void> {
    for (const [agentId, handle] of activeAgents) {
      const state = handle.getState();
      if (['completed', 'failed', 'cancelled'].includes(state.status)) {
        activeAgents.delete(agentId);
      }
    }
  }

  private async emitEvent(event: StreamEvent): Promise<void> {
    if (this.onEvent) {
      try {
        this.onEvent(event);
      } catch (error) {
        console.error('Error emitting event:', error);
      }
    }
  }
}
