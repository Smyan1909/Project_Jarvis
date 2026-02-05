import { z } from 'zod';

// =============================================================================
// Memory Item
// =============================================================================

export const MemoryItemSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  content: z.string(),
  embedding: z.array(z.number()), // pgvector (1536 dimensions for OpenAI text-embedding-3-small)
  metadata: z.record(z.string(), z.unknown()),
  createdAt: z.date(),
});

export type MemoryItem = z.infer<typeof MemoryItemSchema>;

// =============================================================================
// Memory Search Result
// =============================================================================

export const MemorySearchResultSchema = z.object({
  id: z.string().uuid(),
  content: z.string(),
  metadata: z.record(z.string(), z.unknown()),
  similarity: z.number().min(0).max(1), // Cosine similarity score
  createdAt: z.date(),
});

export type MemorySearchResult = z.infer<typeof MemorySearchResultSchema>;
