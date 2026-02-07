# Backend Developer 1 - Implementation Guide

## Role Overview

You are responsible for the **infrastructure layer** of Project Jarvis:
- Database setup and migrations (Postgres + pgvector + Drizzle ORM)
- Authentication system (JWT + refresh tokens)
- User secrets management (AES-256-GCM encryption)
- WebSocket/SSE server infrastructure
- Security, rate limiting, and observability

---

## Implementation Status

> **Last Updated:** February 2026

### Completed

| Component | Status | Notes |
|-----------|--------|-------|
| Drizzle ORM Setup | **DONE** | Schema in `apps/backend/src/infrastructure/db/schema.ts` |
| Database Schema | **DONE** | Users, secrets, agent runs, memories, KG tables |
| Config Management | **DONE** | Zod validation in `infrastructure/config/` |
| Logging Infrastructure | **DONE** | Structured logging in `infrastructure/logging/` |
| Auth Middleware (Placeholder) | **PARTIAL** | JWT extraction works, validation is placeholder |
| Secrets Encryption Module | **NOT STARTED** | Design exists, not implemented |

### Integration Notes

The backend now uses **Hono** instead of Express, and **SSE** instead of WebSocket for real-time events. The orchestrator layer (Backend Dev 2) is fully implemented with in-memory adapters that need to be replaced with persistent storage.

---

## Weekly Breakdown

---

## Week 1: Foundation

### Objectives
- Set up Postgres with pgvector extension
- Configure Drizzle ORM with migrations
- Establish config management and logging infrastructure

### Day 1-2: Docker Compose Setup

**Create `apps/backend/docker-compose.yml`:**
```yaml
version: '3.8'
services:
  postgres:
    image: pgvector/pgvector:pg16
    environment:
      POSTGRES_USER: jarvis
      POSTGRES_PASSWORD: jarvis_dev
      POSTGRES_DB: jarvis
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U jarvis"]
      interval: 5s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redisdata:/data

volumes:
  pgdata:
  redisdata:
```

**Tasks:**
- [x] Create Docker Compose file
- [ ] Verify pgvector extension loads: `CREATE EXTENSION IF NOT EXISTS vector;`
- [ ] Document local setup in SETUP.md

### Day 2-3: Drizzle ORM Setup

**Status: DONE**

Schema exists at `apps/backend/src/infrastructure/db/schema.ts`

**Current Schema Tables:**
- `users` - User accounts
- `userSecrets` - Encrypted API keys
- `refreshTokens` - JWT refresh tokens
- `agentRuns` - Agent execution runs
- `messages` - Conversation messages
- `toolCalls` - Tool invocation history
- `memories` - Vector memory storage
- `kgEntities` - Knowledge graph entities
- `kgRelations` - Knowledge graph relationships

### Day 3-4: Config Management

**Status: DONE**

Located at `apps/backend/src/infrastructure/config/index.ts`

**Current `.env.example`:**
```bash
NODE_ENV=development
PORT=3000

# Database
DATABASE_URL=postgresql://jarvis:jarvis_dev@localhost:5432/jarvis

# LLM keys
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...

# Optional
TAVILY_API_KEY=tvly-...
LOG_LEVEL=info
```

### Day 4-5: Logging Infrastructure

**Status: DONE**

Located at `apps/backend/src/infrastructure/logging/logger.ts`

Features:
- Structured JSON logging
- Child logger support with context
- Log level filtering based on `LOG_LEVEL` env var

### Files Created This Week

```
apps/backend/
  docker-compose.yml (NOT YET CREATED)
  drizzle.config.ts
  .env.example
  src/
    infrastructure/
      config/
        index.ts           # DONE
      db/
        schema.ts          # DONE
        client.ts          # NOT STARTED
        migrate.ts         # NOT STARTED
      logging/
        logger.ts          # DONE
        index.ts           # DONE
```

---

## Week 2: Auth & Secrets

### Objectives
- Implement JWT authentication with refresh tokens
- Build secure secrets encryption/decryption
- Create auth middleware and rate limiting

### Current State

**Auth Middleware:** `apps/backend/src/api/http/middleware/auth.ts`
- Extracts Bearer token from Authorization header
- **PLACEHOLDER**: Currently accepts any token and uses anonymous user ID
- Needs real JWT validation implementation

**TODOs in auth.ts:**
```typescript
// TODO: Implement actual JWT validation for production
// TODO: Validate JWT token and extract user ID
// TODO: Validate JWT and extract user ID
```

### Day 1-2: User Repository & Auth Service

**Status: NOT STARTED**

Need to create:
- `apps/backend/src/adapters/storage/user-repository.ts`
- `apps/backend/src/adapters/storage/refresh-token-repository.ts`
- `apps/backend/src/application/services/auth-service.ts`

### Day 2-3: JWT Auth Middleware

**Status: PARTIAL**

Current implementation in `auth.ts`:
```typescript
export function authMiddleware(c: Context, next: Next) {
  // Currently placeholder - accepts anonymous user
  // TODO: Implement actual JWT validation
}
```

### Day 3-4: Secrets Encryption Module

**Status: NOT STARTED**

Design exists in original guide, needs implementation:
- `apps/backend/src/infrastructure/crypto/secrets.ts`
- `apps/backend/src/application/services/secrets-service.ts`

### Day 4-5: Secrets CRUD API

**Status: NOT STARTED**

Need to create:
- `apps/backend/src/api/http/routes/secrets.ts`

### Files to Create This Week

```
apps/backend/src/
  adapters/storage/
    user-repository.ts          # NOT STARTED
    refresh-token-repository.ts # NOT STARTED
    user-secret-repository.ts   # NOT STARTED
  application/services/
    auth-service.ts             # NOT STARTED
    secrets-service.ts          # NOT STARTED
  api/
    http/
      routes/
        auth.ts                 # NOT STARTED
        secrets.ts              # NOT STARTED
    middleware/
      auth.ts                   # PARTIAL (placeholder)
      validate.ts               # NOT STARTED
      error-handler.ts          # NOT STARTED
  infrastructure/crypto/
    secrets.ts                  # NOT STARTED
  domain/
    errors.ts                   # DONE (in shared-types)
```

---

## Week 3: Persistence & Real-Time Events

### Objectives
- Create AgentRun, Message, ToolCall repositories
- Set up real-time event infrastructure
- Implement EventStreamAdapter

### Current State

**Important Change:** The backend uses **SSE (Server-Sent Events)** instead of WebSocket.

The orchestrator layer has implemented:
- `SSEEventStreamAdapter` - Publishes events via Hono streaming
- In-memory state repositories (need Postgres replacement)

### Day 1-2: Agent Run Repositories

**Status: PARTIAL**

In-memory implementations exist:
- `InMemoryOrchestratorStateRepository`
- `InMemoryOrchestratorCache`

Need PostgreSQL implementations:
- `apps/backend/src/adapters/storage/agent-run-repository.ts`
- Message and ToolCall repositories

### Day 3-4: Event Streaming

**Status: DONE (SSE, not WebSocket)**

Located at `apps/backend/src/adapters/orchestrator/SSEEventStreamAdapter.ts`

Uses Hono's built-in streaming:
```typescript
return stream(c, async (stream) => {
  for await (const event of orchestrator.run(input, context)) {
    await stream.write(`data: ${JSON.stringify(event)}\n\n`);
  }
});
```

**If WebSocket is still needed for other features:**
- Install socket.io: `pnpm add socket.io`
- Create `apps/backend/src/api/ws/socket-server.ts`

### Files to Create This Week

```
apps/backend/src/
  adapters/
    storage/
      agent-run-repository.ts     # NOT STARTED (Postgres)
      message-repository.ts       # NOT STARTED (Postgres)
      tool-call-repository.ts     # NOT STARTED (Postgres)
    event-stream/
      websocket-adapter.ts        # NOT NEEDED (using SSE)
  api/ws/
    socket-server.ts              # NOT NEEDED (using SSE)
  ports/
    EventStreamPort.ts            # DONE
```

---

## Week 4: Memory Storage

### Objectives
- Set up pgvector indexes
- Create memory and KG repositories
- Implement vector search queries

### Current State

In-memory implementations exist with embeddings:
- `InMemoryMemoryStore` - Semantic search with cosine similarity
- `InMemoryKnowledgeGraph` - Graph traversal with embeddings

Need PostgreSQL + pgvector implementations.

### Day 1-2: pgvector Setup

**Status: NOT STARTED**

Need to create migration:
```sql
-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Create HNSW index for fast similarity search
CREATE INDEX IF NOT EXISTS memories_embedding_idx 
ON memories USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS kg_entities_embedding_idx 
ON kg_entities USING hnsw (embedding vector_cosine_ops);
```

### Day 3-4: Knowledge Graph Repository

**Status: NOT STARTED**

Need PostgreSQL implementation of `KnowledgeGraphPort`.

### Day 4-5: Rate Limiting

**Status: NOT STARTED**

Need to implement rate limiting middleware.

### Files to Create This Week

```
apps/backend/src/
  adapters/storage/
    memory-repository.ts          # NOT STARTED (Postgres + pgvector)
    kg-repository.ts              # NOT STARTED (Postgres)
  api/middleware/
    rate-limit.ts                 # NOT STARTED
  infrastructure/db/migrations/
    0002_add_vector_indexes.sql   # NOT STARTED
```

---

## Week 5: Tool Permissions & OAuth

### Objectives
- Implement tool permission system
- Store Composio OAuth tokens
- Add cost tracking

**Status: NOT STARTED**

---

## Week 6: Security & Observability

### Objectives
- Implement row-level security
- Set up OpenTelemetry tracing
- PII redaction

**Status: NOT STARTED**

---

## Priority Replacement Tasks

The orchestrator is fully functional with in-memory adapters. These need to be replaced with persistent implementations:

### High Priority

1. **Replace `InMemoryMemoryStore`**
   - Create `PostgresMemoryStore` implementing `MemoryStorePort`
   - Use pgvector for semantic search
   - Located at `apps/backend/src/adapters/memory/`

2. **Replace `InMemoryKnowledgeGraph`**
   - Create `PostgresKnowledgeGraph` implementing `KnowledgeGraphPort`
   - Use graph queries with CTEs for traversal
   - Located at `apps/backend/src/adapters/kg/`

3. **Replace `InMemoryOrchestratorStateRepository`**
   - Create `PostgresOrchestratorState` implementing `OrchestratorStatePort`
   - Persist runs, plans, agent states
   - Located at `apps/backend/src/adapters/orchestrator/`

4. **Implement Real Auth**
   - Update `apps/backend/src/api/http/middleware/auth.ts`
   - Add JWT validation with jsonwebtoken
   - Extract user ID from token claims

### Medium Priority

5. **Add User Secrets Management**
   - Implement AES-256-GCM encryption
   - CRUD API for secrets
   - Integration with LLM adapters

6. **Add Rate Limiting**
   - Per-IP global limits
   - Per-user request limits
   - Agent run concurrency limits

---

## Testing Checklist

### Unit Tests
- [ ] Auth service (register, login, refresh, logout)
- [ ] Secrets encryption/decryption
- [ ] Repository CRUD operations
- [ ] Rate limiting logic

### Integration Tests
- [ ] Auth flow end-to-end
- [ ] Secrets API
- [ ] SSE event streaming
- [ ] Vector similarity search

### Security Tests
- [ ] JWT validation edge cases
- [ ] Secrets never logged
- [ ] Rate limiting effectiveness
- [ ] RLS policy enforcement

---

## Coordination with Other Developers

### With Backend Dev 2
- **Completed:** Port interfaces agreed upon
- **Completed:** Event streaming (SSE) implemented
- **Pending:** Postgres adapters to replace in-memory stores

### With Frontend Dev
- **Update Needed:** Document SSE format (not WebSocket)
- **Update Needed:** Document current API endpoints
- **Pending:** JWT payload format documentation

---

## Quick Reference

### Generate Master Key
```bash
openssl rand -hex 32
```

### Run Migrations
```bash
pnpm drizzle-kit generate:pg
pnpm drizzle-kit push:pg
```

### Start Local Services
```bash
docker-compose up -d
cd apps/backend && pnpm dev
```

### Current Working Commands
```bash
# Build shared-types
cd packages/shared-types && pnpm build

# Build backend
cd apps/backend && pnpm build

# Run development server
cd apps/backend && pnpm dev

# Type check
cd apps/backend && pnpm typecheck
```
