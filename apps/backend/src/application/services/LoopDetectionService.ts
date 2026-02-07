// =============================================================================
// Loop Detection Service
// =============================================================================
// Prevents infinite loops and runaway agent execution by tracking:
// 1. Retry counts per task node
// 2. Total intervention count per orchestrator run
// Uses conservative limits to prevent excessive cost accumulation.

import type { LoopDetectionConfig, DEFAULT_LOOP_DETECTION_CONFIG } from '@project-jarvis/shared-types';
import type { IOrchestratorCacheAdapter } from '../../adapters/orchestrator/OrchestratorCacheAdapter.js';
import type { IOrchestratorStateRepository } from '../../adapters/orchestrator/OrchestratorStateRepository.js';

// =============================================================================
// Loop Detection Result
// =============================================================================

export interface LoopDetectionResult {
  /** Whether the action is allowed */
  allowed: boolean;
  /** Current count (retries or interventions) */
  currentCount: number;
  /** Maximum allowed count */
  maxCount: number;
  /** Reason if not allowed */
  reason?: string;
}

// =============================================================================
// Loop Detection Service
// =============================================================================

export class LoopDetectionService {
  private config: LoopDetectionConfig;

  constructor(
    private cache: IOrchestratorCacheAdapter,
    private repository: IOrchestratorStateRepository,
    config?: Partial<LoopDetectionConfig>
  ) {
    this.config = {
      maxRetriesPerTask: config?.maxRetriesPerTask ?? 3,
      maxTotalInterventions: config?.maxTotalInterventions ?? 10,
    };
  }

  // ===========================================================================
  // Task Retry Detection
  // ===========================================================================

  /**
   * Check if a task can be retried.
   * Call this before attempting to retry a failed task.
   */
  async canRetryTask(runId: string, taskNodeId: string): Promise<LoopDetectionResult> {
    const currentCount = await this.cache.getLoopCounter(runId, taskNodeId);
    
    if (currentCount >= this.config.maxRetriesPerTask) {
      return {
        allowed: false,
        currentCount,
        maxCount: this.config.maxRetriesPerTask,
        reason: `Task has reached maximum retry limit (${this.config.maxRetriesPerTask}). Consider modifying the plan or using a different approach.`,
      };
    }

    return {
      allowed: true,
      currentCount,
      maxCount: this.config.maxRetriesPerTask,
    };
  }

  /**
   * Record a task retry attempt.
   * Call this when actually retrying a task.
   * Returns the new count and whether this is the last allowed retry.
   */
  async recordTaskRetry(runId: string, taskNodeId: string): Promise<{
    newCount: number;
    isLastRetry: boolean;
    maxRetries: number;
  }> {
    // Increment in cache (for fast access)
    const cacheCount = await this.cache.incrementLoopCounter(runId, taskNodeId);
    
    // Also persist to repository (for durability)
    await this.repository.incrementRetryCount(taskNodeId);
    
    return {
      newCount: cacheCount,
      isLastRetry: cacheCount >= this.config.maxRetriesPerTask,
      maxRetries: this.config.maxRetriesPerTask,
    };
  }

  /**
   * Get the current retry count for a task.
   */
  async getTaskRetryCount(runId: string, taskNodeId: string): Promise<number> {
    return this.cache.getLoopCounter(runId, taskNodeId);
  }

  // ===========================================================================
  // Intervention Detection
  // ===========================================================================

  /**
   * Check if an intervention is allowed.
   * Call this before the orchestrator intervenes in a sub-agent.
   */
  async canIntervene(runId: string): Promise<LoopDetectionResult> {
    const currentCount = await this.cache.getInterventions(runId);
    
    if (currentCount >= this.config.maxTotalInterventions) {
      return {
        allowed: false,
        currentCount,
        maxCount: this.config.maxTotalInterventions,
        reason: `Run has reached maximum intervention limit (${this.config.maxTotalInterventions}). This may indicate a fundamental issue with the task or approach.`,
      };
    }

    return {
      allowed: true,
      currentCount,
      maxCount: this.config.maxTotalInterventions,
    };
  }

  /**
   * Record an intervention.
   * Call this when the orchestrator actually intervenes in a sub-agent.
   * Returns the new count and whether we're approaching the limit.
   */
  async recordIntervention(runId: string): Promise<{
    newCount: number;
    isNearLimit: boolean;
    isAtLimit: boolean;
    maxInterventions: number;
  }> {
    // Increment in cache
    const cacheCount = await this.cache.incrementInterventions(runId);
    
    // Also persist to repository
    await this.repository.incrementInterventions(runId);
    
    // Consider "near limit" as 80% of max
    const nearLimitThreshold = Math.floor(this.config.maxTotalInterventions * 0.8);
    
    return {
      newCount: cacheCount,
      isNearLimit: cacheCount >= nearLimitThreshold,
      isAtLimit: cacheCount >= this.config.maxTotalInterventions,
      maxInterventions: this.config.maxTotalInterventions,
    };
  }

  /**
   * Get the current intervention count.
   */
  async getInterventionCount(runId: string): Promise<number> {
    return this.cache.getInterventions(runId);
  }

  // ===========================================================================
  // Combined Health Check
  // ===========================================================================

  /**
   * Get the overall loop detection health for a run.
   * Useful for monitoring and debugging.
   */
  async getRunHealth(runId: string, taskNodeIds: string[]): Promise<{
    interventions: { count: number; max: number; percentage: number };
    tasks: Array<{ taskNodeId: string; retries: number; max: number; percentage: number }>;
    overallHealthy: boolean;
    warnings: string[];
  }> {
    const interventionCount = await this.getInterventionCount(runId);
    const interventionPercentage = (interventionCount / this.config.maxTotalInterventions) * 100;

    const tasks: Array<{ taskNodeId: string; retries: number; max: number; percentage: number }> = [];
    const warnings: string[] = [];

    for (const taskNodeId of taskNodeIds) {
      const retries = await this.getTaskRetryCount(runId, taskNodeId);
      const percentage = (retries / this.config.maxRetriesPerTask) * 100;
      tasks.push({
        taskNodeId,
        retries,
        max: this.config.maxRetriesPerTask,
        percentage,
      });

      if (percentage >= 66) {
        warnings.push(`Task ${taskNodeId} has used ${retries}/${this.config.maxRetriesPerTask} retries`);
      }
    }

    if (interventionPercentage >= 80) {
      warnings.push(`Run has used ${interventionCount}/${this.config.maxTotalInterventions} interventions`);
    }

    const overallHealthy = interventionPercentage < 80 && !tasks.some(t => t.percentage >= 100);

    return {
      interventions: {
        count: interventionCount,
        max: this.config.maxTotalInterventions,
        percentage: interventionPercentage,
      },
      tasks,
      overallHealthy,
      warnings,
    };
  }

  // ===========================================================================
  // Configuration
  // ===========================================================================

  /**
   * Get the current configuration.
   */
  getConfig(): LoopDetectionConfig {
    return { ...this.config };
  }

  /**
   * Update configuration (useful for testing or per-run adjustments).
   */
  updateConfig(newConfig: Partial<LoopDetectionConfig>): void {
    if (newConfig.maxRetriesPerTask !== undefined) {
      this.config.maxRetriesPerTask = newConfig.maxRetriesPerTask;
    }
    if (newConfig.maxTotalInterventions !== undefined) {
      this.config.maxTotalInterventions = newConfig.maxTotalInterventions;
    }
  }
}
