// =============================================================================
// LLM Router Service
// =============================================================================
// Provides model selection and routing based on task category

import type { LLMProviderPort } from '../../ports/LLMProviderPort.js';
import { VercelAIAdapter } from '../../adapters/llm/VercelAIAdapter.js';
import {
  CATEGORY_MODEL_MAP,
  DEFAULT_MODELS,
  type ModelCategory,
} from '../../infrastructure/ai/config.js';

/**
 * LLM Router Service
 *
 * Provides a centralized way to get LLM providers based on:
 * - Category (fast, balanced, powerful)
 * - Specific model ID
 *
 * Caches adapter instances for efficiency.
 *
 * @example
 * ```typescript
 * // Get by category
 * const provider = llmRouter.getProvider('fast');
 *
 * // Get by specific model
 * const provider = llmRouter.getProviderByModel('anthropic:claude-sonnet-4-20250514');
 *
 * // Use the provider
 * const response = await provider.generate([{ role: 'user', content: 'Hello!' }]);
 * ```
 */
export class LLMRouterService {
  private adapters: Map<string, LLMProviderPort> = new Map();

  /**
   * Get a provider by category
   *
   * Categories:
   * - `fast`: Quick, cost-effective (gpt-4o-mini)
   * - `balanced`: Good performance/cost ratio (gpt-4o)
   * - `powerful`: Best quality, higher cost (claude-sonnet)
   *
   * @param category - The model category
   * @returns LLMProviderPort instance
   */
  getProvider(category: ModelCategory = 'balanced'): LLMProviderPort {
    const modelId = CATEGORY_MODEL_MAP[category];
    return this.getProviderByModel(modelId);
  }

  /**
   * Get a provider by specific model ID
   *
   * @param modelId - Model ID in format "provider:model"
   * @returns LLMProviderPort instance
   */
  getProviderByModel(modelId: string): LLMProviderPort {
    if (!this.adapters.has(modelId)) {
      this.adapters.set(modelId, new VercelAIAdapter(modelId));
    }
    return this.adapters.get(modelId)!;
  }

  /**
   * Get the default chat provider
   *
   * @returns LLMProviderPort instance for default chat model
   */
  getDefaultProvider(): LLMProviderPort {
    return this.getProviderByModel(DEFAULT_MODELS.chat);
  }

  /**
   * Get a powerful provider for complex reasoning tasks
   *
   * @returns LLMProviderPort instance for powerful model
   */
  getPowerfulProvider(): LLMProviderPort {
    return this.getProviderByModel(DEFAULT_MODELS.powerful);
  }

  /**
   * Clear the adapter cache
   *
   * Useful for testing or when you need to reset provider state
   */
  clearCache(): void {
    this.adapters.clear();
  }
}

/**
 * Singleton instance of the LLM Router Service
 *
 * Use this for most cases to benefit from adapter caching.
 */
export const llmRouter = new LLMRouterService();
