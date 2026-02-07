// =============================================================================
// PostgreSQL Knowledge Graph Adapter
// =============================================================================
// Implements KnowledgeGraphPort using PostgreSQL with pgvector for semantic search.
// Combines KGEntityRepository and KGRelationRepository for storage with
// EmbeddingPort for vector generation.

import type { KGEntity, KGRelation, KGSearchResult } from '@project-jarvis/shared-types';
import type { KnowledgeGraphPort } from '../../ports/KnowledgeGraphPort.js';
import type { EmbeddingPort } from '../../ports/EmbeddingPort.js';
import { KGEntityRepository } from '../storage/kg-entity-repository.js';
import { KGRelationRepository } from '../storage/kg-relation-repository.js';
import { logger } from '../../infrastructure/logging/logger.js';

/**
 * PostgreSQL implementation of KnowledgeGraphPort
 *
 * Features:
 * - User-scoped entities and relations
 * - Semantic similarity search using pgvector with HNSW indexing
 * - Graph traversal with configurable depth
 * - Automatic embedding generation for entities
 *
 * This adapter combines:
 * - KGEntityRepository: Low-level entity storage
 * - KGRelationRepository: Low-level relation storage
 * - EmbeddingPort: Vector embedding generation
 */
export class PgKnowledgeGraph implements KnowledgeGraphPort {
  constructor(
    private entityRepository: KGEntityRepository,
    private relationRepository: KGRelationRepository,
    private embedding: EmbeddingPort
  ) {}

  /**
   * Create an entity in the knowledge graph
   *
   * Entities represent things like people, places, organizations, or concepts.
   * The entity will be automatically embedded for semantic search.
   */
  async createEntity(
    userId: string,
    type: string,
    name: string,
    properties?: Record<string, unknown>
  ): Promise<KGEntity> {
    const log = logger.child({ userId, operation: 'kg.createEntity' });

    // Generate embedding for semantic search
    // Combine type, name, and properties for richer embedding
    const embeddingText = this.createEmbeddingText(type, name, properties);
    const embeddingVector = await this.embedding.embed(embeddingText);

    // Store in database
    const entity = await this.entityRepository.create({
      userId,
      type,
      name,
      properties: properties || {},
      embedding: embeddingVector,
    });

    log.info('Entity created', { entityId: entity.id, type, name });

    return {
      id: entity.id,
      userId: entity.userId,
      type: entity.type,
      name: entity.name,
      properties: entity.properties,
      embedding: entity.embedding,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };
  }

  /**
   * Create a relation between two entities
   *
   * Relations represent connections like "knows", "works_at", "located_in".
   * Both source and target entities must exist and belong to the user.
   */
  async createRelation(
    userId: string,
    sourceId: string,
    targetId: string,
    type: string,
    properties?: Record<string, unknown>
  ): Promise<KGRelation> {
    const log = logger.child({ userId, operation: 'kg.createRelation' });

    // Verify both entities exist and belong to user
    const sourceEntity = await this.entityRepository.findById(userId, sourceId);
    const targetEntity = await this.entityRepository.findById(userId, targetId);

    if (!sourceEntity) {
      throw new Error(`Source entity ${sourceId} not found`);
    }
    if (!targetEntity) {
      throw new Error(`Target entity ${targetId} not found`);
    }

    // Create the relation
    const relation = await this.relationRepository.create({
      userId,
      sourceId,
      targetId,
      type,
      properties: properties || {},
    });

    log.info('Relation created', {
      relationId: relation.id,
      type,
      source: sourceEntity.name,
      target: targetEntity.name,
    });

    return {
      id: relation.id,
      userId: relation.userId,
      sourceId: relation.sourceId,
      targetId: relation.targetId,
      type: relation.type,
      properties: relation.properties,
      createdAt: relation.createdAt,
    };
  }

  /**
   * Search entities by semantic similarity
   *
   * Uses vector similarity to find entities matching the query.
   * Can optionally filter by entity type.
   */
  async searchEntities(
    userId: string,
    query: string,
    type?: string,
    limit: number = 10
  ): Promise<KGEntity[]> {
    const log = logger.child({ userId, operation: 'kg.searchEntities' });

    // Generate embedding for the query
    const queryEmbedding = await this.embedding.embed(query);

    // Search using pgvector similarity
    const results = await this.entityRepository.searchSimilar(
      userId,
      queryEmbedding,
      type,
      limit
    );

    log.debug('Entity search completed', {
      query: query.slice(0, 50),
      type: type || 'all',
      resultsReturned: results.length,
    });

    return results.map((entity) => ({
      id: entity.id,
      userId: entity.userId,
      type: entity.type,
      name: entity.name,
      properties: entity.properties,
      embedding: entity.embedding,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    }));
  }

  /**
   * Get an entity with its relations and related entities
   *
   * Retrieves the full context of an entity including its connections.
   * The depth parameter controls how many hops to traverse.
   */
  async getEntityWithRelations(
    userId: string,
    entityId: string,
    depth: number = 1
  ): Promise<KGSearchResult | null> {
    // Get the main entity
    const entity = await this.entityRepository.findById(userId, entityId);
    if (!entity) {
      return null;
    }

    // Get relations and related entities using BFS
    const { relations, relatedEntities } = await this.traverseGraph(
      userId,
      entityId,
      depth
    );

    return {
      entity: {
        id: entity.id,
        userId: entity.userId,
        type: entity.type,
        name: entity.name,
        properties: entity.properties,
        embedding: entity.embedding,
        createdAt: entity.createdAt,
        updatedAt: entity.updatedAt,
      },
      relations: relations.map((r) => ({
        id: r.id,
        userId: r.userId,
        sourceId: r.sourceId,
        targetId: r.targetId,
        type: r.type,
        properties: r.properties,
        createdAt: r.createdAt,
      })),
      relatedEntities: relatedEntities.map((e) => ({
        id: e.id,
        userId: e.userId,
        type: e.type,
        name: e.name,
        properties: e.properties,
        embedding: e.embedding,
        createdAt: e.createdAt,
        updatedAt: e.updatedAt,
      })),
    };
  }

  /**
   * Query the knowledge graph with natural language
   *
   * Performs a semantic search and returns entities with their contexts.
   * Useful for answering questions about relationships.
   */
  async query(userId: string, query: string): Promise<KGSearchResult[]> {
    // First, find relevant entities
    const entities = await this.searchEntities(userId, query, undefined, 5);

    // Then get their relations
    const results: KGSearchResult[] = [];
    for (const entity of entities) {
      const result = await this.getEntityWithRelations(userId, entity.id, 1);
      if (result) {
        results.push(result);
      }
    }

    return results;
  }

  /**
   * Update an entity's properties
   *
   * Merges new properties with existing properties.
   * Does NOT re-embed the entity (call updateEntityWithReembed for that).
   */
  async updateEntity(
    userId: string,
    entityId: string,
    properties: Record<string, unknown>
  ): Promise<KGEntity> {
    const log = logger.child({ userId, entityId, operation: 'kg.updateEntity' });

    const updated = await this.entityRepository.mergeProperties(userId, entityId, properties);

    if (!updated) {
      throw new Error(`Entity ${entityId} not found for user ${userId}`);
    }

    log.info('Entity updated', { entityId });

    return {
      id: updated.id,
      userId: updated.userId,
      type: updated.type,
      name: updated.name,
      properties: updated.properties,
      embedding: updated.embedding,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    };
  }

  /**
   * Delete an entity and its relations
   *
   * Removes the entity and all relations where it is source or target.
   * Relations are automatically deleted via FK cascade.
   */
  async deleteEntity(userId: string, entityId: string): Promise<void> {
    const log = logger.child({ userId, entityId, operation: 'kg.deleteEntity' });

    const deleted = await this.entityRepository.delete(userId, entityId);

    if (!deleted) {
      throw new Error(`Entity ${entityId} not found for user ${userId}`);
    }

    log.info('Entity deleted');
  }

  /**
   * Delete a relation
   */
  async deleteRelation(userId: string, relationId: string): Promise<void> {
    const log = logger.child({ userId, relationId, operation: 'kg.deleteRelation' });

    const deleted = await this.relationRepository.delete(userId, relationId);

    if (!deleted) {
      throw new Error(`Relation ${relationId} not found for user ${userId}`);
    }

    log.info('Relation deleted');
  }

  // =========================================================================
  // Extended methods (not in port interface)
  // =========================================================================

  /**
   * Update entity with re-embedding
   *
   * Use this when the entity's name or type changes significantly.
   */
  async updateEntityWithReembed(
    userId: string,
    entityId: string,
    updates: { name?: string; type?: string; properties?: Record<string, unknown> }
  ): Promise<KGEntity> {
    const log = logger.child({ userId, entityId, operation: 'kg.updateEntityWithReembed' });

    // Get existing entity
    const existing = await this.entityRepository.findById(userId, entityId);
    if (!existing) {
      throw new Error(`Entity ${entityId} not found for user ${userId}`);
    }

    const newType = updates.type || existing.type;
    const newName = updates.name || existing.name;
    const newProperties = updates.properties
      ? { ...existing.properties, ...updates.properties }
      : existing.properties;

    // Generate new embedding
    const embeddingText = this.createEmbeddingText(newType, newName, newProperties);
    const embeddingVector = await this.embedding.embed(embeddingText);

    const updated = await this.entityRepository.update(userId, entityId, {
      type: newType,
      name: newName,
      properties: newProperties,
      embedding: embeddingVector,
    });

    if (!updated) {
      throw new Error(`Entity ${entityId} not found for user ${userId}`);
    }

    log.info('Entity updated with re-embedding', { entityId });

    return {
      id: updated.id,
      userId: updated.userId,
      type: updated.type,
      name: updated.name,
      properties: updated.properties,
      embedding: updated.embedding,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    };
  }

  /**
   * Get an entity by ID
   */
  async getEntity(userId: string, entityId: string): Promise<KGEntity | null> {
    const entity = await this.entityRepository.findById(userId, entityId);
    if (!entity) {
      return null;
    }

    return {
      id: entity.id,
      userId: entity.userId,
      type: entity.type,
      name: entity.name,
      properties: entity.properties,
      embedding: entity.embedding,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };
  }

  /**
   * Get entities by type
   */
  async getEntitiesByType(userId: string, type: string): Promise<KGEntity[]> {
    const entities = await this.entityRepository.findByType(userId, type);

    return entities.map((e) => ({
      id: e.id,
      userId: e.userId,
      type: e.type,
      name: e.name,
      properties: e.properties,
      embedding: e.embedding,
      createdAt: e.createdAt,
      updatedAt: e.updatedAt,
    }));
  }

  /**
   * Get all relations for an entity
   */
  async getRelations(userId: string, entityId: string): Promise<KGRelation[]> {
    const relations = await this.relationRepository.findByEntity(userId, entityId);

    return relations.map((r) => ({
      id: r.id,
      userId: r.userId,
      sourceId: r.sourceId,
      targetId: r.targetId,
      type: r.type,
      properties: r.properties,
      createdAt: r.createdAt,
    }));
  }

  /**
   * Get relation by ID
   */
  async getRelation(userId: string, relationId: string): Promise<KGRelation | null> {
    const relation = await this.relationRepository.findById(userId, relationId);
    if (!relation) {
      return null;
    }

    return {
      id: relation.id,
      userId: relation.userId,
      sourceId: relation.sourceId,
      targetId: relation.targetId,
      type: relation.type,
      properties: relation.properties,
      createdAt: relation.createdAt,
    };
  }

  /**
   * Count entities and relations for a user
   */
  async getCounts(userId: string): Promise<{ entities: number; relations: number }> {
    const [entities, relations] = await Promise.all([
      this.entityRepository.countByUser(userId),
      this.relationRepository.countByUser(userId),
    ]);

    return { entities, relations };
  }

  /**
   * Delete all entities and relations for a user
   */
  async deleteAll(userId: string): Promise<{ entities: number; relations: number }> {
    // Relations are deleted via FK cascade, but we count them first
    const relationCount = await this.relationRepository.countByUser(userId);
    const entityCount = await this.entityRepository.deleteByUser(userId);

    return { entities: entityCount, relations: relationCount };
  }

  // =========================================================================
  // Private helpers
  // =========================================================================

  /**
   * Create embedding text from entity properties
   */
  private createEmbeddingText(
    type: string,
    name: string,
    properties?: Record<string, unknown>
  ): string {
    const propsText = properties
      ? Object.entries(properties)
          .map(([k, v]) => `${k}: ${v}`)
          .join('. ')
      : '';

    return `${type}: ${name}. ${propsText}`.trim();
  }

  /**
   * Traverse the graph using BFS to collect relations and related entities
   */
  private async traverseGraph(
    userId: string,
    startEntityId: string,
    maxDepth: number
  ): Promise<{
    relations: Awaited<ReturnType<KGRelationRepository['findByEntity']>>;
    relatedEntities: Awaited<ReturnType<KGEntityRepository['findByIds']>>;
  }> {
    const allRelations: Awaited<ReturnType<KGRelationRepository['findByEntity']>> = [];
    const relatedEntityIds = new Set<string>();
    const visitedEntityIds = new Set<string>([startEntityId]);
    let currentLevel = [startEntityId];

    for (let depth = 0; depth < maxDepth; depth++) {
      const nextLevel: string[] = [];

      for (const entityId of currentLevel) {
        // Get all relations for this entity
        const relations = await this.relationRepository.findByEntity(userId, entityId);

        for (const relation of relations) {
          // Add relation if not already added
          if (!allRelations.some((r) => r.id === relation.id)) {
            allRelations.push(relation);
          }

          // Find the related entity ID
          const relatedId =
            relation.sourceId === entityId ? relation.targetId : relation.sourceId;

          // Track related entity
          if (relatedId !== startEntityId) {
            relatedEntityIds.add(relatedId);
          }

          // Queue for next level if not visited
          if (!visitedEntityIds.has(relatedId)) {
            visitedEntityIds.add(relatedId);
            nextLevel.push(relatedId);
          }
        }
      }

      currentLevel = nextLevel;
      if (currentLevel.length === 0) break;
    }

    // Fetch all related entities
    const relatedEntities = relatedEntityIds.size > 0
      ? await this.entityRepository.findByIds(userId, Array.from(relatedEntityIds))
      : [];

    return { relations: allRelations, relatedEntities };
  }
}
