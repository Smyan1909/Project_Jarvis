// =============================================================================
// Memory and Knowledge Graph Tools
// =============================================================================
// Tool registrations for memory (remember/recall) and knowledge graph operations

import type { ToolRegistry } from './ToolRegistry.js';
import type { MemoryStorePort } from '../../ports/MemoryStorePort.js';
import type { KnowledgeGraphPort } from '../../ports/KnowledgeGraphPort.js';

// =============================================================================
// Memory Tools (remember, recall)
// =============================================================================

/**
 * Register memory-related tools
 *
 * Tools:
 * - remember: Store information for later retrieval
 * - recall: Search memories by semantic similarity
 */
export function registerMemoryTools(registry: ToolRegistry, memory: MemoryStorePort): void {
  // -------------------------------------------------------------------------
  // remember - Store information for later retrieval
  // -------------------------------------------------------------------------
  registry.register(
    {
      id: 'remember',
      name: 'remember',
      description:
        'Store important information for later retrieval. Use this when the user explicitly asks you to remember something, or when you encounter important facts about the user (preferences, names, dates, etc.).',
      parameters: {
        type: 'object',
        properties: {
          content: {
            type: 'string',
            description:
              'The information to remember. Be specific and include context.',
          },
          category: {
            type: 'string',
            description:
              'Category for the memory: "preference" (user likes/dislikes), "fact" (information about user), "reminder" (things to do), "context" (conversation context), "other"',
          },
        },
        required: ['content'],
      },
    },
    async (userId, input) => {
      const content = input.content as string;
      const category = (input.category as string) || 'general';

      if (!content || content.trim().length === 0) {
        return { success: false, error: 'Content is required' };
      }

      const memoryItem = await memory.store(userId, content, {
        category,
        source: 'agent',
        timestamp: new Date().toISOString(),
      });

      return {
        success: true,
        message: `I'll remember that: "${content.slice(0, 100)}${content.length > 100 ? '...' : ''}"`,
        memoryId: memoryItem.id,
        category,
      };
    },
    { category: 'memory' }
  );

  // -------------------------------------------------------------------------
  // recall - Search memories by semantic similarity
  // -------------------------------------------------------------------------
  registry.register(
    {
      id: 'recall',
      name: 'recall',
      description:
        'Search memories for relevant information about the user. Use this when you need to remember something previously discussed, user preferences, or any stored context.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description:
              'What to search for in memories. Use natural language.',
          },
          limit: {
            type: 'number',
            description:
              'Maximum number of memories to return (default: 5, max: 20)',
          },
        },
        required: ['query'],
      },
    },
    async (userId, input) => {
      const query = input.query as string;
      const limit = Math.min((input.limit as number) || 5, 20);

      if (!query || query.trim().length === 0) {
        return { success: false, error: 'Query is required' };
      }

      const results = await memory.search(userId, query, limit);

      if (results.length === 0) {
        return {
          found: 0,
          message: 'No relevant memories found.',
          memories: [],
        };
      }

      return {
        found: results.length,
        memories: results.map((m) => ({
          content: m.content,
          similarity: Math.round(m.similarity * 100) / 100,
          category: m.metadata.category || 'general',
          createdAt: m.createdAt.toISOString(),
        })),
      };
    },
    { category: 'memory' }
  );
}

// =============================================================================
// Knowledge Graph Tools (entities, relations, queries)
// =============================================================================

/**
 * Register knowledge graph tools
 *
 * Tools:
 * - kg_create_entity: Create an entity (person, place, organization, etc.)
 * - kg_create_relation: Create a relationship between entities
 * - kg_query: Search the knowledge graph
 * - kg_get_entity: Get detailed information about an entity
 */
export function registerKnowledgeGraphTools(
  registry: ToolRegistry,
  kg: KnowledgeGraphPort
): void {
  // -------------------------------------------------------------------------
  // kg_create_entity - Create an entity in the knowledge graph
  // -------------------------------------------------------------------------
  registry.register(
    {
      id: 'kg_create_entity',
      name: 'kg_create_entity',
      description:
        'Create an entity in the knowledge graph. Use this to track people, places, organizations, concepts, or events mentioned by the user.',
      parameters: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            description:
              'Entity type: "person", "place", "organization", "concept", "event", or custom type',
          },
          name: {
            type: 'string',
            description: 'Name of the entity (e.g., "John Smith", "Acme Corp", "Paris")',
          },
          properties: {
            type: 'object',
            description:
              'Additional properties for the entity (e.g., {"role": "friend", "email": "john@example.com"})',
          },
        },
        required: ['type', 'name'],
      },
    },
    async (userId, input) => {
      const type = input.type as string;
      const name = input.name as string;
      const properties = (input.properties as Record<string, unknown>) || {};

      if (!type || !name) {
        return { success: false, error: 'Type and name are required' };
      }

      const entity = await kg.createEntity(userId, type, name, properties);

      return {
        success: true,
        entityId: entity.id,
        type: entity.type,
        name: entity.name,
        message: `Created ${type} entity: ${name}`,
      };
    },
    { category: 'kg' }
  );

  // -------------------------------------------------------------------------
  // kg_create_relation - Create a relationship between entities
  // -------------------------------------------------------------------------
  registry.register(
    {
      id: 'kg_create_relation',
      name: 'kg_create_relation',
      description:
        'Create a relationship between two entities in the knowledge graph. Use this to track connections like "knows", "works_at", "located_in", "owns", etc.',
      parameters: {
        type: 'object',
        properties: {
          sourceId: {
            type: 'string',
            description: 'ID of the source entity (from kg_create_entity)',
          },
          targetId: {
            type: 'string',
            description: 'ID of the target entity (from kg_create_entity)',
          },
          type: {
            type: 'string',
            description:
              'Relationship type: "knows", "works_at", "located_in", "owns", "member_of", "parent_of", or custom type',
          },
          properties: {
            type: 'object',
            description:
              'Additional properties (e.g., {"since": "2020", "role": "manager"})',
          },
        },
        required: ['sourceId', 'targetId', 'type'],
      },
    },
    async (userId, input) => {
      const sourceId = input.sourceId as string;
      const targetId = input.targetId as string;
      const type = input.type as string;
      const properties = (input.properties as Record<string, unknown>) || {};

      if (!sourceId || !targetId || !type) {
        return { success: false, error: 'sourceId, targetId, and type are required' };
      }

      try {
        const relation = await kg.createRelation(
          userId,
          sourceId,
          targetId,
          type,
          properties
        );

        return {
          success: true,
          relationId: relation.id,
          type: relation.type,
          message: `Created "${type}" relationship between entities`,
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to create relation',
        };
      }
    },
    { category: 'kg' }
  );

  // -------------------------------------------------------------------------
  // kg_query - Search the knowledge graph
  // -------------------------------------------------------------------------
  registry.register(
    {
      id: 'kg_query',
      name: 'kg_query',
      description:
        'Search the knowledge graph for entities and their relationships. Use natural language to find people, places, organizations, and their connections.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description:
              'Natural language query (e.g., "Who does John work with?", "Places in California")',
          },
          type: {
            type: 'string',
            description: 'Optional: Filter by entity type (person, place, organization, etc.)',
          },
          limit: {
            type: 'number',
            description: 'Maximum number of results (default: 10)',
          },
        },
        required: ['query'],
      },
    },
    async (userId, input) => {
      const query = input.query as string;
      const type = input.type as string | undefined;
      const limit = Math.min((input.limit as number) || 10, 50);

      if (!query) {
        return { success: false, error: 'Query is required' };
      }

      const entities = await kg.searchEntities(userId, query, type, limit);

      if (entities.length === 0) {
        return {
          found: 0,
          message: 'No matching entities found in the knowledge graph.',
          entities: [],
        };
      }

      // Get relations for top entities
      const results = await Promise.all(
        entities.slice(0, 5).map(async (entity) => {
          const withRelations = await kg.getEntityWithRelations(userId, entity.id, 1);
          return {
            id: entity.id,
            type: entity.type,
            name: entity.name,
            properties: entity.properties,
            relations: withRelations?.relations.map((r) => ({
              type: r.type,
              targetId: r.targetId === entity.id ? r.sourceId : r.targetId,
            })) || [],
            relatedEntities: withRelations?.relatedEntities.map((e) => ({
              id: e.id,
              type: e.type,
              name: e.name,
            })) || [],
          };
        })
      );

      return {
        found: entities.length,
        entities: results,
      };
    },
    { category: 'kg' }
  );

  // -------------------------------------------------------------------------
  // kg_get_entity - Get detailed information about an entity
  // -------------------------------------------------------------------------
  registry.register(
    {
      id: 'kg_get_entity',
      name: 'kg_get_entity',
      description:
        'Get detailed information about a specific entity including all its relationships.',
      parameters: {
        type: 'object',
        properties: {
          entityId: {
            type: 'string',
            description: 'ID of the entity to retrieve',
          },
          depth: {
            type: 'number',
            description:
              'How many relationship hops to include (default: 1, max: 3)',
          },
        },
        required: ['entityId'],
      },
    },
    async (userId, input) => {
      const entityId = input.entityId as string;
      const depth = Math.min((input.depth as number) || 1, 3);

      if (!entityId) {
        return { success: false, error: 'entityId is required' };
      }

      const result = await kg.getEntityWithRelations(userId, entityId, depth);

      if (!result) {
        return {
          success: false,
          error: `Entity ${entityId} not found`,
        };
      }

      return {
        success: true,
        entity: {
          id: result.entity.id,
          type: result.entity.type,
          name: result.entity.name,
          properties: result.entity.properties,
          createdAt: result.entity.createdAt.toISOString(),
          updatedAt: result.entity.updatedAt.toISOString(),
        },
        relations: result.relations.map((r) => ({
          id: r.id,
          type: r.type,
          sourceId: r.sourceId,
          targetId: r.targetId,
          properties: r.properties,
        })),
        relatedEntities: result.relatedEntities.map((e) => ({
          id: e.id,
          type: e.type,
          name: e.name,
        })),
      };
    },
    { category: 'kg' }
  );
}
