import { z } from 'zod';

// =============================================================================
// Knowledge Graph Entity Types
// =============================================================================

/**
 * Standard entity types for the knowledge graph
 *
 * Base types:
 * - person, place, organization, concept, event
 *
 * Session continuity types:
 * - coding_session: Represents a single conversation/run with the agent
 * - file_change: Tracks a file modification during a session
 * - decision: Architectural or implementation decision made during a session
 * - todo: Task to complete in future sessions
 */
export const KGEntityTypeSchema = z.enum([
  // Base types
  'person',
  'place',
  'organization',
  'concept',
  'event',
  // Session continuity types
  'coding_session',
  'file_change',
  'decision',
  'todo',
]);

export type KGEntityType = z.infer<typeof KGEntityTypeSchema>;

// =============================================================================
// Knowledge Graph Relation Types
// =============================================================================

/**
 * Standard relation types for the knowledge graph
 *
 * Base types:
 * - knows, works_at, located_in, owns, member_of, parent_of
 *
 * Session continuity types:
 * - modified_during: Links file_change to coding_session
 * - decided_during: Links decision to coding_session
 * - continues_from: Links coding_session to previous coding_session
 * - related_to_file: Links decision/todo to file_change
 * - synced_from_github: Links any entity to a GitHub issue/PR reference
 */
export const KGRelationTypeSchema = z.enum([
  // Base types
  'knows',
  'works_at',
  'located_in',
  'owns',
  'member_of',
  'parent_of',
  // Session continuity types
  'modified_during',
  'decided_during',
  'continues_from',
  'related_to_file',
  'synced_from_github',
]);

export type KGRelationType = z.infer<typeof KGRelationTypeSchema>;

// =============================================================================
// Knowledge Graph Entity
// =============================================================================

export const KGEntitySchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  type: z.string(), // Use KGEntityType values, but allow custom types
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
