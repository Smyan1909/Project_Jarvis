// =============================================================================
// Services - Singleton Instances
// =============================================================================
// Centralized service instantiation for dependency injection.
// Services are created once and shared across the application.

import { UserRepository } from '../adapters/storage/user-repository.js';
import { RefreshTokenRepository } from '../adapters/storage/refresh-token-repository.js';
import { UserSecretRepository } from '../adapters/storage/user-secret-repository.js';
import { AgentRunRepository } from '../adapters/storage/agent-run-repository.js';
import { MessageRepository } from '../adapters/storage/message-repository.js';
import { ToolCallRepository } from '../adapters/storage/tool-call-repository.js';
import { MemoryRepository } from '../adapters/storage/memory-repository.js';
import { KGEntityRepository } from '../adapters/storage/kg-entity-repository.js';
import { KGRelationRepository } from '../adapters/storage/kg-relation-repository.js';
import { AuthService } from '../application/services/auth-service.js';
import { SecretsService } from '../application/services/secrets-service.js';
import { PgMemoryStore } from '../adapters/memory/PgMemoryStore.js';
import { PgKnowledgeGraph } from '../adapters/kg/PgKnowledgeGraph.js';
import { VercelEmbeddingAdapter } from '../adapters/embedding/VercelEmbeddingAdapter.js';

// =============================================================================
// Repositories
// =============================================================================

/**
 * User repository singleton
 */
export const userRepository = new UserRepository();

/**
 * Refresh token repository singleton
 */
export const refreshTokenRepository = new RefreshTokenRepository();

/**
 * User secret repository singleton
 */
export const userSecretRepository = new UserSecretRepository();

/**
 * Agent run repository singleton
 * Tracks agent execution sessions with status and cost metrics
 */
export const agentRunRepository = new AgentRunRepository();

/**
 * Message repository singleton
 * Stores conversation history within agent runs
 */
export const messageRepository = new MessageRepository();

/**
 * Tool call repository singleton
 * Tracks individual tool invocations during agent runs
 */
export const toolCallRepository = new ToolCallRepository();

/**
 * Memory repository singleton
 * Low-level storage for memories with pgvector embeddings
 */
export const memoryRepository = new MemoryRepository();

/**
 * Knowledge graph entity repository singleton
 * Low-level storage for KG entities with pgvector embeddings
 */
export const kgEntityRepository = new KGEntityRepository();

/**
 * Knowledge graph relation repository singleton
 * Low-level storage for KG relations
 */
export const kgRelationRepository = new KGRelationRepository();

// =============================================================================
// Embedding Adapter
// =============================================================================

/**
 * Embedding adapter singleton
 * Generates vector embeddings for semantic search
 * Uses OpenAI text-embedding-3-small by default (1536 dimensions)
 */
export const embeddingAdapter = new VercelEmbeddingAdapter();

// =============================================================================
// Application Services
// =============================================================================

/**
 * Authentication service singleton
 * Handles user registration, login, token refresh, and logout
 */
export const authService = new AuthService(userRepository, refreshTokenRepository);

/**
 * Secrets service singleton
 * Handles encrypted storage of user API keys and tokens
 */
export const secretsService = new SecretsService(userSecretRepository);

// =============================================================================
// Memory & Knowledge Graph Services
// =============================================================================

/**
 * Memory store singleton
 * High-level memory storage with automatic embedding and semantic search
 * Implements MemoryStorePort
 */
export const memoryStore = new PgMemoryStore(memoryRepository, embeddingAdapter);

/**
 * Knowledge graph singleton
 * High-level knowledge graph with automatic embedding and semantic search
 * Implements KnowledgeGraphPort
 */
export const knowledgeGraph = new PgKnowledgeGraph(
  kgEntityRepository,
  kgRelationRepository,
  embeddingAdapter
);
