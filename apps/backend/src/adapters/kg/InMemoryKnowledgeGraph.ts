// =============================================================================
// In-Memory Knowledge Graph Adapter
// =============================================================================
// Implements KnowledgeGraphPort using in-memory storage with embeddings
// Designed for easy swap to Neo4j or Postgres later

import { v4 as uuidv4 } from 'uuid';
import type { KGEntity, KGRelation, KGSearchResult } from '@project-jarvis/shared-types';
import type { KnowledgeGraphPort } from '../../ports/KnowledgeGraphPort.js';
import type { EmbeddingPort } from '../../ports/EmbeddingPort.js';
import { logger } from '../../infrastructure/logging/logger.js';

/**
 * Compute cosine similarity between two vectors
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error('Vectors must have the same length');
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  if (magnitude === 0) return 0;

  return dotProduct / magnitude;
}

/**
 * In-memory implementation of KnowledgeGraphPort
 *
 * Features:
 * - User-scoped entities and relations
 * - Semantic similarity search using embeddings
 * - Graph traversal with configurable depth
 *
 * Note: This is a development/testing implementation.
 * Production should use Neo4j or PostgreSQL with proper indexing.
 */
export class InMemoryKnowledgeGraph implements KnowledgeGraphPort {
  // Map<userId, Map<entityId, KGEntity>>
  private entities: Map<string, Map<string, KGEntity>> = new Map();
  // Map<userId, Map<relationId, KGRelation>>
  private relations: Map<string, Map<string, KGRelation>> = new Map();

  constructor(private embedding: EmbeddingPort) {}

  /**
   * Create an entity in the knowledge graph
   */
  async createEntity(
    userId: string,
    type: string,
    name: string,
    properties?: Record<string, unknown>
  ): Promise<KGEntity> {
    const log = logger.child({ userId, operation: 'kg.createEntity' });

    // Generate embedding for semantic search
    const embeddingText = `${type}: ${name}. ${Object.entries(properties || {})
      .map(([k, v]) => `${k}: ${v}`)
      .join('. ')}`;
    const embeddingVector = await this.embedding.embed(embeddingText);

    const now = new Date();
    const entity: KGEntity = {
      id: uuidv4(),
      userId,
      type,
      name,
      properties: properties || {},
      embedding: embeddingVector,
      createdAt: now,
      updatedAt: now,
    };

    // Get or create user's entity map
    if (!this.entities.has(userId)) {
      this.entities.set(userId, new Map());
    }
    this.entities.get(userId)!.set(entity.id, entity);

    log.info('Entity created', { entityId: entity.id, type, name });
    return entity;
  }

  /**
   * Create a relation between two entities
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
    const userEntities = this.entities.get(userId);
    if (!userEntities) {
      throw new Error('No entities found for user');
    }

    const sourceEntity = userEntities.get(sourceId);
    const targetEntity = userEntities.get(targetId);

    if (!sourceEntity) {
      throw new Error(`Source entity ${sourceId} not found`);
    }
    if (!targetEntity) {
      throw new Error(`Target entity ${targetId} not found`);
    }

    const relation: KGRelation = {
      id: uuidv4(),
      userId,
      sourceId,
      targetId,
      type,
      properties: properties || {},
      createdAt: new Date(),
    };

    // Get or create user's relation map
    if (!this.relations.has(userId)) {
      this.relations.set(userId, new Map());
    }
    this.relations.get(userId)!.set(relation.id, relation);

    log.info('Relation created', {
      relationId: relation.id,
      type,
      source: sourceEntity.name,
      target: targetEntity.name,
    });
    return relation;
  }

  /**
   * Search entities by semantic similarity
   */
  async searchEntities(
    userId: string,
    query: string,
    type?: string,
    limit: number = 10
  ): Promise<KGEntity[]> {
    const log = logger.child({ userId, operation: 'kg.searchEntities' });
    const userEntities = this.entities.get(userId);

    if (!userEntities || userEntities.size === 0) {
      log.debug('No entities found for user');
      return [];
    }

    // Generate embedding for the query
    const queryEmbedding = await this.embedding.embed(query);

    // Calculate similarity scores for all entities
    const results: Array<{ entity: KGEntity; similarity: number }> = [];

    for (const entity of userEntities.values()) {
      // Filter by type if specified
      if (type && entity.type !== type) {
        continue;
      }

      // Skip entities without embeddings
      if (!entity.embedding) {
        continue;
      }

      const similarity = cosineSimilarity(queryEmbedding, entity.embedding);
      results.push({ entity, similarity });
    }

    // Sort by similarity (descending) and take top N
    results.sort((a, b) => b.similarity - a.similarity);
    const topResults = results.slice(0, limit);

    log.debug('Entity search completed', {
      query: query.slice(0, 50),
      type: type || 'all',
      resultsReturned: topResults.length,
    });

    return topResults.map(({ entity }) => entity);
  }

  /**
   * Get an entity with its relations and related entities
   */
  async getEntityWithRelations(
    userId: string,
    entityId: string,
    depth: number = 1
  ): Promise<KGSearchResult | null> {
    const userEntities = this.entities.get(userId);
    const userRelations = this.relations.get(userId);

    if (!userEntities) {
      return null;
    }

    const entity = userEntities.get(entityId);
    if (!entity) {
      return null;
    }

    // Find all relations involving this entity
    const entityRelations: KGRelation[] = [];
    const relatedEntities: Map<string, KGEntity> = new Map();

    if (userRelations) {
      for (const relation of userRelations.values()) {
        if (relation.sourceId === entityId || relation.targetId === entityId) {
          entityRelations.push(relation);

          // Add related entity
          const relatedId =
            relation.sourceId === entityId ? relation.targetId : relation.sourceId;
          const relatedEntity = userEntities.get(relatedId);
          if (relatedEntity) {
            relatedEntities.set(relatedId, relatedEntity);
          }
        }
      }
    }

    // If depth > 1, recursively get relations for related entities
    if (depth > 1 && userRelations) {
      const toExplore = Array.from(relatedEntities.keys());
      const explored = new Set([entityId]);

      for (let d = 1; d < depth; d++) {
        const nextToExplore: string[] = [];

        for (const currentId of toExplore) {
          if (explored.has(currentId)) continue;
          explored.add(currentId);

          for (const relation of userRelations.values()) {
            if (relation.sourceId === currentId || relation.targetId === currentId) {
              if (!entityRelations.includes(relation)) {
                entityRelations.push(relation);
              }

              const relatedId =
                relation.sourceId === currentId ? relation.targetId : relation.sourceId;
              const relatedEntity = userEntities.get(relatedId);
              if (relatedEntity && !relatedEntities.has(relatedId)) {
                relatedEntities.set(relatedId, relatedEntity);
                nextToExplore.push(relatedId);
              }
            }
          }
        }

        toExplore.length = 0;
        toExplore.push(...nextToExplore);
      }
    }

    return {
      entity,
      relations: entityRelations,
      relatedEntities: Array.from(relatedEntities.values()),
    };
  }

  /**
   * Query the knowledge graph with natural language
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
   */
  async updateEntity(
    userId: string,
    entityId: string,
    properties: Record<string, unknown>
  ): Promise<KGEntity> {
    const log = logger.child({ userId, entityId, operation: 'kg.updateEntity' });
    const userEntities = this.entities.get(userId);

    if (!userEntities || !userEntities.has(entityId)) {
      throw new Error(`Entity ${entityId} not found for user ${userId}`);
    }

    const entity = userEntities.get(entityId)!;
    const updatedEntity: KGEntity = {
      ...entity,
      properties: { ...entity.properties, ...properties },
      updatedAt: new Date(),
    };

    userEntities.set(entityId, updatedEntity);
    log.info('Entity updated', { entityId });
    return updatedEntity;
  }

  /**
   * Delete an entity and its relations
   */
  async deleteEntity(userId: string, entityId: string): Promise<void> {
    const log = logger.child({ userId, entityId, operation: 'kg.deleteEntity' });
    const userEntities = this.entities.get(userId);
    const userRelations = this.relations.get(userId);

    if (!userEntities || !userEntities.has(entityId)) {
      throw new Error(`Entity ${entityId} not found for user ${userId}`);
    }

    // Delete all relations involving this entity
    if (userRelations) {
      const relationsToDelete: string[] = [];
      for (const [relationId, relation] of userRelations) {
        if (relation.sourceId === entityId || relation.targetId === entityId) {
          relationsToDelete.push(relationId);
        }
      }
      for (const relationId of relationsToDelete) {
        userRelations.delete(relationId);
      }
      log.debug('Deleted related relations', { count: relationsToDelete.length });
    }

    userEntities.delete(entityId);
    log.info('Entity deleted');
  }

  /**
   * Delete a relation
   */
  async deleteRelation(userId: string, relationId: string): Promise<void> {
    const log = logger.child({ userId, relationId, operation: 'kg.deleteRelation' });
    const userRelations = this.relations.get(userId);

    if (!userRelations || !userRelations.has(relationId)) {
      throw new Error(`Relation ${relationId} not found for user ${userId}`);
    }

    userRelations.delete(relationId);
    log.info('Relation deleted');
  }

  // =========================================================================
  // Test/Debug helpers (not part of port interface)
  // =========================================================================

  /**
   * Clear all data for a user (useful for testing)
   */
  clearUser(userId: string): void {
    this.entities.delete(userId);
    this.relations.delete(userId);
  }

  /**
   * Clear all data (useful for testing)
   */
  clearAll(): void {
    this.entities.clear();
    this.relations.clear();
  }

  /**
   * Get counts for a user
   */
  getCounts(userId: string): { entities: number; relations: number } {
    return {
      entities: this.entities.get(userId)?.size || 0,
      relations: this.relations.get(userId)?.size || 0,
    };
  }
}
