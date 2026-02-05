# Project Jarvis - Implementation Plan

## Overview

This document provides the high-level project plan for Project Jarvis, a multi-agent personal assistant system. The project is divided among three developers over 6 weeks.

## Team Structure

| Developer | Focus Area | Guide Document |
|-----------|------------|----------------|
| **Backend Dev 1** | Infrastructure, DB, Auth, Secrets | [BACKEND_DEV_1.md](./BACKEND_DEV_1.md) |
| **Backend Dev 2** | Agent Core, LLM, Tools, MCP | [BACKEND_DEV_2.md](./BACKEND_DEV_2.md) |
| **Frontend Dev** | Mobile App (React Native) | [FRONTEND_DEV.md](./FRONTEND_DEV.md) |

## Tech Stack

| Layer | Technology |
|-------|------------|
| **Auth** | JWT + refresh tokens |
| **Database** | Postgres + pgvector + Drizzle ORM |
| **Secrets Encryption** | AES-256-GCM (app-level, master key from env) |
| **Backend** | TypeScript, Node.js |
| **Mobile** | React Native (Expo) |

## Domain Models

All domain models are defined in `packages/shared-types/src/domain/`.

### User Domain

```typescript
interface User {
  id: string;
  email: string;
  passwordHash: string;
  displayName: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface UserSecret {
  id: string;
  userId: string;
  provider: 'openai' | 'anthropic' | 'composio' | 'github' | 'custom';
  name: string;
  encryptedValue: string;  // AES-256-GCM
  iv: string;
  authTag: string;
  createdAt: Date;
  updatedAt: Date;
}

interface RefreshToken {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  createdAt: Date;
}
```

### Agent Domain

```typescript
interface AgentRun {
  id: string;
  userId: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  totalTokens: number;
  totalCost: number;
  startedAt: Date;
  completedAt: Date | null;
}

interface Message {
  id: string;
  runId: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  toolCallId: string | null;
  createdAt: Date;
}

interface ToolCall {
  id: string;
  runId: string;
  toolId: string;
  input: Record<string, unknown>;
  output: Record<string, unknown> | null;
  status: 'pending' | 'success' | 'error';
  durationMs: number | null;
  createdAt: Date;
}
```

### Memory Domain

```typescript
interface MemoryItem {
  id: string;
  userId: string;
  content: string;
  embedding: number[];  // pgvector (1536 dimensions)
  metadata: Record<string, unknown>;
  createdAt: Date;
}
```

### Knowledge Graph Domain

```typescript
interface KGEntity {
  id: string;
  userId: string;
  type: string;  // 'person' | 'place' | 'concept' | 'event'
  name: string;
  properties: Record<string, unknown>;
  embedding: number[] | null;
  createdAt: Date;
  updatedAt: Date;
}

interface KGRelation {
  id: string;
  userId: string;
  sourceId: string;
  targetId: string;
  type: string;  // 'knows' | 'works_at' | 'located_in'
  properties: Record<string, unknown>;
  createdAt: Date;
}
```

## Phase Overview

```
Week 1: Foundation     - All parallel (DB, domains, mobile scaffold)
Week 2: Infrastructure - Auth, secrets, LLM adapters, mobile auth
Week 3: Agent Core     - Orchestrator, WebSocket, chat UI
Week 4: Memory & KG    - Vector search, knowledge graph, settings
Week 5: MCP & Tools    - External tool integration, OAuth
Week 6: Polish         - Security, monitoring, media, accessibility
```

## Dependency Graph

```
Phase 0 (Foundation) - Week 1
    |
    +---------------------------+
    v                           v
Phase 1 (Auth/Secrets)    Phase 1 (LLM Adapters)
    |                           |
    +-----------+---------------+
                v
          Phase 2 (Agent Core) - Week 3
                |
    +-----------+-----------+
    v                       v
Phase 3 (Memory/KG)   Phase 4 (MCP/Tools)
    |                       |
    +-----------+-----------+
                v
          Phase 5 (Polish) - Week 6
```

## Critical Integration Points

### Week 1: Port Interface Agreement
All developers must agree on port interfaces before proceeding:
- `LLMProviderPort`
- `ToolInvokerPort`
- `MemoryStorePort`
- `KnowledgeGraphPort`
- `EventStreamPort`

### Week 2: Auth Token Format
Backend Dev 1 and Frontend Dev must sync on:
- JWT payload structure
- Refresh token flow
- API error response format

### Week 3: WebSocket Event Format
All developers must sync on:
- Event type discriminated union (already in shared-types)
- Connection/authentication flow
- Reconnection strategy

### Week 4: Memory Integration
Backend Dev 1 (storage) and Backend Dev 2 (services) must sync on:
- Vector dimension size (1536 for OpenAI `text-embedding-3-small`)
- Search query interface
- Pagination strategy

## Communication Schedule

| Sync Point | When | Attendees | Purpose |
|------------|------|-----------|---------|
| Daily standup | 9:00 AM | All | 15-min progress check |
| Backend sync | Fri Week 1 | BE1 + BE2 | Port interface review |
| Auth sync | Wed Week 2 | BE1 + FE | Token format agreement |
| Integration | Wed Week 3 | All | WebSocket + Orchestrator |
| Demo | Fri Week 4 | All | Memory/KG demo |
| Feature freeze | Wed Week 5 | All | Lock scope for polish |
| Launch prep | Fri Week 6 | All | Final review |

## Shared Conventions

### File Naming
- Use `kebab-case` for files: `user-secret.ts`
- Use `PascalCase` for classes/interfaces: `UserSecret`
- Use `camelCase` for functions/variables: `encryptSecret`

### Error Handling
```typescript
class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public statusCode: number = 500
  ) {
    super(message);
  }
}

// Usage
throw new AppError('USER_NOT_FOUND', 'User not found', 404);
```

### API Response Format
```typescript
// Success
{ data: T }

// Error
{ error: { code: string; message: string } }

// Paginated
{ data: T[]; pagination: { total: number; page: number; limit: number } }
```

## Git Workflow

1. Create feature branches from `main`: `feat/<week>-<feature>`
2. Open PR when ready for review
3. Require 1 approval from another developer
4. Squash and merge to `main`

## Risk Mitigation

| Risk | Mitigation | Owner |
|------|------------|-------|
| LLM API changes | Abstract behind ports | BE2 |
| MCP complexity | Start with 1-2 simple tools | BE2 |
| Mobile performance | Profile early | FE |
| Secret leakage | Never log decrypted values | BE1 |
| Scope creep | Strict MVP scope | All |

## Definition of Done

Each task is complete when:
- [ ] Code is written and passes TypeScript checks
- [ ] Unit tests cover happy path + error cases
- [ ] Integration point tested with dependent code
- [ ] PR reviewed and merged
- [ ] Documentation updated if needed
