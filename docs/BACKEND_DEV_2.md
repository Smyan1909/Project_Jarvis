# Backend Developer 2 - Implementation Guide

## Role Overview

You are responsible for the **agent core layer** of Project Jarvis:
- Domain entities and shared types
- Port interfaces (contracts)
- LLM adapters (via Vercel AI SDK)
- Orchestrator service and agent loop
- Tool registry and invocation
- Memory and Knowledge Graph services
- MCP client integration (future)

---

## Implementation Status

> **Last Updated:** February 2026

### Completed (Weeks 1-4)

| Week | Component | Status | Notes |
|------|-----------|--------|-------|
| 1 | Domain Entities | **DONE** | `packages/shared-types/src/domain/` |
| 1 | Port Interfaces | **DONE** | `apps/backend/src/ports/` |
| 1 | Error Types | **DONE** | `packages/shared-types/src/errors/` |
| 1 | API Types | **DONE** | `packages/shared-types/src/api/` |
| 2 | LLM Adapter | **DONE** | Using Vercel AI SDK (not direct OpenAI/Claude SDKs) |
| 2 | LLM Router | **DONE** | `LLMRouterService.ts` |
| 3 | Orchestrator Service | **DONE** | Full agent loop with task planning |
| 3 | Tool Registry | **DONE** | Central registry with built-in tools |
| 3 | Event Streaming | **DONE** | SSE via Hono streaming (not WebSocket) |
| 4 | Memory Store | **DONE** | In-memory with embeddings |
| 4 | Knowledge Graph | **DONE** | In-memory with graph traversal |
| 4 | Memory/KG Tools | **DONE** | remember, recall, kg_* tools |

### Not Yet Implemented

| Week | Component | Status | Notes |
|------|-----------|--------|-------|
| 5 | MCP Integration | **NOT STARTED** | Deferred |
| 5 | Composio Integration | **NOT STARTED** | Deferred |
| 6 | Monitor Agent | **NOT STARTED** | Safety checks |
| 6 | Budget Controls | **NOT STARTED** | Policy enforcement |

---

## Architecture Overview

### Key Differences from Original Plan

1. **LLM Integration**: Uses **Vercel AI SDK** instead of direct OpenAI/Claude SDKs
   - Single adapter supporting multiple providers
   - Unified streaming interface via `streamText()`
   - Located in `apps/backend/src/adapters/llm/VercelAIAdapter.ts`

2. **Event Streaming**: Uses **Server-Sent Events (SSE)** instead of WebSocket
   - Simpler architecture, no socket.io dependency
   - Uses Hono's built-in streaming support
   - Event types defined in `OrchestratorEventType`

3. **Framework**: Uses **Hono** instead of Express
   - Lightweight, edge-compatible
   - Built-in streaming support
   - Type-safe routing

4. **Orchestrator Architecture**: Implements an autonomous multi-agent orchestrator
   - Orchestrator analyzes requests and creates task plans (DAGs)
   - Can spawn specialized sub-agents (general, research, coding, etc.)
   - Monitors sub-agents and can intervene when needed

---

## Current File Structure

```
apps/backend/src/
├── adapters/
│   ├── embedding/
│   │   └── VercelEmbeddingAdapter.ts      # Embedding generation
│   ├── kg/
│   │   ├── InMemoryKnowledgeGraph.ts      # KG port implementation
│   │   └── index.ts
│   ├── llm/
│   │   ├── VercelAIAdapter.ts             # LLM port implementation
│   │   └── tools.ts                       # Zod schema conversion
│   ├── memory/
│   │   ├── InMemoryMemoryStore.ts         # Memory port implementation
│   │   └── index.ts
│   └── orchestrator/
│       ├── InMemoryOrchestratorCache.ts   # Run caching
│       ├── InMemoryOrchestratorState.ts   # State persistence
│       └── SSEEventStreamAdapter.ts       # SSE streaming
├── api/
│   └── http/
│       ├── middleware/
│       │   └── auth.ts                    # JWT validation (placeholder)
│       └── routes/
│           ├── chat.ts                    # Basic chat endpoint
│           ├── health.ts                  # Health checks
│           └── orchestrator.ts            # Main orchestrator API
├── application/
│   └── services/
│       ├── LLMRouterService.ts            # Model routing
│       ├── LoopDetectionService.ts        # Prevents infinite loops
│       ├── MemoryTools.ts                 # Memory & KG tool registration
│       ├── OrchestratorService.ts         # Main orchestrator logic
│       ├── SubAgentManager.ts             # Sub-agent lifecycle
│       ├── SubAgentRunner.ts              # Sub-agent execution
│       ├── TaskPlanService.ts             # DAG task planning
│       ├── ToolRegistry.ts                # Central tool registry
│       └── WebTools.ts                    # Web search/fetch tools
├── domain/
│   └── orchestrator/
│       ├── AgentScopes.ts                 # Sub-agent type definitions
│       ├── OrchestratorTools.ts           # Orchestrator-only tools
│       └── prompts.ts                     # System prompts
├── infrastructure/
│   ├── ai/
│   │   ├── config.ts                      # Model configuration
│   │   └── registry.ts                    # Provider registry
│   ├── config/
│   │   └── index.ts                       # Environment config
│   ├── db/
│   │   └── schema.ts                      # Drizzle schema
│   └── logging/
│       └── logger.ts                      # Structured logging
├── ports/
│   ├── EmbeddingPort.ts
│   ├── EventStreamPort.ts
│   ├── KnowledgeGraphPort.ts
│   ├── LLMProviderPort.ts
│   ├── MemoryStorePort.ts
│   ├── OrchestratorCachePort.ts
│   ├── OrchestratorStatePort.ts
│   └── ToolInvokerPort.ts
└── index.ts                               # Entry point
```

---

## API Endpoints

### Orchestrator API

```
POST /api/v1/orchestrator/run
  Request: { input: string }
  Response: SSE stream with events

GET /api/v1/orchestrator/runs (NOT IMPLEMENTED)
  List user's runs

GET /api/v1/orchestrator/run/:id/messages (NOT IMPLEMENTED)
  Get run messages
```

### SSE Event Types

```typescript
type OrchestratorEventType =
  | 'orchestrator.started'      // Run started
  | 'orchestrator.thinking'     // LLM processing
  | 'orchestrator.tool_call'    // Tool invocation
  | 'orchestrator.tool_result'  // Tool result
  | 'orchestrator.response'     // Partial response
  | 'orchestrator.agent_spawned'// Sub-agent created
  | 'orchestrator.agent_update' // Sub-agent status
  | 'orchestrator.complete'     // Run completed
  | 'orchestrator.error'        // Error occurred
```

---

## Tools Registry

### Registered Tools (Available to Sub-Agents)

| Tool | Category | Description |
|------|----------|-------------|
| `get_current_time` | builtin | Get current date/time in any timezone |
| `calculate` | builtin | Safe mathematical expression evaluation |
| `remember` | memory | Store information for later retrieval |
| `recall` | memory | Search memories by semantic similarity |
| `kg_create_entity` | kg | Create entities (person, place, org, etc.) |
| `kg_create_relation` | kg | Create relationships between entities |
| `kg_query` | kg | Search the knowledge graph |
| `kg_get_entity` | kg | Get entity with all relationships |
| `web_search` | web | Search the web via Tavily API (optional) |
| `web_fetch` | web | Fetch URL content (html/markdown/text) |

### Orchestrator-Only Tools

| Tool | Description |
|------|-------------|
| `create_task_plan` | Create a DAG of tasks |
| `modify_plan` | Update or reorder tasks |
| `start_agent` | Spawn a sub-agent |
| `monitor_agent` | Check sub-agent status |
| `intervene_agent` | Redirect a sub-agent |
| `cancel_agent` | Stop a sub-agent |
| `mark_task_complete` | Mark task as done |
| `mark_task_failed` | Mark task as failed |
| `store_memory` | Save to memory store |
| `respond_to_user` | Send response to user |
| `get_plan_status` | Get current plan state |

---

## Key Implementation Details

### LLM Adapter (VercelAIAdapter)

Uses Vercel AI SDK's `streamText()` for unified streaming across providers:

```typescript
// apps/backend/src/adapters/llm/VercelAIAdapter.ts
import { streamText, generateText } from 'ai';
import { openai } from '@ai-sdk/openai';
import { anthropic } from '@ai-sdk/anthropic';

export class VercelAIAdapter implements LLMProviderPort {
  async *stream(messages, options): AsyncGenerator<StreamChunk> {
    const result = await streamText({
      model: this.getModel(),
      messages: convertMessagesToCore(messages),
      tools: options?.tools ? convertToolsToZod(options.tools) : undefined,
    });
    // ... yield chunks
  }
}
```

### Tool Schema Conversion

Converts `ToolDefinition` to Zod schemas for OpenAI strict mode:

```typescript
// apps/backend/src/adapters/llm/tools.ts
export function convertToolsToZod(tools: ToolDefinition[]): Record<string, CoreTool> {
  return Object.fromEntries(
    tools.map(tool => [
      tool.name,
      {
        description: tool.description,
        parameters: parametersToZod(tool.parameters),
      }
    ])
  );
}
```

### Orchestrator Service

Main agent loop with tool execution:

```typescript
// apps/backend/src/application/services/OrchestratorService.ts
async *run(input: string, context: OrchestratorContext): AsyncGenerator<OrchestratorEvent> {
  // 1. Analyze request
  // 2. Decide: direct response or task plan
  // 3. If task plan: create DAG, spawn sub-agents
  // 4. Execute tool calls in loop
  // 5. Monitor sub-agents
  // 6. Return response via respond_to_user tool
}
```

### Memory Store (In-Memory)

Implements semantic search with cosine similarity:

```typescript
// apps/backend/src/adapters/memory/InMemoryMemoryStore.ts
async search(userId: string, query: string, limit: number): Promise<MemorySearchResult[]> {
  const queryEmbedding = await this.embeddingAdapter.embed(query);
  const userMemories = this.memories.filter(m => m.userId === userId);
  
  // Calculate cosine similarity
  const scored = userMemories.map(m => ({
    ...m,
    similarity: cosineSimilarity(queryEmbedding, m.embedding)
  }));
  
  return scored.sort((a, b) => b.similarity - a.similarity).slice(0, limit);
}
```

---

## Configuration

### Model Configuration

```typescript
// apps/backend/src/infrastructure/ai/config.ts
export const DEFAULT_MODELS = {
  chat: 'openai:gpt-4o-mini',
  powerful: 'openai:gpt-4.1',  // Used by orchestrator
  fast: 'openai:gpt-4o-mini',
  embedding: 'openai:text-embedding-3-small',
};
```

### Environment Variables

```bash
# .env
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
TAVILY_API_KEY=tvly-...        # Optional, for web_search
LOG_LEVEL=info                 # debug for verbose logs
```

---

## Testing

### Manual Testing

```bash
# Start server
cd apps/backend && pnpm dev

# Test orchestrator
curl -N -X POST http://localhost:3000/api/v1/orchestrator/run \
  -H "Content-Type: application/json" \
  -d '{"input": "What time is it?"}'
```

### Expected Response (SSE)

```
data: {"type":"orchestrator.started","runId":"...","timestamp":"..."}

data: {"type":"orchestrator.thinking","content":"Analyzing request..."}

data: {"type":"orchestrator.tool_call","toolName":"get_current_time","input":{}}

data: {"type":"orchestrator.tool_result","toolName":"get_current_time","result":{...}}

data: {"type":"orchestrator.complete","response":"The current time is...","usage":{...}}
```

---

## Remaining TODOs

Found in codebase:

| File | Line | TODO |
|------|------|------|
| `OrchestratorService.ts` | 506 | Implement update and reorder for plan modifications |
| `ToolRegistry.ts` | 108 | Add user-level permission checks |
| `ToolRegistry.ts` | 182 | Implement user-level permission checks |
| `SubAgentRunner.ts` | 311 | Get actual user ID from context |
| `SubAgentRunner.ts` | 372 | Get actual user ID for tool retrieval |

---

## Next Steps

### High Priority

1. **Add missing API endpoints**
   - `GET /api/v1/orchestrator/runs` - List user's runs
   - `GET /api/v1/orchestrator/run/:id/messages` - Get run messages

2. **Implement real authentication**
   - Replace placeholder JWT validation in `auth.ts`
   - Extract user ID from validated tokens

3. **Add PostgreSQL persistence**
   - Replace `InMemoryMemoryStore` with Postgres + pgvector
   - Replace `InMemoryKnowledgeGraph` with Postgres
   - Replace `InMemoryOrchestratorStateRepository` with Postgres

### Medium Priority

4. **Add unit tests**
   - ToolRegistry
   - MemoryStore
   - KnowledgeGraph
   - OrchestratorService

5. **Implement plan modifications**
   - Update and reorder operations in `OrchestratorService`

### Lower Priority

6. **MCP Integration** (Week 5 of original plan)
7. **Monitor Agent & Safety** (Week 6 of original plan)

---

## Coordination with Other Developers

### With Backend Dev 1
- Auth middleware integration (JWT validation)
- Database migrations for orchestrator state
- Rate limiting for orchestrator endpoint

### With Frontend Dev
- SSE event format documentation (not WebSocket)
- API endpoint documentation
- Error response format

---

## Quick Reference

### Build Commands

```bash
# Build shared-types (if modified)
cd packages/shared-types && pnpm build

# Build backend
cd apps/backend && pnpm build

# Run in development
cd apps/backend && pnpm dev

# Type check
cd apps/backend && pnpm typecheck
```

### Key Files for Reference

| Purpose | File |
|---------|------|
| Orchestrator API | `apps/backend/src/api/http/routes/orchestrator.ts` |
| Main orchestrator logic | `apps/backend/src/application/services/OrchestratorService.ts` |
| Orchestrator-only tools | `apps/backend/src/domain/orchestrator/OrchestratorTools.ts` |
| System prompts | `apps/backend/src/domain/orchestrator/prompts.ts` |
| Tool registry | `apps/backend/src/application/services/ToolRegistry.ts` |
| Memory tools | `apps/backend/src/application/services/MemoryTools.ts` |
| Web tools | `apps/backend/src/application/services/WebTools.ts` |
| LLM adapter | `apps/backend/src/adapters/llm/VercelAIAdapter.ts` |
| Memory store | `apps/backend/src/adapters/memory/InMemoryMemoryStore.ts` |
| Knowledge graph | `apps/backend/src/adapters/kg/InMemoryKnowledgeGraph.ts` |
