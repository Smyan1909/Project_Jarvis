-- =============================================================================
-- Migration: 003_vector_indexes
-- Description: Create HNSW indexes for pgvector similarity search
-- =============================================================================

-- Enable pgvector extension (idempotent)
CREATE EXTENSION IF NOT EXISTS vector;

-- -----------------------------------------------------------------------------
-- Memory Embeddings Index
-- -----------------------------------------------------------------------------
-- HNSW (Hierarchical Navigable Small World) index for fast approximate 
-- nearest neighbor search on memory embeddings.
-- Using vector_cosine_ops for cosine similarity search.
-- 
-- Parameters:
--   m: Maximum number of connections per layer (default 16)
--   ef_construction: Size of dynamic candidate list for index construction (default 64)
-- Higher values = better recall but slower index build and more memory usage.

CREATE INDEX IF NOT EXISTS memories_embedding_idx 
ON memories USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

-- -----------------------------------------------------------------------------
-- Knowledge Graph Entity Embeddings Index
-- -----------------------------------------------------------------------------
-- HNSW index for semantic search on knowledge graph entities.
-- Enables finding entities by meaning rather than exact text match.

CREATE INDEX IF NOT EXISTS kg_entities_embedding_idx 
ON kg_entities USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

-- -----------------------------------------------------------------------------
-- Additional B-tree indexes for common query patterns
-- -----------------------------------------------------------------------------

-- Index for filtering memories by user
CREATE INDEX IF NOT EXISTS memories_user_id_idx ON memories (user_id);

-- Index for filtering memories by creation date (for getRecent queries)
CREATE INDEX IF NOT EXISTS memories_user_created_idx ON memories (user_id, created_at DESC);

-- Index for filtering entities by user
CREATE INDEX IF NOT EXISTS kg_entities_user_id_idx ON kg_entities (user_id);

-- Index for filtering entities by user and type
CREATE INDEX IF NOT EXISTS kg_entities_user_type_idx ON kg_entities (user_id, type);

-- Index for filtering relations by user
CREATE INDEX IF NOT EXISTS kg_relations_user_id_idx ON kg_relations (user_id);

-- Index for graph traversal - finding outgoing relations
CREATE INDEX IF NOT EXISTS kg_relations_source_idx ON kg_relations (source_id);

-- Index for graph traversal - finding incoming relations
CREATE INDEX IF NOT EXISTS kg_relations_target_idx ON kg_relations (target_id);

-- Index for filtering relations by type
CREATE INDEX IF NOT EXISTS kg_relations_user_type_idx ON kg_relations (user_id, type);
