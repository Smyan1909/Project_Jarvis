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

> **Last Updated:** February 7, 2026 (Updated: OpenTelemetry tracing implemented)

### Completed

| Component | Status | Notes |
|-----------|--------|-------|
| Drizzle ORM Setup | **DONE** | Schema in `apps/backend/src/infrastructure/db/schema.ts` |
| Database Schema | **DONE** | Users, secrets, agent runs, memories, KG, tool permissions |
| Config Management | **DONE** | Zod validation in `infrastructure/config/` |
| Logging Infrastructure | **DONE** | Structured logging in `infrastructure/logging/` |
| Auth Service | **DONE** | JWT + refresh token rotation in `application/services/auth-service.ts` |
| Auth Middleware | **DONE** | Real JWT validation in `api/http/middleware/auth.ts` |
| User Repository | **DONE** | `adapters/storage/user-repository.ts` |
| Refresh Token Repository | **DONE** | `adapters/storage/refresh-token-repository.ts` |
| Auth Routes | **DONE** | register, login, refresh, logout, logout-all, me at `/api/v1/auth` |
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

### Status: COMPLETE

All Week 2 objectives have been implemented with 24 passing integration tests.

### Day 1-2: User Repository & Auth Service

**Status: DONE**

Implemented:
- `apps/backend/src/adapters/storage/user-repository.ts` - User CRUD with email normalization
- `apps/backend/src/adapters/storage/refresh-token-repository.ts` - Token storage with SHA-256 hashing
- `apps/backend/src/application/services/auth-service.ts` - Full auth flow with bcrypt (12 rounds)

Features:
- Password validation (min 8 chars, letter + number)
- Email normalization (lowercase, trimmed)
- Token rotation on refresh
- Logout from all devices

### Day 2-3: JWT Auth Middleware

**Status: DONE**

Implemented at `apps/backend/src/api/http/middleware/auth.ts`:
- Real JWT validation using `jsonwebtoken` library
- Extracts `userId` and `userEmail` from token payload
- Optional auth middleware for public routes with optional user context
- Proper 401 responses with error codes

### Day 3-4: Secrets Encryption Module

**Status: DONE**

Implemented:
- `apps/backend/src/infrastructure/crypto/secrets.ts` - AES-256-GCM encryption
- `apps/backend/src/application/services/secrets-service.ts` - Secret management
- `apps/backend/src/adapters/storage/user-secret-repository.ts` - Encrypted storage

### Day 4-5: Secrets CRUD API

**Status: DONE**

Implemented at `/api/v1/secrets`:
- `GET /` - List user's secrets (values redacted)
- `POST /` - Create new secret
- `PATCH /:id` - Update secret
- `DELETE /:id` - Delete secret

### Auth Routes

Implemented at `/api/v1/auth`:
- `POST /register` - Create account, returns tokens
- `POST /login` - Authenticate, returns tokens
- `POST /refresh` - Refresh access token (token rotation)
- `POST /logout` - Invalidate refresh token
- `POST /logout-all` - Invalidate all user sessions
- `GET /me` - Get current user profile

### Files Created

```
apps/backend/src/
  adapters/storage/
    user-repository.ts          # DONE
    refresh-token-repository.ts # DONE
    user-secret-repository.ts   # DONE
  application/services/
    auth-service.ts             # DONE
    secrets-service.ts          # DONE
  api/
    http/
      routes/
        auth.ts                 # DONE (24 tests)
        secrets.ts              # DONE
      middleware/
        auth.ts                 # DONE
        error-handler.ts        # DONE
  infrastructure/crypto/
    secrets.ts                  # DONE
  domain/
    errors/                     # DONE (shared-types)
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

### Status: PARTIAL (OpenTelemetry Complete)

### OpenTelemetry Tracing

**Status: DONE**

Full distributed tracing implementation with:

**Core Infrastructure:**
- `apps/backend/src/infrastructure/observability/tracing.ts` - SDK initialization
- `apps/backend/src/infrastructure/observability/hono-tracing.ts` - HTTP middleware
- `apps/backend/src/infrastructure/observability/index.ts` - Public exports

**Features:**
- Console span exporter (default) with optional OTLP export
- Auto-instrumentation for HTTP and PostgreSQL
- Custom spans for LLM calls (`VercelAIAdapter`)
- Custom spans for MCP tool invocations (`MCPClientAdapter`)
- Custom spans for orchestrator runs (`OrchestratorService`)
- Trace context in logs (`logger.ts` includes `trace_id` and `span_id`)
- W3C Trace Context propagation
- `x-trace-id` response header for client correlation

**Configuration (via environment variables):**
- `OTEL_ENABLED` - Enable/disable tracing (default: true)
- `OTEL_EXPORTER_OTLP_ENDPOINT` - OTLP endpoint (if not set, uses console)
- `OTEL_SERVICE_NAME` - Service name (default: project-jarvis-backend)
- `OTEL_SERVICE_VERSION` - Service version (default: 1.0.0)
- `OTEL_DEBUG` - Enable debug logging (default: false)

**Dependencies Added:**
- @opentelemetry/api
- @opentelemetry/sdk-node
- @opentelemetry/sdk-trace-node
- @opentelemetry/resources
- @opentelemetry/semantic-conventions
- @opentelemetry/instrumentation-http
- @opentelemetry/instrumentation-pg
- @opentelemetry/exporter-trace-otlp-http

### Row-Level Security

**Status: NOT STARTED**

### PII Redaction

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

6. **~~JWT Authentication~~** **DONE**
   - `AuthService` with bcrypt password hashing (12 rounds)
   - JWT access tokens with configurable expiry
   - Refresh token rotation with SHA-256 hashed storage
   - Real JWT validation in auth middleware
   - 24 passing integration tests

7. **~~OpenTelemetry Tracing~~** **DONE**
   - Full SDK setup with console/OTLP export
   - HTTP request tracing via Hono middleware
   - PostgreSQL query auto-instrumentation
   - Custom spans for LLM calls, MCP tools, orchestrator runs
   - Log correlation with trace_id and span_id

### High Priority (Remaining)

1. **Replace `InMemoryOrchestratorStateRepository`**
   - Create `PostgresOrchestratorState` implementing `OrchestratorStatePort`
   - Persist runs, plans, agent states
   - Located at `apps/backend/src/adapters/orchestrator/`

### Medium Priority (Remaining)

2. **Add Rate Limiting**
   - Per-IP global limits
   - Per-user request limits
   - Agent run concurrency limits
   - `RateLimitError` class already exists

---

## Testing Checklist

### Unit Tests
- [x] Auth service (register, login, refresh, logout) - 24 tests in auth.test.ts
- [ ] Secrets encryption/decryption
- [x] Repository CRUD operations (PgMemoryStore, PgKnowledgeGraph have tests)
- [ ] Rate limiting logic
- [x] Tool permission repository

### Integration Tests
- [x] Auth flow end-to-end - Full coverage in auth.test.ts
- [x] Secrets API
- [x] SSE event streaming
- [x] Vector similarity search (PgMemoryStore.test.ts)
- [x] Tool permissions API
- [x] Usage API

### Security Tests
- [x] JWT validation edge cases - Covered in auth.test.ts
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
- **Completed:** JWT payload format documented (see `TokenPayload` in auth-service.ts)

### JWT Token Format

Access tokens contain the following payload:
```typescript
interface TokenPayload {
  userId: string;  // UUID
  email: string;   // User's email address
}
```

Tokens are signed with `JWT_SECRET` and expire according to `JWT_ACCESS_EXPIRY` (default: 15m).

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
