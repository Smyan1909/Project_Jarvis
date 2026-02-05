// =============================================================================
// Embedding Port
// =============================================================================

/**
 * Port interface for text embedding generation
 *
 * This port abstracts the generation of vector embeddings from text.
 * Embeddings are used for semantic search in memories and knowledge graphs.
 * Implementations may use OpenAI, local models, or other embedding providers.
 */
export interface EmbeddingPort {
  /**
   * Generate embedding for a single text
   *
   * @param text - The text to embed
   * @returns Vector embedding as an array of numbers
   */
  embed(text: string): Promise<number[]>;

  /**
   * Generate embeddings for multiple texts in a batch
   *
   * More efficient than calling embed() multiple times when you have
   * several texts to embed. Order of results matches order of inputs.
   *
   * @param texts - Array of texts to embed
   * @returns Array of embeddings in the same order as inputs
   */
  embedBatch(texts: string[]): Promise<number[][]>;

  /**
   * Get the dimension of embeddings produced by this provider
   *
   * This is important for configuring vector storage (e.g., pgvector columns).
   * Common dimensions:
   * - OpenAI text-embedding-3-small: 1536
   * - OpenAI text-embedding-3-large: 3072
   * - Local models vary
   *
   * @returns The number of dimensions in the embedding vectors
   */
  getDimension(): number;

  /**
   * Get the model identifier used for embeddings
   *
   * @returns The model name (e.g., "text-embedding-3-small")
   */
  getModel(): string;
}
