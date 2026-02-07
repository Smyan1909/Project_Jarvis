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

> **Last Updated:** February 7, 2026

### Completed

| Component | Status | Notes |
|-----------|--------|-------|
| Drizzle ORM Setup | **DONE** | Schema in `apps/backend/src/infrastructure/db/schema.ts` |
| Database Schema | **DONE** | Users, secrets, agent runs, memories, KG, tool permissions |
| Config Management | **DONE** | Zod validation in `infrastructure/config/` |
| Logging Infrastructure | **DONE** | Structured logging in `infrastructure/logging/` |
| Auth Middleware (Placeholder) | **PARTIAL** | JWT extraction works, validation is placeholder |
| Secrets API | **DONE** | Full CRUD at `/api/v1/secrets` |
| pgvector Indexes | **DONE** | HNSW indexes in `003_vector_indexes.sql` |
| Memory Repository (Postgres) | **DONE** | `PgMemoryStore` with vector search |
| Knowledge Graph Repository | **DONE** | `PgKnowledgeGraph` with BFS traversal |
| Tool Permission System | **DONE** | Per-user per-tool access control |
| Usage/Cost Tracking API | **DONE** | Aggregation endpoints at `/api/v1/usage` |
| Rate Limiting | **NOT STARTED** | Deferred |

### Integration Notes

The backend now uses **Hono** instead of Express, and **SSE** instead of WebSocket for real-time events. The orchestrator layer (Backend Dev 2) is fully implemented with in-memory adapters that have been replaced with PostgreSQL implementations for memory and knowledge graph.

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

### Status: COMPLETE (except rate limiting - deferred)

### Day 1-2: pgvector Setup

**Status: DONE**

Migration created at `apps/backend/src/infrastructure/db/migrations/003_vector_indexes.sql`:
- Enables pgvector extension
- Creates HNSW indexes for `memories` and `kg_entities` tables
- HNSW parameters: `m = 16, ef_construction = 64`
- Additional B-tree indexes for common query patterns

### Day 3-4: Memory & Knowledge Graph Repositories

**Status: DONE**

**Memory Store:**
- `apps/backend/src/adapters/memory/PgMemoryStore.ts` - Main implementation
- `apps/backend/src/adapters/storage/memory-repository.ts` - Low-level CRUD with vector search
- Uses `<=>` cosine distance operator for similarity search
- Implements `MemoryStorePort` interface

**Knowledge Graph:**
- `apps/backend/src/adapters/kg/PgKnowledgeGraph.ts` - Main implementation
- `apps/backend/src/adapters/storage/kg-entity-repository.ts` - Entity CRUD
- `apps/backend/src/adapters/storage/kg-relation-repository.ts` - Relation CRUD
- BFS traversal for `getEntityWithRelations()`
- Implements `KnowledgeGraphPort` interface

### Day 4-5: Rate Limiting

**Status: DEFERRED**

Rate limiting has been deferred. The `RateLimitError` class exists in `shared-types/src/errors/` and is ready for use when implemented.

### Files Created

```
apps/backend/src/
  adapters/
    memory/
      PgMemoryStore.ts            # DONE
      PgMemoryStore.test.ts       # DONE
    kg/
      PgKnowledgeGraph.ts         # DONE
      PgKnowledgeGraph.test.ts    # DONE
    storage/
      memory-repository.ts        # DONE
      kg-entity-repository.ts     # DONE
      kg-relation-repository.ts   # DONE
  infrastructure/db/migrations/
    003_vector_indexes.sql        # DONE
```

---

## Week 5: Tool Permissions & OAuth

### Objectives
- Implement tool permission system
- Store Composio OAuth tokens
- Add cost tracking

### Status: COMPLETE

### Day 1-2: Tool Permission System

**Status: DONE**

Implemented per-user, per-tool access control:

**Schema:**
- `userToolPermissions` table added to `schema.ts`
- Migration: `apps/backend/src/infrastructure/db/migrations/004_tool_permissions.sql`

**Repository:**
- `apps/backend/src/adapters/storage/tool-permission-repository.ts`
- Methods: `hasPermission()`, `hasPermissions()`, `grantPermission()`, `revokePermission()`, `bulkGrant()`, `bulkRevoke()`

**Integration:**
- `ToolRegistry.ts` updated to use permission repository
- `setPermissionRepository()` method for dependency injection
- `getTools()` now filters by user permissions
- `hasPermission()` checks database for explicit denials

**API Endpoints:** `/api/v1/tool-permissions`
- `GET /` - List user's permission entries
- `GET /denied` - List denied tools
- `GET /check/:toolId` - Check specific tool permission
- `POST /` - Set permission (grant or revoke)
- `POST /bulk` - Bulk update permissions
- `DELETE /:toolId` - Remove permission entry (reset to default)

**Permission Model:**
- Default: all tools allowed (no entry = allowed)
- Explicit grant: entry with `granted=true`
- Explicit deny: entry with `granted=false`

### Day 3-4: Composio OAuth Storage

**Status: DONE (Infrastructure exists)**

The `userSecrets` table already supports Composio tokens:
- Provider type `'composio'` is supported
- Secrets API at `/api/v1/secrets` provides full CRUD
- AES-256-GCM encryption for stored values

No additional Composio-specific adapter needed unless SDK integration is required.

### Day 4-5: Cost Tracking

**Status: DONE**

Cost tracking was already 80% implemented. Added aggregation API:

**API Endpoints:** `/api/v1/usage`
- `GET /` - Aggregated usage summary (configurable date range)
- `GET /daily` - Daily breakdown of usage
- `GET /current-month` - Current month summary
- `GET /runs` - Recent runs with usage details

**Existing Infrastructure:**
- `agentRuns.totalTokens` and `agentRuns.totalCost` columns
- `AgentRunRepository.incrementUsage()` for real-time updates
- `MODEL_PRICING` in `infrastructure/ai/config.ts`
- `calculateModelCost()` function

### Files Created

```
apps/backend/src/
  adapters/storage/
    tool-permission-repository.ts   # DONE
  api/http/routes/
    tool-permissions.ts             # DONE
    usage.ts                        # DONE
  infrastructure/db/
    schema.ts                       # UPDATED (userToolPermissions table)
    migrations/
      004_tool_permissions.sql      # DONE
  application/services/
    ToolRegistry.ts                 # UPDATED (permission checking)
  api/http/
    router.ts                       # UPDATED (new routes registered)
```

---

## Week 6: Security & Observability

### Objectives
- Implement row-level security
- Set up OpenTelemetry tracing
- PII redaction

**Status: NOT STARTED**

---

## Priority Replacement Tasks

The orchestrator is fully functional. Most in-memory adapters have been replaced with PostgreSQL implementations.

### Completed

1. **~~Replace `InMemoryMemoryStore`~~** **DONE**
   - `PgMemoryStore` implementing `MemoryStorePort`
   - Uses pgvector for semantic search
   - Located at `apps/backend/src/adapters/memory/PgMemoryStore.ts`

2. **~~Replace `InMemoryKnowledgeGraph`~~** **DONE**
   - `PgKnowledgeGraph` implementing `KnowledgeGraphPort`
   - Uses BFS for graph traversal
   - Located at `apps/backend/src/adapters/kg/PgKnowledgeGraph.ts`

3. **~~Add User Secrets Management~~** **DONE**
   - Secrets API at `/api/v1/secrets`
   - AES-256-GCM encryption
   - Full CRUD operations

4. **~~Tool Permissions~~** **DONE**
   - Per-user per-tool access control
   - API at `/api/v1/tool-permissions`
   - Integrated with `ToolRegistry`

5. **~~Cost Tracking API~~** **DONE**
   - Usage aggregation at `/api/v1/usage`
   - Daily/monthly breakdowns

### High Priority (Remaining)

1. **Replace `InMemoryOrchestratorStateRepository`**
   - Create `PostgresOrchestratorState` implementing `OrchestratorStatePort`
   - Persist runs, plans, agent states
   - Located at `apps/backend/src/adapters/orchestrator/`

2. **Implement Real Auth**
   - Update `apps/backend/src/api/http/middleware/auth.ts`
   - Add JWT validation with jsonwebtoken
   - Extract user ID from token claims

### Medium Priority (Remaining)

3. **Add Rate Limiting**
   - Per-IP global limits
   - Per-user request limits
   - Agent run concurrency limits
   - `RateLimitError` class already exists

---

## Testing Checklist

### Unit Tests
- [ ] Auth service (register, login, refresh, logout)
- [ ] Secrets encryption/decryption
- [x] Repository CRUD operations (PgMemoryStore, PgKnowledgeGraph have tests)
- [ ] Rate limiting logic
- [x] Tool permission repository

### Integration Tests
- [ ] Auth flow end-to-end
- [x] Secrets API
- [x] SSE event streaming
- [x] Vector similarity search (PgMemoryStore.test.ts)
- [x] Tool permissions API
- [x] Usage API

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
- **Completed:** Postgres adapters for memory and KG
- **Pending:** Postgres adapter for orchestrator state

### With Frontend Dev
- **Update Needed:** Document SSE format (not WebSocket)
- **Completed:** Tool permissions API documented
- **Completed:** Usage API documented
- **Pending:** JWT payload format documentation

### API Endpoints Summary

| Endpoint | Description |
|----------|-------------|
| `POST /api/v1/auth/login` | User login |
| `POST /api/v1/auth/register` | User registration |
| `GET /api/v1/secrets` | List user secrets |
| `POST /api/v1/secrets` | Create secret |
| `PATCH /api/v1/secrets/:id` | Update secret |
| `DELETE /api/v1/secrets/:id` | Delete secret |
| `GET /api/v1/tool-permissions` | List tool permissions |
| `GET /api/v1/tool-permissions/check/:toolId` | Check permission |
| `POST /api/v1/tool-permissions` | Set permission |
| `POST /api/v1/tool-permissions/bulk` | Bulk update |
| `DELETE /api/v1/tool-permissions/:toolId` | Remove permission |
| `GET /api/v1/usage` | Usage summary |
| `GET /api/v1/usage/daily` | Daily usage |
| `GET /api/v1/usage/current-month` | Current month |
| `GET /api/v1/usage/runs` | Recent runs |
| `POST /api/v1/orchestrator/run` | Start agent run (SSE) |
| `POST /api/v1/chat` | Chat endpoint |

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
