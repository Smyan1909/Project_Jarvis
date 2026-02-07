// =============================================================================
// AI Model Configuration
// =============================================================================

/**
 * Default models for different use cases
 */
export const DEFAULT_MODELS = {
  /** Fast, cost-effective model for simple tasks */
  chat: 'openai:gpt-5-mini',
  /** Powerful model for complex reasoning */
  powerful: 'openai:gpt-5.2',
  /** Fast Anthropic model */
  fast: 'openai:gpt-5-nano',
  /** Default embedding model */
  embedding: 'openai:text-embedding-3-small',
} as const;

/**
 * Model pricing per 1M tokens [input, output] in USD
 * Updated as of 2025
 */
export const MODEL_PRICING: Record<string, [number, number]> = {
  // OpenAI models
  'gpt-4o-mini': [0.15, 0.60],
  'gpt-4o': [2.50, 10.00],
  'gpt-4-turbo': [10.00, 30.00],
  'gpt-4.1': [2.00, 8.00],
  'gpt-4.1-mini': [0.40, 1.60],
  'gpt-4.1-nano': [0.10, 0.40],
  // Anthropic models
  'claude-sonnet-4-20250514': [3.00, 15.00],
  'claude-haiku-3-5-20241022': [0.80, 4.00],
  'claude-opus-4-20250514': [15.00, 75.00],
};

/**
 * Embedding model dimensions
 */
export const EMBEDDING_DIMENSIONS: Record<string, number> = {
  'text-embedding-3-small': 1536,
  'text-embedding-3-large': 3072,
  'text-embedding-ada-002': 1536,
};

/**
 * Model categories for routing
 */
export type ModelCategory = 'fast' | 'balanced' | 'powerful';

/**
 * Category to model mapping for LLM router
 */
export const CATEGORY_MODEL_MAP: Record<ModelCategory, string> = {
  fast: 'openai:gpt-4o-mini',
  balanced: 'openai:gpt-4o',
  powerful: 'anthropic:claude-sonnet-4-20250514',
};

/**
 * Calculate cost for token usage
 * @param modelId - The model ID (with or without provider prefix)
 * @param promptTokens - Number of input tokens
 * @param completionTokens - Number of output tokens
 * @returns Cost in USD
 */
export function calculateModelCost(
  modelId: string,
  promptTokens: number,
  completionTokens: number
): number {
  // Extract model name from "provider:model" format
  const modelName = modelId.includes(':') ? modelId.split(':')[1] : modelId;

  const pricing = MODEL_PRICING[modelName];
  if (!pricing) return 0;

  const [inputPrice, outputPrice] = pricing;
  return (promptTokens * inputPrice + completionTokens * outputPrice) / 1_000_000;
}

/**
 * Get embedding dimension for a model
 * @param modelId - The model ID (with or without provider prefix)
 * @returns Dimension count, defaults to 1536
 */
export function getEmbeddingDimension(modelId: string): number {
  const modelName = modelId.includes(':') ? modelId.split(':')[1] : modelId;
  return EMBEDDING_DIMENSIONS[modelName] ?? 1536;
}
