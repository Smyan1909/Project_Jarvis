import type { KGEntity, KGRelation, KGSearchResult } from '@project-jarvis/shared-types';

// =============================================================================
// Knowledge Graph Port
// =============================================================================

/**
 * Port interface for knowledge graph operations
 *
 * This port abstracts the storage and querying of entities and their
 * relationships. The knowledge graph enables structured reasoning about
 * people, places, organizations, concepts, and their connections.
 */
export interface KnowledgeGraphPort {
  /**
   * Create an entity in the knowledge graph
   *
   * Entities represent things like people, places, organizations, or concepts.
   * The entity will be automatically embedded for semantic search.
   *
   * @param userId - The user who owns this entity
   * @param type - Entity type (e.g., 'person', 'place', 'organization', 'concept', 'event')
   * @param name - Human-readable name for the entity
   * @param properties - Optional additional properties
   * @returns The created entity with ID and embedding
   */
  createEntity(
    userId: string,
    type: string,
    name: string,
    properties?: Record<string, unknown>
  ): Promise<KGEntity>;

  /**
   * Create a relation between two entities
   *
   * Relations represent connections like "knows", "works_at", "located_in".
   * Both source and target entities must exist and belong to the user.
   *
   * @param userId - The user who owns these entities
   * @param sourceId - ID of the source entity
   * @param targetId - ID of the target entity
   * @param type - Relation type (e.g., 'knows', 'works_at', 'located_in')
   * @param properties - Optional additional properties for the relation
   * @returns The created relation
   */
  createRelation(
    userId: string,
    sourceId: string,
    targetId: string,
    type: string,
    properties?: Record<string, unknown>
  ): Promise<KGRelation>;

  /**
   * Search entities by semantic similarity
   *
   * Uses vector similarity to find entities matching the query.
   * Can optionally filter by entity type.
   *
   * @param userId - The user whose entities to search
   * @param query - Natural language search query
   * @param type - Optional entity type filter
   * @param limit - Maximum number of results (default: 10)
   * @returns Array of matching entities
   */
  searchEntities(userId: string, query: string, type?: string, limit?: number): Promise<KGEntity[]>;

  /**
   * Get an entity with its relations and related entities
   *
   * Retrieves the full context of an entity including its connections.
   * The depth parameter controls how many hops to traverse.
   *
   * @param userId - The user who owns the entity
   * @param entityId - The ID of the entity to retrieve
   * @param depth - How many relation hops to include (default: 1)
   * @returns The entity with relations and related entities, or null if not found
   */
  getEntityWithRelations(
    userId: string,
    entityId: string,
    depth?: number
  ): Promise<KGSearchResult | null>;

  /**
   * Query the knowledge graph with natural language
   *
   * Performs a semantic search and returns entities with their contexts.
   * Useful for answering questions about relationships.
   *
   * @param userId - The user whose graph to query
   * @param query - Natural language query about entities or relationships
   * @returns Array of search results with entities and their relations
   */
  query(userId: string, query: string): Promise<KGSearchResult[]>;

  /**
   * Update an entity's properties
   *
   * @param userId - The user who owns the entity
   * @param entityId - The ID of the entity to update
   * @param properties - Properties to merge with existing properties
   * @returns The updated entity
   */
  updateEntity(
    userId: string,
    entityId: string,
    properties: Record<string, unknown>
  ): Promise<KGEntity>;

  /**
   * Delete an entity and its relations
   *
   * Removes the entity and all relations where it is source or target.
   *
   * @param userId - The user who owns the entity
   * @param entityId - The ID of the entity to delete
   */
  deleteEntity(userId: string, entityId: string): Promise<void>;

  /**
   * Delete a relation
   *
   * @param userId - The user who owns the relation
   * @param relationId - The ID of the relation to delete
   */
  deleteRelation(userId: string, relationId: string): Promise<void>;
}
