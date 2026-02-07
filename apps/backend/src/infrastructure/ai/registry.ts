// =============================================================================
// AI Provider Registry
// =============================================================================
// Centralized provider configuration using Vercel AI SDK

import { createProviderRegistry } from 'ai';
import { openai } from '@ai-sdk/openai';
import { anthropic } from '@ai-sdk/anthropic';

/**
 * Provider registry with OpenAI and Anthropic
 *
 * Usage:
 *   registry.languageModel('openai:gpt-4o-mini')
 *   registry.languageModel('anthropic:claude-sonnet-4-20250514')
 *   registry.textEmbeddingModel('openai:text-embedding-3-small')
 */
export const registry = createProviderRegistry({
  openai,
  anthropic,
});

/**
 * Get a language model by ID
 * @param modelId - Model ID in format "provider:model" (e.g., "openai:gpt-4o-mini")
 * @returns LanguageModel instance
 */
export function getLanguageModel(modelId: string) {
  // Cast to template literal type for registry
  return registry.languageModel(modelId as `openai:${string}` | `anthropic:${string}`);
}

/**
 * Get an embedding model by ID
 * @param modelId - Model ID in format "provider:model" (e.g., "openai:text-embedding-3-small")
 * @returns EmbeddingModel instance
 */
export function getEmbeddingModel(modelId: string) {
  // Use textEmbeddingModel (the correct method name in AI SDK v4)
  return registry.textEmbeddingModel(modelId as `openai:${string}`);
}
