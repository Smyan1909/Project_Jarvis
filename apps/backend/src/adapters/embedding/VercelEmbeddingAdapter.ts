// =============================================================================
// Vercel Embedding Adapter
// =============================================================================
// Implements EmbeddingPort using the Vercel AI SDK

import { embed, embedMany } from 'ai';
import type { EmbeddingPort } from '../../ports/EmbeddingPort.js';
import { getEmbeddingModel } from '../../infrastructure/ai/registry.js';
import { getEmbeddingDimension, DEFAULT_MODELS } from '../../infrastructure/ai/config.js';

/**
 * Embedding adapter using Vercel AI SDK
 *
 * Wraps the AI SDK's embed and embedMany functions to implement
 * the EmbeddingPort interface for semantic search operations.
 *
 * @example
 * ```typescript
 * const adapter = new VercelEmbeddingAdapter();
 * const embedding = await adapter.embed('Hello, world!');
 * console.log(embedding.length); // 1536 for text-embedding-3-small
 * ```
 */
export class VercelEmbeddingAdapter implements EmbeddingPort {
  private modelId: string;

  /**
   * Create a new Vercel embedding adapter
   * @param modelId - Model ID in format "provider:model" (defaults to OpenAI text-embedding-3-small)
   */
  constructor(modelId: string = DEFAULT_MODELS.embedding) {
    this.modelId = modelId;
  }

  /**
   * Generate embedding for a single text
   */
  async embed(text: string): Promise<number[]> {
    const { embedding } = await embed({
      model: getEmbeddingModel(this.modelId),
      value: text,
    });
    return embedding;
  }

  /**
   * Generate embeddings for multiple texts in a batch
   *
   * More efficient than calling embed() multiple times when you have
   * several texts to embed. Order of results matches order of inputs.
   */
  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }

    const { embeddings } = await embedMany({
      model: getEmbeddingModel(this.modelId),
      values: texts,
    });
    return embeddings;
  }

  /**
   * Get the dimension of embeddings produced by this provider
   *
   * This is important for configuring vector storage (e.g., pgvector columns).
   */
  getDimension(): number {
    return getEmbeddingDimension(this.modelId);
  }

  /**
   * Get the model identifier used for embeddings
   */
  getModel(): string {
    return this.modelId;
  }
}
