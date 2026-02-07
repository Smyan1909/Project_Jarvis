// =============================================================================
// Sub-Agent Manager
// =============================================================================
// Manages the lifecycle of sub-agents:
// - Spawning new agents
// - Monitoring running agents
// - Sending interventions
// - Collecting results

import { v4 as uuidv4 } from 'uuid';
import type {
  SubAgentState,
  SubAgentResult,
  SpawnAgentConfig,
  AgentType,
  StreamEvent,
} from '@project-jarvis/shared-types';
import type { LLMProviderPort } from '../../ports/LLMProviderPort.js';
import type { ToolInvokerPort } from '../../ports/ToolInvokerPort.js';
import type { IOrchestratorStateRepository } from '../../adapters/orchestrator/OrchestratorStateRepository.js';
import type { IOrchestratorCacheAdapter } from '../../adapters/orchestrator/OrchestratorCacheAdapter.js';
import { SubAgentRunner, type SubAgentEvent } from './SubAgentRunner.js';

// =============================================================================
// Agent Handle (for external management)
// =============================================================================

export interface AgentHandle {
  id: string;
  taskNodeId: string;
  agentType: AgentType;
  
  /** Get current state */
  getState(): SubAgentState;
  
  /** Wait for completion */
  waitForCompletion(): Promise<SubAgentResult>;
  
  /** Send guidance */
  sendGuidance(guidance: string): void;
  
  /** Cancel the agent */
  cancel(reason: string): void;
  
  /** Subscribe to events */
  onEvent(callback: (event: SubAgentEvent) => void): void;
}

// =============================================================================
// Sub-Agent Manager
// =============================================================================

export class SubAgentManager {
  private agents: Map<string, {
    runner: SubAgentRunner;
    promise: Promise<SubAgentResult>;
    eventCallbacks: Array<(event: SubAgentEvent) => void>;
  }> = new Map();

  constructor(
    private llmProvider: LLMProviderPort,
    private toolInvoker: ToolInvokerPort,
    private repository: IOrchestratorStateRepository,
    private cache: IOrchestratorCacheAdapter
  ) {}

  // ===========================================================================
  // Agent Lifecycle
  // ===========================================================================

  /**
   * Spawn a new sub-agent for a task.
   * Returns an AgentHandle for management.
   */
  async spawnAgent(
    runId: string,
    config: SpawnAgentConfig
  ): Promise<AgentHandle> {
    const agentId = uuidv4();

    // Create sub-agent state in repository
    const state = await this.repository.createSubAgent({
      runId,
      taskNodeId: config.taskNodeId,
      agentType: config.agentType,
      status: 'initializing',
      taskDescription: config.taskDescription,
      upstreamContext: config.upstreamContext,
      additionalTools: config.additionalTools,
    });

    // Update cache
    await this.cache.setSubAgentState(state);
    await this.cache.addActiveAgent(runId, state.id);

    // Create runner
    const runner = new SubAgentRunner(
      {
        agentId: state.id,
        runId,
        taskNodeId: config.taskNodeId,
        agentType: config.agentType,
        taskDescription: config.taskDescription,
        upstreamContext: config.upstreamContext,
        additionalTools: config.additionalTools,
        instructions: config.instructions,
      },
      this.llmProvider,
      this.toolInvoker,
      this.repository
    );

    // Set up event forwarding
    const eventCallbacks: Array<(event: SubAgentEvent) => void> = [];
    
    runner.on('event', async (event: SubAgentEvent) => {
      // Forward to callbacks
      for (const callback of eventCallbacks) {
        try {
          callback(event);
        } catch (error) {
          console.error('Error in event callback:', error);
        }
      }

      // Update cache on status changes
      if (event.type === 'status') {
        const currentState = runner.getState();
        await this.cache.setSubAgentState(currentState);
        
        // Remove from active if completed
        if (['completed', 'failed', 'cancelled'].includes(event.status)) {
          await this.cache.removeActiveAgent(runId, state.id);
        }
      }

      // Publish to event stream
      await this.publishStreamEvent(runId, state.id, event);
    });

    // Start the agent (non-blocking)
    const promise = runner.run().finally(async () => {
      // Cleanup on completion
      await this.repository.updateSubAgentStatus(state.id, runner.getState().status);
      await this.cache.removeActiveAgent(runId, state.id);
      this.agents.delete(state.id);
    });

    // Store reference
    this.agents.set(state.id, { runner, promise, eventCallbacks });

    // Create handle
    const handle: AgentHandle = {
      id: state.id,
      taskNodeId: config.taskNodeId,
      agentType: config.agentType,
      
      getState: () => runner.getState(),
      waitForCompletion: () => promise,
      sendGuidance: (guidance: string) => runner.injectGuidance(guidance),
      cancel: (reason: string) => runner.cancel(reason),
      onEvent: (callback: (event: SubAgentEvent) => void) => {
        eventCallbacks.push(callback);
      },
    };

    return handle;
  }

  /**
   * Get a handle to an existing agent.
   */
  getAgent(agentId: string): AgentHandle | null {
    const entry = this.agents.get(agentId);
    if (!entry) return null;

    return {
      id: agentId,
      taskNodeId: entry.runner.getState().taskNodeId,
      agentType: entry.runner.getState().agentType,
      getState: () => entry.runner.getState(),
      waitForCompletion: () => entry.promise,
      sendGuidance: (guidance: string) => entry.runner.injectGuidance(guidance),
      cancel: (reason: string) => entry.runner.cancel(reason),
      onEvent: (callback: (event: SubAgentEvent) => void) => {
        entry.eventCallbacks.push(callback);
      },
    };
  }

  /**
   * Get state of an agent (from cache or repository).
   */
  async getAgentState(agentId: string): Promise<SubAgentState | null> {
    // Try cache first
    const cached = await this.cache.getSubAgentState(agentId);
    if (cached) return cached;

    // Fall back to repository
    return this.repository.getSubAgent(agentId);
  }

  /**
   * Get all active agents for a run.
   */
  async getActiveAgents(runId: string): Promise<SubAgentState[]> {
    const agentIds = await this.cache.getActiveAgents(runId);
    const states: SubAgentState[] = [];

    for (const agentId of agentIds) {
      const state = await this.getAgentState(agentId);
      if (state) {
        states.push(state);
      }
    }

    return states;
  }

  // ===========================================================================
  // Agent Control
  // ===========================================================================

  /**
   * Send guidance to a running agent.
   */
  async sendGuidance(agentId: string, guidance: string): Promise<boolean> {
    const entry = this.agents.get(agentId);
    if (!entry) return false;

    entry.runner.injectGuidance(guidance);
    
    // Also persist guidance in repository for recovery
    await this.repository.setGuidance(agentId, guidance);
    
    return true;
  }

  /**
   * Cancel a running agent.
   */
  async cancelAgent(agentId: string, reason: string): Promise<boolean> {
    const entry = this.agents.get(agentId);
    if (!entry) return false;

    entry.runner.cancel(reason);
    
    return true;
  }

  /**
   * Wait for an agent to complete.
   */
  async waitForAgent(agentId: string): Promise<SubAgentResult | null> {
    const entry = this.agents.get(agentId);
    if (!entry) return null;

    return entry.promise;
  }

  /**
   * Wait for multiple agents to complete.
   */
  async waitForAgents(agentIds: string[]): Promise<Map<string, SubAgentResult>> {
    const results = new Map<string, SubAgentResult>();
    
    await Promise.all(
      agentIds.map(async (agentId) => {
        const result = await this.waitForAgent(agentId);
        if (result) {
          results.set(agentId, result);
        }
      })
    );

    return results;
  }

  // ===========================================================================
  // Monitoring
  // ===========================================================================

  /**
   * Get a summary of all agents for a run.
   */
  async getRunSummary(runId: string): Promise<{
    total: number;
    active: number;
    completed: number;
    failed: number;
    cancelled: number;
    agents: Array<{
      id: string;
      agentType: AgentType;
      status: SubAgentState['status'];
      taskDescription: string;
      tokens: number;
      cost: number;
    }>;
  }> {
    const allAgents = await this.repository.getSubAgentsByRun(runId);
    
    let active = 0;
    let completed = 0;
    let failed = 0;
    let cancelled = 0;

    const agents = allAgents.map(agent => {
      switch (agent.status) {
        case 'initializing':
        case 'running':
          active++;
          break;
        case 'completed':
          completed++;
          break;
        case 'failed':
          failed++;
          break;
        case 'cancelled':
          cancelled++;
          break;
      }

      return {
        id: agent.id,
        agentType: agent.agentType,
        status: agent.status,
        taskDescription: agent.taskDescription,
        tokens: agent.totalTokens,
        cost: agent.totalCost,
      };
    });

    return {
      total: allAgents.length,
      active,
      completed,
      failed,
      cancelled,
      agents,
    };
  }

  /**
   * Check if any agents are still running for a run.
   */
  async hasActiveAgents(runId: string): Promise<boolean> {
    const activeIds = await this.cache.getActiveAgents(runId);
    return activeIds.length > 0;
  }

  // ===========================================================================
  // Event Publishing
  // ===========================================================================

  private async publishStreamEvent(
    runId: string,
    agentId: string,
    event: SubAgentEvent
  ): Promise<void> {
    let streamEvent: StreamEvent | null = null;

    switch (event.type) {
      case 'token':
        streamEvent = {
          type: 'agent.token',
          token: event.token,
        };
        break;

      case 'reasoning':
        streamEvent = {
          type: 'agent.reasoning',
          agentId,
          step: event.step,
        };
        break;

      case 'tool_call':
        streamEvent = {
          type: 'agent.tool_call',
          toolId: event.toolId,
          toolName: event.toolName,
          input: event.input,
        };
        break;

      case 'tool_result':
        streamEvent = {
          type: 'agent.tool_result',
          toolId: event.toolId,
          output: event.output,
          success: event.success,
        };
        break;

      case 'status':
        if (event.status === 'completed' || event.status === 'failed' || event.status === 'cancelled') {
          const agentState = await this.getAgentState(agentId);
          streamEvent = {
            type: 'agent.terminated',
            agentId,
            taskId: agentState?.taskNodeId || '',
            reason: event.status as 'completed' | 'failed' | 'cancelled',
          };
        }
        break;

      // Note: artifact events are handled separately if needed
    }

    if (streamEvent) {
      await this.cache.publishEvent(runId, streamEvent);
    }
  }

  // ===========================================================================
  // Cleanup
  // ===========================================================================

  /**
   * Cancel all agents for a run.
   */
  async cancelAllAgents(runId: string, reason: string): Promise<void> {
    const activeIds = await this.cache.getActiveAgents(runId);
    
    for (const agentId of activeIds) {
      await this.cancelAgent(agentId, reason);
    }
  }

  /**
   * Get count of in-memory agents (for debugging).
   */
  getInMemoryAgentCount(): number {
    return this.agents.size;
  }
}
