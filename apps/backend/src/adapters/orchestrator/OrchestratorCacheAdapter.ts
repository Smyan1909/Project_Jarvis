// =============================================================================
// Orchestrator Cache Adapter
// =============================================================================
// Redis adapter for hot state caching. Provides fast access to active
// orchestrator and sub-agent states during execution.

import type {
  OrchestratorState,
  SubAgentState,
  TaskPlan,
  StreamEvent,
} from '@project-jarvis/shared-types';

// =============================================================================
// Redis Client Interface
// =============================================================================
// Abstract interface for Redis operations. Implementations can use
// ioredis, redis, or any other Redis client.

export interface RedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options?: { ex?: number }): Promise<void>;
  del(key: string): Promise<void>;
  sadd(key: string, ...members: string[]): Promise<void>;
  srem(key: string, ...members: string[]): Promise<void>;
  smembers(key: string): Promise<string[]>;
  publish(channel: string, message: string): Promise<void>;
  subscribe(channel: string, callback: (message: string) => void): Promise<void>;
  unsubscribe(channel: string): Promise<void>;
  expire(key: string, seconds: number): Promise<void>;
  hincrby(key: string, field: string, increment: number): Promise<number>;
  hget(key: string, field: string): Promise<string | null>;
  hgetall(key: string): Promise<Record<string, string>>;
  hset(key: string, field: string, value: string): Promise<void>;
}

// =============================================================================
// Cache Configuration
// =============================================================================

export interface CacheConfig {
  /** TTL for orchestrator state in seconds (default: 1 hour) */
  orchestratorTTL: number;
  /** TTL for sub-agent state in seconds (default: 1 hour) */
  subAgentTTL: number;
  /** Key prefix for namespacing */
  keyPrefix: string;
}

const DEFAULT_CONFIG: CacheConfig = {
  orchestratorTTL: 3600,
  subAgentTTL: 3600,
  keyPrefix: 'jarvis:orchestrator',
};

// =============================================================================
// Cache Adapter Interface
// =============================================================================

export interface IOrchestratorCacheAdapter {
  // Orchestrator State
  setOrchestratorState(state: OrchestratorState): Promise<void>;
  getOrchestratorState(runId: string): Promise<OrchestratorState | null>;
  deleteOrchestratorState(runId: string): Promise<void>;

  // Sub-Agent State
  setSubAgentState(state: SubAgentState): Promise<void>;
  getSubAgentState(agentId: string): Promise<SubAgentState | null>;
  deleteSubAgentState(agentId: string): Promise<void>;

  // Active Agents Set
  addActiveAgent(runId: string, agentId: string): Promise<void>;
  removeActiveAgent(runId: string, agentId: string): Promise<void>;
  getActiveAgents(runId: string): Promise<string[]>;

  // Loop Detection
  incrementLoopCounter(runId: string, taskNodeId: string): Promise<number>;
  getLoopCounter(runId: string, taskNodeId: string): Promise<number>;
  incrementInterventions(runId: string): Promise<number>;
  getInterventions(runId: string): Promise<number>;

  // Event Streaming
  publishEvent(runId: string, event: StreamEvent): Promise<void>;
  subscribeToEvents(runId: string, callback: (event: StreamEvent) => void): Promise<void>;
  unsubscribeFromEvents(runId: string): Promise<void>;
}

// =============================================================================
// In-Memory Cache Implementation (for testing and MVP)
// =============================================================================

export class InMemoryOrchestratorCacheAdapter implements IOrchestratorCacheAdapter {
  private orchestratorStates: Map<string, OrchestratorState> = new Map();
  private subAgentStates: Map<string, SubAgentState> = new Map();
  private activeAgents: Map<string, Set<string>> = new Map();
  private loopCounters: Map<string, Map<string, number>> = new Map();
  private interventions: Map<string, number> = new Map();
  private eventSubscribers: Map<string, Set<(event: StreamEvent) => void>> = new Map();

  // Orchestrator State
  async setOrchestratorState(state: OrchestratorState): Promise<void> {
    this.orchestratorStates.set(state.runId, state);
  }

  async getOrchestratorState(runId: string): Promise<OrchestratorState | null> {
    return this.orchestratorStates.get(runId) || null;
  }

  async deleteOrchestratorState(runId: string): Promise<void> {
    this.orchestratorStates.delete(runId);
  }

  // Sub-Agent State
  async setSubAgentState(state: SubAgentState): Promise<void> {
    this.subAgentStates.set(state.id, state);
  }

  async getSubAgentState(agentId: string): Promise<SubAgentState | null> {
    return this.subAgentStates.get(agentId) || null;
  }

  async deleteSubAgentState(agentId: string): Promise<void> {
    this.subAgentStates.delete(agentId);
  }

  // Active Agents Set
  async addActiveAgent(runId: string, agentId: string): Promise<void> {
    if (!this.activeAgents.has(runId)) {
      this.activeAgents.set(runId, new Set());
    }
    this.activeAgents.get(runId)!.add(agentId);
  }

  async removeActiveAgent(runId: string, agentId: string): Promise<void> {
    this.activeAgents.get(runId)?.delete(agentId);
  }

  async getActiveAgents(runId: string): Promise<string[]> {
    return Array.from(this.activeAgents.get(runId) || []);
  }

  // Loop Detection
  async incrementLoopCounter(runId: string, taskNodeId: string): Promise<number> {
    if (!this.loopCounters.has(runId)) {
      this.loopCounters.set(runId, new Map());
    }
    const counters = this.loopCounters.get(runId)!;
    const current = counters.get(taskNodeId) || 0;
    counters.set(taskNodeId, current + 1);
    return current + 1;
  }

  async getLoopCounter(runId: string, taskNodeId: string): Promise<number> {
    return this.loopCounters.get(runId)?.get(taskNodeId) || 0;
  }

  async incrementInterventions(runId: string): Promise<number> {
    const current = this.interventions.get(runId) || 0;
    this.interventions.set(runId, current + 1);
    return current + 1;
  }

  async getInterventions(runId: string): Promise<number> {
    return this.interventions.get(runId) || 0;
  }

  // Event Streaming
  async publishEvent(runId: string, event: StreamEvent): Promise<void> {
    const subscribers = this.eventSubscribers.get(runId);
    if (subscribers) {
      for (const callback of subscribers) {
        try {
          callback(event);
        } catch (error) {
          console.error('Error in event subscriber:', error);
        }
      }
    }
  }

  async subscribeToEvents(runId: string, callback: (event: StreamEvent) => void): Promise<void> {
    if (!this.eventSubscribers.has(runId)) {
      this.eventSubscribers.set(runId, new Set());
    }
    this.eventSubscribers.get(runId)!.add(callback);
  }

  async unsubscribeFromEvents(runId: string): Promise<void> {
    this.eventSubscribers.delete(runId);
  }

  // Utility: Clear all data (for testing)
  clear(): void {
    this.orchestratorStates.clear();
    this.subAgentStates.clear();
    this.activeAgents.clear();
    this.loopCounters.clear();
    this.interventions.clear();
    this.eventSubscribers.clear();
  }
}

// =============================================================================
// Redis Cache Implementation
// =============================================================================

export class RedisOrchestratorCacheAdapter implements IOrchestratorCacheAdapter {
  private config: CacheConfig;

  constructor(
    private redis: RedisClient,
    config: Partial<CacheConfig> = {}
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  private key(type: string, id: string): string {
    return `${this.config.keyPrefix}:${type}:${id}`;
  }

  // Orchestrator State
  async setOrchestratorState(state: OrchestratorState): Promise<void> {
    const key = this.key('state', state.runId);
    await this.redis.set(key, JSON.stringify(state), { ex: this.config.orchestratorTTL });
  }

  async getOrchestratorState(runId: string): Promise<OrchestratorState | null> {
    const key = this.key('state', runId);
    const data = await this.redis.get(key);
    if (!data) return null;
    
    const state = JSON.parse(data) as OrchestratorState;
    // Restore Date objects
    state.startedAt = new Date(state.startedAt);
    if (state.completedAt) state.completedAt = new Date(state.completedAt);
    return state;
  }

  async deleteOrchestratorState(runId: string): Promise<void> {
    await this.redis.del(this.key('state', runId));
  }

  // Sub-Agent State
  async setSubAgentState(state: SubAgentState): Promise<void> {
    const key = this.key('agent', state.id);
    await this.redis.set(key, JSON.stringify(state), { ex: this.config.subAgentTTL });
  }

  async getSubAgentState(agentId: string): Promise<SubAgentState | null> {
    const key = this.key('agent', agentId);
    const data = await this.redis.get(key);
    if (!data) return null;
    
    const state = JSON.parse(data) as SubAgentState;
    // Restore Date objects
    state.startedAt = new Date(state.startedAt);
    if (state.completedAt) state.completedAt = new Date(state.completedAt);
    return state;
  }

  async deleteSubAgentState(agentId: string): Promise<void> {
    await this.redis.del(this.key('agent', agentId));
  }

  // Active Agents Set
  async addActiveAgent(runId: string, agentId: string): Promise<void> {
    const key = this.key('active', runId);
    await this.redis.sadd(key, agentId);
    await this.redis.expire(key, this.config.orchestratorTTL);
  }

  async removeActiveAgent(runId: string, agentId: string): Promise<void> {
    const key = this.key('active', runId);
    await this.redis.srem(key, agentId);
  }

  async getActiveAgents(runId: string): Promise<string[]> {
    const key = this.key('active', runId);
    return this.redis.smembers(key);
  }

  // Loop Detection
  async incrementLoopCounter(runId: string, taskNodeId: string): Promise<number> {
    const key = this.key('loops', runId);
    const count = await this.redis.hincrby(key, taskNodeId, 1);
    await this.redis.expire(key, this.config.orchestratorTTL);
    return count;
  }

  async getLoopCounter(runId: string, taskNodeId: string): Promise<number> {
    const key = this.key('loops', runId);
    const count = await this.redis.hget(key, taskNodeId);
    return count ? parseInt(count, 10) : 0;
  }

  async incrementInterventions(runId: string): Promise<number> {
    const key = this.key('interventions', runId);
    const count = await this.redis.hincrby(key, 'count', 1);
    await this.redis.expire(key, this.config.orchestratorTTL);
    return count;
  }

  async getInterventions(runId: string): Promise<number> {
    const key = this.key('interventions', runId);
    const count = await this.redis.hget(key, 'count');
    return count ? parseInt(count, 10) : 0;
  }

  // Event Streaming
  async publishEvent(runId: string, event: StreamEvent): Promise<void> {
    const channel = this.key('events', runId);
    await this.redis.publish(channel, JSON.stringify(event));
  }

  async subscribeToEvents(runId: string, callback: (event: StreamEvent) => void): Promise<void> {
    const channel = this.key('events', runId);
    await this.redis.subscribe(channel, (message) => {
      try {
        const event = JSON.parse(message) as StreamEvent;
        callback(event);
      } catch (error) {
        console.error('Error parsing event:', error);
      }
    });
  }

  async unsubscribeFromEvents(runId: string): Promise<void> {
    const channel = this.key('events', runId);
    await this.redis.unsubscribe(channel);
  }
}
