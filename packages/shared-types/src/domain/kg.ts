import { z } from 'zod';

// =============================================================================
// Knowledge Graph Entity
// =============================================================================

export const KGEntitySchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  type: z.string(), // 'person' | 'place' | 'organization' | 'concept' | 'event'
  name: z.string().min(1),
  properties: z.record(z.string(), z.unknown()),
  embedding: z.array(z.number()).nullable(), // Optional embedding for semantic search
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type KGEntity = z.infer<typeof KGEntitySchema>;

// =============================================================================
// Knowledge Graph Relation
// =============================================================================

export const KGRelationSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  sourceId: z.string().uuid(),
  targetId: z.string().uuid(),
  type: z.string(), // 'knows' | 'works_at' | 'located_in' | etc.
  properties: z.record(z.string(), z.unknown()),
  createdAt: z.date(),
});

export type KGRelation = z.infer<typeof KGRelationSchema>;

// =============================================================================
// Knowledge Graph Search Result
// =============================================================================

export const KGSearchResultSchema = z.object({
  entity: KGEntitySchema,
  relations: z.array(KGRelationSchema),
  relatedEntities: z.array(KGEntitySchema),
});

export type KGSearchResult = z.infer<typeof KGSearchResultSchema>;
