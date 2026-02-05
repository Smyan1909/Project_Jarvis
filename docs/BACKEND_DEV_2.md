# Backend Developer 2 - Implementation Guide

## Role Overview

You are responsible for the **agent core layer** of Project Jarvis:
- Domain entities and shared types
- Port interfaces (contracts)
- LLM adapters (OpenAI, Claude) with streaming
- Orchestrator service and agent loop
- Tool registry and invocation
- Memory and Knowledge Graph services
- MCP client integration

## Weekly Breakdown

---

## Week 1: Foundation

### Objectives
- Define all domain entities in shared-types
- Create port interfaces
- Set up error handling and validation

### Day 1-2: Domain Entities

**Update `packages/shared-types/src/index.ts`:**
```typescript
// Re-export everything
export * from './domain';
export * from './api';
export * from './errors';
```

**Create `packages/shared-types/src/domain/index.ts`:**
```typescript
export * from './user';
export * from './agent';
export * from './memory';
export * from './kg';
```

**Create `packages/shared-types/src/domain/user.ts`:**
```typescript
export interface User {
  id: string;
  email: string;
  passwordHash: string;
  displayName: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserSecret {
  id: string;
  userId: string;
  provider: SecretProvider;
  name: string;
  encryptedValue: string;
  iv: string;
  authTag: string;
  createdAt: Date;
  updatedAt: Date;
}

export type SecretProvider = 'openai' | 'anthropic' | 'composio' | 'github' | 'custom';

export interface RefreshToken {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  createdAt: Date;
}
```

**Create `packages/shared-types/src/domain/agent.ts`:**
```typescript
export interface AgentRun {
  id: string;
  userId: string;
  status: AgentRunStatus;
  totalTokens: number;
  totalCost: number;
  startedAt: Date;
  completedAt: Date | null;
}

export type AgentRunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface Message {
  id: string;
  runId: string;
  role: MessageRole;
  content: string;
  toolCallId: string | null;
  createdAt: Date;
}

export type MessageRole = 'user' | 'assistant' | 'system' | 'tool';

export interface ToolCall {
  id: string;
  runId: string;
  toolId: string;
  input: Record<string, unknown>;
  output: Record<string, unknown> | null;
  status: ToolCallStatus;
  durationMs: number | null;
  createdAt: Date;
}

export type ToolCallStatus = 'pending' | 'success' | 'error';

// LLM types
export interface LLMMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  toolCallId?: string;
  toolCalls?: LLMToolCall[];
}

export interface LLMToolCall {
  id: string;
  name: string;
  arguments: string; // JSON string
}

export interface LLMResponse {
  content: string | null;
  toolCalls: LLMToolCall[];
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  finishReason: 'stop' | 'tool_calls' | 'length' | 'error';
}

// Tool types
export interface ToolDefinition {
  id: string;
  name: string;
  description: string;
  parameters: ToolParameters;
}

export interface ToolParameters {
  type: 'object';
  properties: Record<string, ToolParameter>;
  required?: string[];
}

export interface ToolParameter {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description?: string;
  enum?: string[];
  items?: ToolParameter;
}

export interface ToolResult {
  success: boolean;
  output: unknown;
  error?: string;
}
```

**Create `packages/shared-types/src/domain/memory.ts`:**
```typescript
export interface MemoryItem {
  id: string;
  userId: string;
  content: string;
  embedding: number[];
  metadata: Record<string, unknown>;
  createdAt: Date;
}

export interface MemorySearchResult {
  id: string;
  content: string;
  metadata: Record<string, unknown>;
  similarity: number;
  createdAt: Date;
}
```

**Create `packages/shared-types/src/domain/kg.ts`:**
```typescript
export interface KGEntity {
  id: string;
  userId: string;
  type: string;
  name: string;
  properties: Record<string, unknown>;
  embedding: number[] | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface KGRelation {
  id: string;
  userId: string;
  sourceId: string;
  targetId: string;
  type: string;
  properties: Record<string, unknown>;
  createdAt: Date;
}

export interface KGSearchResult {
  entity: KGEntity;
  relations: KGRelation[];
  relatedEntities: KGEntity[];
}
```

### Day 2-3: API Types

**Create `packages/shared-types/src/api/index.ts`:**
```typescript
export * from './requests';
export * from './responses';
export * from './events';
```

**Create `packages/shared-types/src/api/requests.ts`:**
```typescript
export interface AgentRunRequest {
  userId: string;
  input: string;
  context?: {
    previousRunId?: string;
    systemPrompt?: string;
  };
}

export interface SendMessageRequest {
  content: string;
}

export interface CreateSecretRequest {
  provider: 'openai' | 'anthropic' | 'composio' | 'github' | 'custom';
  name: string;
  value: string;
}

export interface UpdateSecretRequest {
  name?: string;
  value?: string;
}
```

**Create `packages/shared-types/src/api/responses.ts`:**
```typescript
export interface ApiResponse<T> {
  data: T;
}

export interface ApiError {
  error: {
    code: string;
    message: string;
  };
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    hasMore: boolean;
  };
}

export interface AgentRunResponse {
  id: string;
  status: string;
  startedAt: string;
}

export interface SecretResponse {
  id: string;
  provider: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}
```

**Update `packages/shared-types/src/api/events.ts`:**
```typescript
// Already exists, but expand it
export type AgentEvent =
  | AgentTokenEvent
  | AgentToolCallEvent
  | AgentToolResultEvent
  | AgentFinalEvent
  | AgentErrorEvent
  | AgentStatusEvent;

export interface AgentTokenEvent {
  type: 'agent.token';
  token: string;
}

export interface AgentToolCallEvent {
  type: 'agent.tool_call';
  toolId: string;
  toolName: string;
  input: unknown;
}

export interface AgentToolResultEvent {
  type: 'agent.tool_result';
  toolId: string;
  output: unknown;
  success: boolean;
}

export interface AgentFinalEvent {
  type: 'agent.final';
  content: string;
  usage?: {
    totalTokens: number;
    totalCost: number;
  };
}

export interface AgentErrorEvent {
  type: 'agent.error';
  message: string;
  code?: string;
}

export interface AgentStatusEvent {
  type: 'agent.status';
  status: 'running' | 'completed' | 'failed' | 'cancelled';
}
```

### Day 3-4: Error Types

**Create `packages/shared-types/src/errors/index.ts`:**
```typescript
export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 500,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'AppError';
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON() {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details && { details: this.details }),
      },
    };
  }
}

// Common errors
export class NotFoundError extends AppError {
  constructor(resource: string, id?: string) {
    super(
      `${resource.toUpperCase()}_NOT_FOUND`,
      id ? `${resource} with id ${id} not found` : `${resource} not found`,
      404
    );
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super('UNAUTHORIZED', message, 401);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super('FORBIDDEN', message, 403);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('VALIDATION_ERROR', message, 400, details);
  }
}

export class RateLimitError extends AppError {
  constructor(retryAfter?: number) {
    super('RATE_LIMIT_EXCEEDED', 'Too many requests', 429, { retryAfter });
  }
}

export class LLMError extends AppError {
  constructor(provider: string, message: string, details?: Record<string, unknown>) {
    super('LLM_ERROR', `${provider}: ${message}`, 502, details);
  }
}

export class ToolError extends AppError {
  constructor(toolId: string, message: string) {
    super('TOOL_ERROR', `Tool ${toolId}: ${message}`, 500);
  }
}
```

### Day 4-5: Port Interfaces

**Create `apps/backend/src/ports/LLMProviderPort.ts`:**
```typescript
import type { LLMMessage, LLMResponse, ToolDefinition } from '@project-jarvis/shared-types';

export interface LLMProviderPort {
  /**
   * Generate a response from the LLM
   */
  generate(
    messages: LLMMessage[],
    options?: GenerateOptions
  ): Promise<LLMResponse>;

  /**
   * Stream a response from the LLM
   */
  stream(
    messages: LLMMessage[],
    options?: GenerateOptions
  ): AsyncGenerator<StreamChunk, void, unknown>;

  /**
   * Get the model name
   */
  getModel(): string;

  /**
   * Calculate cost for token usage
   */
  calculateCost(promptTokens: number, completionTokens: number): number;
}

export interface GenerateOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  tools?: ToolDefinition[];
  systemPrompt?: string;
}

export type StreamChunk =
  | { type: 'token'; token: string }
  | { type: 'tool_call'; toolCall: { id: string; name: string; arguments: string } }
  | { type: 'done'; response: LLMResponse };
```

**Create `apps/backend/src/ports/ToolInvokerPort.ts`:**
```typescript
import type { ToolDefinition, ToolResult } from '@project-jarvis/shared-types';

export interface ToolInvokerPort {
  /**
   * Get all available tools for a user
   */
  getTools(userId: string): Promise<ToolDefinition[]>;

  /**
   * Invoke a tool with the given input
   */
  invoke(
    userId: string,
    toolId: string,
    input: Record<string, unknown>
  ): Promise<ToolResult>;

  /**
   * Check if a user has permission to use a tool
   */
  hasPermission(userId: string, toolId: string): Promise<boolean>;
}
```

**Create `apps/backend/src/ports/MemoryStorePort.ts`:**
```typescript
import type { MemoryItem, MemorySearchResult } from '@project-jarvis/shared-types';

export interface MemoryStorePort {
  /**
   * Store a new memory
   */
  store(
    userId: string,
    content: string,
    metadata?: Record<string, unknown>
  ): Promise<MemoryItem>;

  /**
   * Search memories by semantic similarity
   */
  search(
    userId: string,
    query: string,
    limit?: number
  ): Promise<MemorySearchResult[]>;

  /**
   * Get recent memories
   */
  getRecent(
    userId: string,
    limit?: number
  ): Promise<MemoryItem[]>;

  /**
   * Delete a memory
   */
  delete(userId: string, memoryId: string): Promise<void>;
}
```

**Create `apps/backend/src/ports/KnowledgeGraphPort.ts`:**
```typescript
import type { KGEntity, KGRelation, KGSearchResult } from '@project-jarvis/shared-types';

export interface KnowledgeGraphPort {
  /**
   * Create an entity
   */
  createEntity(
    userId: string,
    type: string,
    name: string,
    properties?: Record<string, unknown>
  ): Promise<KGEntity>;

  /**
   * Create a relation between entities
   */
  createRelation(
    userId: string,
    sourceId: string,
    targetId: string,
    type: string,
    properties?: Record<string, unknown>
  ): Promise<KGRelation>;

  /**
   * Search entities by semantic similarity
   */
  searchEntities(
    userId: string,
    query: string,
    type?: string,
    limit?: number
  ): Promise<KGEntity[]>;

  /**
   * Get entity with related entities
   */
  getEntityWithRelations(
    userId: string,
    entityId: string,
    depth?: number
  ): Promise<KGSearchResult | null>;

  /**
   * Query the knowledge graph
   */
  query(
    userId: string,
    query: string
  ): Promise<KGSearchResult[]>;
}
```

**Create `apps/backend/src/ports/EmbeddingPort.ts`:**
```typescript
export interface EmbeddingPort {
  /**
   * Generate embedding for text
   */
  embed(text: string): Promise<number[]>;

  /**
   * Generate embeddings for multiple texts
   */
  embedBatch(texts: string[]): Promise<number[][]>;

  /**
   * Get the dimension of embeddings
   */
  getDimension(): number;
}
```

**Create `apps/backend/src/ports/EventStreamPort.ts`:**
```typescript
import type { AgentEvent } from '@project-jarvis/shared-types';

export interface EventStreamPort {
  /**
   * Publish an event for a specific run
   */
  publish(userId: string, runId: string, event: AgentEvent): Promise<void>;

  /**
   * Convenience methods
   */
  publishToken(userId: string, runId: string, token: string): Promise<void>;
  publishToolCall(userId: string, runId: string, toolId: string, toolName: string, input: unknown): Promise<void>;
  publishToolResult(userId: string, runId: string, toolId: string, output: unknown, success: boolean): Promise<void>;
  publishFinal(userId: string, runId: string, content: string, usage?: { totalTokens: number; totalCost: number }): Promise<void>;
  publishError(userId: string, runId: string, message: string, code?: string): Promise<void>;
  publishStatus(userId: string, runId: string, status: 'running' | 'completed' | 'failed' | 'cancelled'): Promise<void>;
}
```

### Files to Create This Week

```
packages/shared-types/src/
  index.ts (update)
  domain/
    index.ts
    user.ts
    agent.ts
    memory.ts
    kg.ts
  api/
    index.ts
    requests.ts
    responses.ts
    events.ts (update)
  errors/
    index.ts

apps/backend/src/ports/
  LLMProviderPort.ts
  ToolInvokerPort.ts
  MemoryStorePort.ts
  KnowledgeGraphPort.ts
  EmbeddingPort.ts
  EventStreamPort.ts
  index.ts
```

---

## Week 2: LLM Adapters

### Objectives
- Implement OpenAI adapter with streaming
- Implement Claude adapter with streaming
- Create LLM router for model selection

### Day 1-2: OpenAI Adapter

**Install OpenAI SDK:**
```bash
pnpm add openai
```

**Create `apps/backend/src/adapters/llm/openai-adapter.ts`:**
```typescript
import OpenAI from 'openai';
import type { LLMProviderPort, GenerateOptions, StreamChunk } from '../../ports/LLMProviderPort';
import type { LLMMessage, LLMResponse, LLMToolCall, ToolDefinition } from '@project-jarvis/shared-types';
import { LLMError } from '@project-jarvis/shared-types';

// Pricing per 1M tokens (as of 2024)
const PRICING = {
  'gpt-4o': { input: 2.50, output: 10.00 },
  'gpt-4o-mini': { input: 0.15, output: 0.60 },
  'gpt-4-turbo': { input: 10.00, output: 30.00 },
} as const;

export class OpenAIAdapter implements LLMProviderPort {
  private client: OpenAI;
  private model: string;

  constructor(apiKey: string, model = 'gpt-4o-mini') {
    this.client = new OpenAI({ apiKey });
    this.model = model;
  }

  getModel(): string {
    return this.model;
  }

  calculateCost(promptTokens: number, completionTokens: number): number {
    const pricing = PRICING[this.model as keyof typeof PRICING] || PRICING['gpt-4o-mini'];
    const inputCost = (promptTokens / 1_000_000) * pricing.input;
    const outputCost = (completionTokens / 1_000_000) * pricing.output;
    return inputCost + outputCost;
  }

  async generate(messages: LLMMessage[], options?: GenerateOptions): Promise<LLMResponse> {
    try {
      const response = await this.client.chat.completions.create({
        model: options?.model || this.model,
        messages: this.formatMessages(messages, options?.systemPrompt),
        temperature: options?.temperature ?? 0.7,
        max_tokens: options?.maxTokens ?? 4096,
        tools: options?.tools ? this.formatTools(options.tools) : undefined,
      });

      const choice = response.choices[0];
      const toolCalls = choice.message.tool_calls?.map(tc => ({
        id: tc.id,
        name: tc.function.name,
        arguments: tc.function.arguments,
      })) || [];

      return {
        content: choice.message.content,
        toolCalls,
        usage: {
          promptTokens: response.usage?.prompt_tokens || 0,
          completionTokens: response.usage?.completion_tokens || 0,
          totalTokens: response.usage?.total_tokens || 0,
        },
        finishReason: this.mapFinishReason(choice.finish_reason),
      };
    } catch (error: any) {
      throw new LLMError('OpenAI', error.message, { originalError: error.code });
    }
  }

  async *stream(messages: LLMMessage[], options?: GenerateOptions): AsyncGenerator<StreamChunk, void, unknown> {
    try {
      const stream = await this.client.chat.completions.create({
        model: options?.model || this.model,
        messages: this.formatMessages(messages, options?.systemPrompt),
        temperature: options?.temperature ?? 0.7,
        max_tokens: options?.maxTokens ?? 4096,
        tools: options?.tools ? this.formatTools(options.tools) : undefined,
        stream: true,
        stream_options: { include_usage: true },
      });

      let content = '';
      const toolCalls: Map<number, LLMToolCall> = new Map();
      let usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
      let finishReason: LLMResponse['finishReason'] = 'stop';

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;
        
        // Handle content tokens
        if (delta?.content) {
          content += delta.content;
          yield { type: 'token', token: delta.content };
        }

        // Handle tool calls
        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            const existing = toolCalls.get(tc.index) || { id: '', name: '', arguments: '' };
            
            if (tc.id) existing.id = tc.id;
            if (tc.function?.name) existing.name = tc.function.name;
            if (tc.function?.arguments) existing.arguments += tc.function.arguments;
            
            toolCalls.set(tc.index, existing);
          }
        }

        // Handle finish reason
        if (chunk.choices[0]?.finish_reason) {
          finishReason = this.mapFinishReason(chunk.choices[0].finish_reason);
        }

        // Handle usage (comes at the end with stream_options)
        if (chunk.usage) {
          usage = {
            promptTokens: chunk.usage.prompt_tokens,
            completionTokens: chunk.usage.completion_tokens,
            totalTokens: chunk.usage.total_tokens,
          };
        }
      }

      // Emit tool calls
      for (const tc of toolCalls.values()) {
        yield { type: 'tool_call', toolCall: tc };
      }

      // Final response
      yield {
        type: 'done',
        response: {
          content: content || null,
          toolCalls: Array.from(toolCalls.values()),
          usage,
          finishReason,
        },
      };
    } catch (error: any) {
      throw new LLMError('OpenAI', error.message, { originalError: error.code });
    }
  }

  private formatMessages(messages: LLMMessage[], systemPrompt?: string): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
    const formatted: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];

    if (systemPrompt) {
      formatted.push({ role: 'system', content: systemPrompt });
    }

    for (const msg of messages) {
      if (msg.role === 'tool') {
        formatted.push({
          role: 'tool',
          content: msg.content,
          tool_call_id: msg.toolCallId!,
        });
      } else if (msg.role === 'assistant' && msg.toolCalls?.length) {
        formatted.push({
          role: 'assistant',
          content: msg.content || null,
          tool_calls: msg.toolCalls.map(tc => ({
            id: tc.id,
            type: 'function' as const,
            function: { name: tc.name, arguments: tc.arguments },
          })),
        });
      } else {
        formatted.push({
          role: msg.role as 'user' | 'assistant' | 'system',
          content: msg.content,
        });
      }
    }

    return formatted;
  }

  private formatTools(tools: ToolDefinition[]): OpenAI.Chat.Completions.ChatCompletionTool[] {
    return tools.map(tool => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters as any,
      },
    }));
  }

  private mapFinishReason(reason: string | null): LLMResponse['finishReason'] {
    switch (reason) {
      case 'stop': return 'stop';
      case 'tool_calls': return 'tool_calls';
      case 'length': return 'length';
      default: return 'error';
    }
  }
}
```

### Day 2-3: Claude Adapter

**Install Anthropic SDK:**
```bash
pnpm add @anthropic-ai/sdk
```

**Create `apps/backend/src/adapters/llm/claude-adapter.ts`:**
```typescript
import Anthropic from '@anthropic-ai/sdk';
import type { LLMProviderPort, GenerateOptions, StreamChunk } from '../../ports/LLMProviderPort';
import type { LLMMessage, LLMResponse, LLMToolCall, ToolDefinition } from '@project-jarvis/shared-types';
import { LLMError } from '@project-jarvis/shared-types';

// Pricing per 1M tokens
const PRICING = {
  'claude-3-5-sonnet-20241022': { input: 3.00, output: 15.00 },
  'claude-3-5-haiku-20241022': { input: 0.80, output: 4.00 },
  'claude-3-opus-20240229': { input: 15.00, output: 75.00 },
} as const;

export class ClaudeAdapter implements LLMProviderPort {
  private client: Anthropic;
  private model: string;

  constructor(apiKey: string, model = 'claude-3-5-sonnet-20241022') {
    this.client = new Anthropic({ apiKey });
    this.model = model;
  }

  getModel(): string {
    return this.model;
  }

  calculateCost(promptTokens: number, completionTokens: number): number {
    const pricing = PRICING[this.model as keyof typeof PRICING] || PRICING['claude-3-5-sonnet-20241022'];
    const inputCost = (promptTokens / 1_000_000) * pricing.input;
    const outputCost = (completionTokens / 1_000_000) * pricing.output;
    return inputCost + outputCost;
  }

  async generate(messages: LLMMessage[], options?: GenerateOptions): Promise<LLMResponse> {
    try {
      const { systemPrompt, formattedMessages } = this.formatMessages(messages, options?.systemPrompt);

      const response = await this.client.messages.create({
        model: options?.model || this.model,
        max_tokens: options?.maxTokens ?? 4096,
        system: systemPrompt,
        messages: formattedMessages,
        tools: options?.tools ? this.formatTools(options.tools) : undefined,
      });

      return this.parseResponse(response);
    } catch (error: any) {
      throw new LLMError('Claude', error.message, { originalError: error.code });
    }
  }

  async *stream(messages: LLMMessage[], options?: GenerateOptions): AsyncGenerator<StreamChunk, void, unknown> {
    try {
      const { systemPrompt, formattedMessages } = this.formatMessages(messages, options?.systemPrompt);

      const stream = await this.client.messages.stream({
        model: options?.model || this.model,
        max_tokens: options?.maxTokens ?? 4096,
        system: systemPrompt,
        messages: formattedMessages,
        tools: options?.tools ? this.formatTools(options.tools) : undefined,
      });

      let content = '';
      const toolCalls: LLMToolCall[] = [];
      let currentToolUse: { id: string; name: string; input: string } | null = null;

      for await (const event of stream) {
        if (event.type === 'content_block_start') {
          if (event.content_block.type === 'tool_use') {
            currentToolUse = {
              id: event.content_block.id,
              name: event.content_block.name,
              input: '',
            };
          }
        } else if (event.type === 'content_block_delta') {
          if (event.delta.type === 'text_delta') {
            content += event.delta.text;
            yield { type: 'token', token: event.delta.text };
          } else if (event.delta.type === 'input_json_delta' && currentToolUse) {
            currentToolUse.input += event.delta.partial_json;
          }
        } else if (event.type === 'content_block_stop') {
          if (currentToolUse) {
            const tc: LLMToolCall = {
              id: currentToolUse.id,
              name: currentToolUse.name,
              arguments: currentToolUse.input,
            };
            toolCalls.push(tc);
            yield { type: 'tool_call', toolCall: tc };
            currentToolUse = null;
          }
        }
      }

      // Get final message for usage
      const finalMessage = await stream.finalMessage();

      yield {
        type: 'done',
        response: {
          content: content || null,
          toolCalls,
          usage: {
            promptTokens: finalMessage.usage.input_tokens,
            completionTokens: finalMessage.usage.output_tokens,
            totalTokens: finalMessage.usage.input_tokens + finalMessage.usage.output_tokens,
          },
          finishReason: this.mapStopReason(finalMessage.stop_reason),
        },
      };
    } catch (error: any) {
      throw new LLMError('Claude', error.message, { originalError: error.code });
    }
  }

  private formatMessages(messages: LLMMessage[], systemPrompt?: string): {
    systemPrompt: string;
    formattedMessages: Anthropic.MessageParam[];
  } {
    const formattedMessages: Anthropic.MessageParam[] = [];
    let system = systemPrompt || '';

    for (const msg of messages) {
      if (msg.role === 'system') {
        system = msg.content;
        continue;
      }

      if (msg.role === 'user') {
        formattedMessages.push({ role: 'user', content: msg.content });
      } else if (msg.role === 'assistant') {
        const content: Anthropic.ContentBlock[] = [];
        
        if (msg.content) {
          content.push({ type: 'text', text: msg.content });
        }
        
        if (msg.toolCalls) {
          for (const tc of msg.toolCalls) {
            content.push({
              type: 'tool_use',
              id: tc.id,
              name: tc.name,
              input: JSON.parse(tc.arguments),
            });
          }
        }
        
        formattedMessages.push({ role: 'assistant', content });
      } else if (msg.role === 'tool') {
        formattedMessages.push({
          role: 'user',
          content: [{
            type: 'tool_result',
            tool_use_id: msg.toolCallId!,
            content: msg.content,
          }],
        });
      }
    }

    return { systemPrompt: system, formattedMessages };
  }

  private formatTools(tools: ToolDefinition[]): Anthropic.Tool[] {
    return tools.map(tool => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.parameters as any,
    }));
  }

  private parseResponse(response: Anthropic.Message): LLMResponse {
    let content = '';
    const toolCalls: LLMToolCall[] = [];

    for (const block of response.content) {
      if (block.type === 'text') {
        content += block.text;
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          name: block.name,
          arguments: JSON.stringify(block.input),
        });
      }
    }

    return {
      content: content || null,
      toolCalls,
      usage: {
        promptTokens: response.usage.input_tokens,
        completionTokens: response.usage.output_tokens,
        totalTokens: response.usage.input_tokens + response.usage.output_tokens,
      },
      finishReason: this.mapStopReason(response.stop_reason),
    };
  }

  private mapStopReason(reason: string | null): LLMResponse['finishReason'] {
    switch (reason) {
      case 'end_turn': return 'stop';
      case 'tool_use': return 'tool_calls';
      case 'max_tokens': return 'length';
      default: return 'error';
    }
  }
}
```

### Day 3-4: LLM Router

**Create `apps/backend/src/adapters/llm/llm-router.ts`:**
```typescript
import type { LLMProviderPort, GenerateOptions, StreamChunk } from '../../ports/LLMProviderPort';
import type { LLMMessage, LLMResponse } from '@project-jarvis/shared-types';
import { OpenAIAdapter } from './openai-adapter';
import { ClaudeAdapter } from './claude-adapter';
import { SecretsService } from '../../application/services/secrets-service';

export type ModelProvider = 'openai' | 'anthropic';

export interface ModelConfig {
  provider: ModelProvider;
  model: string;
  maxTokens?: number;
  temperature?: number;
}

// Default model routing
const MODEL_CONFIGS: Record<string, ModelConfig> = {
  'default': { provider: 'anthropic', model: 'claude-3-5-sonnet-20241022' },
  'fast': { provider: 'openai', model: 'gpt-4o-mini' },
  'smart': { provider: 'anthropic', model: 'claude-3-5-sonnet-20241022' },
  'reasoning': { provider: 'anthropic', model: 'claude-3-opus-20240229' },
};

export class LLMRouter implements LLMProviderPort {
  private adapters: Map<string, LLMProviderPort> = new Map();
  private currentAdapter: LLMProviderPort | null = null;

  constructor(
    private secretsService: SecretsService,
    private modelConfig: ModelConfig = MODEL_CONFIGS['default']
  ) {}

  async initialize(userId: string): Promise<void> {
    const { provider, model } = this.modelConfig;

    // Try to get user's API key first, fall back to system key
    const userKey = await this.secretsService.getDecryptedValue(userId, provider);
    const systemKey = provider === 'openai' 
      ? process.env.OPENAI_API_KEY 
      : process.env.ANTHROPIC_API_KEY;

    const apiKey = userKey || systemKey;
    
    if (!apiKey) {
      throw new Error(`No API key available for ${provider}`);
    }

    const adapterKey = `${provider}:${model}`;
    
    if (!this.adapters.has(adapterKey)) {
      const adapter = provider === 'openai'
        ? new OpenAIAdapter(apiKey, model)
        : new ClaudeAdapter(apiKey, model);
      this.adapters.set(adapterKey, adapter);
    }

    this.currentAdapter = this.adapters.get(adapterKey)!;
  }

  private getAdapter(): LLMProviderPort {
    if (!this.currentAdapter) {
      throw new Error('LLM Router not initialized. Call initialize() first.');
    }
    return this.currentAdapter;
  }

  getModel(): string {
    return this.getAdapter().getModel();
  }

  calculateCost(promptTokens: number, completionTokens: number): number {
    return this.getAdapter().calculateCost(promptTokens, completionTokens);
  }

  async generate(messages: LLMMessage[], options?: GenerateOptions): Promise<LLMResponse> {
    return this.getAdapter().generate(messages, options);
  }

  async *stream(messages: LLMMessage[], options?: GenerateOptions): AsyncGenerator<StreamChunk, void, unknown> {
    yield* this.getAdapter().stream(messages, options);
  }

  // Static factory methods
  static forTask(task: 'fast' | 'smart' | 'reasoning' | 'default', secretsService: SecretsService): LLMRouter {
    return new LLMRouter(secretsService, MODEL_CONFIGS[task]);
  }

  static withConfig(config: ModelConfig, secretsService: SecretsService): LLMRouter {
    return new LLMRouter(secretsService, config);
  }
}
```

### Day 4-5: Integration Tests

**Create `apps/backend/src/adapters/llm/__tests__/llm-adapters.test.ts`:**
```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import { OpenAIAdapter } from '../openai-adapter';
import { ClaudeAdapter } from '../claude-adapter';

// These tests require API keys - run manually or in CI with secrets
describe.skipIf(!process.env.OPENAI_API_KEY)('OpenAI Adapter', () => {
  let adapter: OpenAIAdapter;

  beforeAll(() => {
    adapter = new OpenAIAdapter(process.env.OPENAI_API_KEY!, 'gpt-4o-mini');
  });

  it('should generate a response', async () => {
    const response = await adapter.generate([
      { role: 'user', content: 'Say "hello" and nothing else.' }
    ]);

    expect(response.content?.toLowerCase()).toContain('hello');
    expect(response.usage.totalTokens).toBeGreaterThan(0);
  });

  it('should stream tokens', async () => {
    const tokens: string[] = [];

    for await (const chunk of adapter.stream([
      { role: 'user', content: 'Count from 1 to 5.' }
    ])) {
      if (chunk.type === 'token') {
        tokens.push(chunk.token);
      }
    }

    expect(tokens.length).toBeGreaterThan(0);
    expect(tokens.join('')).toMatch(/1.*2.*3.*4.*5/);
  });

  it('should handle tool calls', async () => {
    const response = await adapter.generate(
      [{ role: 'user', content: 'What is the weather in Tokyo?' }],
      {
        tools: [{
          id: 'get_weather',
          name: 'get_weather',
          description: 'Get weather for a city',
          parameters: {
            type: 'object',
            properties: {
              city: { type: 'string', description: 'City name' }
            },
            required: ['city']
          }
        }]
      }
    );

    expect(response.toolCalls.length).toBeGreaterThan(0);
    expect(response.toolCalls[0].name).toBe('get_weather');
  });
});
```

### Files to Create This Week

```
apps/backend/src/adapters/llm/
  index.ts
  openai-adapter.ts
  claude-adapter.ts
  llm-router.ts
  __tests__/
    llm-adapters.test.ts
```

---

## Week 3: Orchestrator Service

### Objectives
- Implement the agent loop
- Create tool registry
- Integrate with event streaming

### Day 1-2: Orchestrator Service

**Create `apps/backend/src/application/services/orchestrator-service.ts`:**
```typescript
import type { LLMProviderPort, StreamChunk } from '../../ports/LLMProviderPort';
import type { ToolInvokerPort } from '../../ports/ToolInvokerPort';
import type { EventStreamPort } from '../../ports/EventStreamPort';
import type { MemoryStorePort } from '../../ports/MemoryStorePort';
import type { LLMMessage, ToolDefinition, AgentRun } from '@project-jarvis/shared-types';
import { AgentRunRepository, MessageRepository, ToolCallRepository } from '../../adapters/storage/agent-run-repository';
import { logger } from '../../infrastructure/logging/logger';

const MAX_ITERATIONS = 10;
const SYSTEM_PROMPT = `You are Jarvis, a helpful personal assistant. You have access to tools to help the user.
When you need information you don't have, use the available tools.
Be concise and helpful. Remember context from the conversation.`;

export interface OrchestratorContext {
  userId: string;
  runId: string;
  llm: LLMProviderPort;
  tools: ToolInvokerPort;
  eventStream: EventStreamPort;
  memory: MemoryStorePort;
}

export class OrchestratorService {
  constructor(
    private runRepo: AgentRunRepository,
    private messageRepo: MessageRepository,
    private toolCallRepo: ToolCallRepository
  ) {}

  async startRun(userId: string): Promise<AgentRun> {
    const run = await this.runRepo.create(userId);
    logger.info('Agent run started', { userId, runId: run.id });
    return run;
  }

  async executeRun(
    ctx: OrchestratorContext,
    userInput: string
  ): Promise<void> {
    const { userId, runId, llm, tools, eventStream, memory } = ctx;
    const log = logger.child({ userId, runId });

    try {
      // Update run status
      await this.runRepo.updateStatus(runId, 'running');
      await eventStream.publishStatus(userId, runId, 'running');

      // Save user message
      await this.messageRepo.create(runId, 'user', userInput);

      // Get available tools
      const availableTools = await tools.getTools(userId);

      // Retrieve relevant memories
      const memories = await memory.search(userId, userInput, 5);
      const memoryContext = memories.length > 0
        ? `\n\nRelevant context from memory:\n${memories.map(m => `- ${m.content}`).join('\n')}`
        : '';

      // Build message history
      const existingMessages = await this.messageRepo.findByRun(runId);
      const messages: LLMMessage[] = existingMessages.map(m => ({
        role: m.role as LLMMessage['role'],
        content: m.content,
        toolCallId: m.toolCallId || undefined,
      }));

      // Agent loop
      let iterations = 0;
      let totalTokens = 0;
      let totalCost = 0;

      while (iterations < MAX_ITERATIONS) {
        iterations++;
        log.debug('Agent iteration', { iteration: iterations });

        // Stream LLM response
        let fullContent = '';
        const toolCallsToProcess: Array<{ id: string; name: string; arguments: string }> = [];
        let response: StreamChunk | null = null;

        for await (const chunk of llm.stream(messages, {
          systemPrompt: SYSTEM_PROMPT + memoryContext,
          tools: availableTools,
        })) {
          if (chunk.type === 'token') {
            fullContent += chunk.token;
            await eventStream.publishToken(userId, runId, chunk.token);
          } else if (chunk.type === 'tool_call') {
            toolCallsToProcess.push(chunk.toolCall);
          } else if (chunk.type === 'done') {
            response = chunk;
            totalTokens += chunk.response.usage.totalTokens;
            totalCost += llm.calculateCost(
              chunk.response.usage.promptTokens,
              chunk.response.usage.completionTokens
            );
          }
        }

        // Handle tool calls
        if (toolCallsToProcess.length > 0) {
          // Save assistant message with tool calls
          await this.messageRepo.create(runId, 'assistant', fullContent || '');

          // Add assistant message to conversation
          messages.push({
            role: 'assistant',
            content: fullContent || '',
            toolCalls: toolCallsToProcess.map(tc => ({
              id: tc.id,
              name: tc.name,
              arguments: tc.arguments,
            })),
          });

          // Execute each tool call
          for (const tc of toolCallsToProcess) {
            const input = JSON.parse(tc.arguments);
            
            // Log tool call
            const toolCallRecord = await this.toolCallRepo.create(runId, tc.name, input);
            await eventStream.publishToolCall(userId, runId, toolCallRecord.id, tc.name, input);

            const startTime = Date.now();
            
            try {
              const result = await tools.invoke(userId, tc.name, input);
              const durationMs = Date.now() - startTime;

              await this.toolCallRepo.complete(toolCallRecord.id, result.output as any, durationMs);
              await eventStream.publishToolResult(userId, runId, toolCallRecord.id, result.output, result.success);

              // Add tool result to messages
              const resultContent = JSON.stringify(result.output);
              await this.messageRepo.create(runId, 'tool', resultContent, tc.id);
              messages.push({
                role: 'tool',
                content: resultContent,
                toolCallId: tc.id,
              });
            } catch (error: any) {
              const durationMs = Date.now() - startTime;
              await this.toolCallRepo.fail(toolCallRecord.id, error.message, durationMs);
              await eventStream.publishToolResult(userId, runId, toolCallRecord.id, { error: error.message }, false);

              // Add error as tool result
              const errorContent = JSON.stringify({ error: error.message });
              await this.messageRepo.create(runId, 'tool', errorContent, tc.id);
              messages.push({
                role: 'tool',
                content: errorContent,
                toolCallId: tc.id,
              });
            }
          }

          // Continue the loop to get next response
          continue;
        }

        // No tool calls - this is the final response
        if (fullContent) {
          await this.messageRepo.create(runId, 'assistant', fullContent);
          await eventStream.publishFinal(userId, runId, fullContent, { totalTokens, totalCost });

          // Store in memory for future context
          await memory.store(userId, `User: ${userInput}\nAssistant: ${fullContent}`, {
            runId,
            type: 'conversation',
          });
        }

        break;
      }

      // Update run as completed
      await this.runRepo.updateStatus(runId, 'completed', { tokens: totalTokens, cost: totalCost });
      await eventStream.publishStatus(userId, runId, 'completed');
      log.info('Agent run completed', { iterations, totalTokens, totalCost });

    } catch (error: any) {
      log.error('Agent run failed', error);
      await this.runRepo.updateStatus(runId, 'failed');
      await eventStream.publishError(userId, runId, error.message, error.code);
      await eventStream.publishStatus(userId, runId, 'failed');
      throw error;
    }
  }

  async cancelRun(userId: string, runId: string): Promise<void> {
    await this.runRepo.updateStatus(runId, 'cancelled');
    // TODO: Implement actual cancellation of in-flight requests
    logger.info('Agent run cancelled', { userId, runId });
  }
}
```

### Day 2-3: Tool Registry

**Create `apps/backend/src/application/services/tool-registry.ts`:**
```typescript
import type { ToolInvokerPort } from '../../ports/ToolInvokerPort';
import type { ToolDefinition, ToolResult } from '@project-jarvis/shared-types';
import { ToolError } from '@project-jarvis/shared-types';
import { logger } from '../../infrastructure/logging/logger';

export type ToolHandler = (userId: string, input: Record<string, unknown>) => Promise<unknown>;

interface RegisteredTool {
  definition: ToolDefinition;
  handler: ToolHandler;
}

export class ToolRegistry implements ToolInvokerPort {
  private tools: Map<string, RegisteredTool> = new Map();

  register(definition: ToolDefinition, handler: ToolHandler): void {
    this.tools.set(definition.id, { definition, handler });
    logger.info('Tool registered', { toolId: definition.id, name: definition.name });
  }

  unregister(toolId: string): void {
    this.tools.delete(toolId);
  }

  async getTools(userId: string): Promise<ToolDefinition[]> {
    // TODO: Filter based on user permissions
    return Array.from(this.tools.values()).map(t => t.definition);
  }

  async invoke(userId: string, toolId: string, input: Record<string, unknown>): Promise<ToolResult> {
    const tool = this.tools.get(toolId);
    
    if (!tool) {
      throw new ToolError(toolId, 'Tool not found');
    }

    try {
      const output = await tool.handler(userId, input);
      return { success: true, output };
    } catch (error: any) {
      logger.error('Tool execution failed', error, { toolId, userId });
      return { success: false, output: null, error: error.message };
    }
  }

  async hasPermission(userId: string, toolId: string): Promise<boolean> {
    // TODO: Check tool permissions table
    return this.tools.has(toolId);
  }
}

// Built-in tools
export function registerBuiltInTools(registry: ToolRegistry): void {
  // Current time tool
  registry.register(
    {
      id: 'get_current_time',
      name: 'get_current_time',
      description: 'Get the current date and time',
      parameters: {
        type: 'object',
        properties: {
          timezone: {
            type: 'string',
            description: 'Timezone (e.g., "America/New_York", "UTC")',
          },
        },
      },
    },
    async (userId, input) => {
      const tz = (input.timezone as string) || 'UTC';
      return {
        datetime: new Date().toLocaleString('en-US', { timeZone: tz }),
        timezone: tz,
        timestamp: Date.now(),
      };
    }
  );

  // Calculator tool
  registry.register(
    {
      id: 'calculate',
      name: 'calculate',
      description: 'Perform mathematical calculations',
      parameters: {
        type: 'object',
        properties: {
          expression: {
            type: 'string',
            description: 'Mathematical expression to evaluate (e.g., "2 + 2", "sqrt(16)")',
          },
        },
        required: ['expression'],
      },
    },
    async (userId, input) => {
      const expr = input.expression as string;
      // Safe evaluation using Function constructor with limited scope
      const safeEval = new Function(
        'Math',
        `return ${expr.replace(/[^0-9+\-*/().sqrt,pow,sin,cos,tan,log,abs,floor,ceil,round\s]/g, '')}`
      );
      const result = safeEval(Math);
      return { expression: expr, result };
    }
  );
}
```

### Day 3-4: Memory and KG Tools

**Create `apps/backend/src/application/services/memory-tools.ts`:**
```typescript
import type { ToolRegistry } from './tool-registry';
import type { MemoryStorePort } from '../../ports/MemoryStorePort';
import type { KnowledgeGraphPort } from '../../ports/KnowledgeGraphPort';

export function registerMemoryTools(registry: ToolRegistry, memory: MemoryStorePort): void {
  // Remember tool
  registry.register(
    {
      id: 'remember',
      name: 'remember',
      description: 'Store important information for later retrieval. Use this when the user explicitly asks you to remember something.',
      parameters: {
        type: 'object',
        properties: {
          content: {
            type: 'string',
            description: 'The information to remember',
          },
          category: {
            type: 'string',
            description: 'Category for the memory (e.g., "preference", "fact", "reminder")',
          },
        },
        required: ['content'],
      },
    },
    async (userId, input) => {
      const content = input.content as string;
      const category = (input.category as string) || 'general';
      
      const memory_item = await memory.store(userId, content, { category });
      return { 
        success: true, 
        message: `I'll remember that: "${content}"`,
        memoryId: memory_item.id,
      };
    }
  );

  // Recall tool
  registry.register(
    {
      id: 'recall',
      name: 'recall',
      description: 'Search memories for relevant information. Use this when you need to remember something about the user.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'What to search for in memories',
          },
          limit: {
            type: 'number',
            description: 'Maximum number of memories to return (default: 5)',
          },
        },
        required: ['query'],
      },
    },
    async (userId, input) => {
      const query = input.query as string;
      const limit = (input.limit as number) || 5;
      
      const results = await memory.search(userId, query, limit);
      return {
        found: results.length,
        memories: results.map(m => ({
          content: m.content,
          similarity: m.similarity,
          createdAt: m.createdAt,
        })),
      };
    }
  );
}

export function registerKnowledgeGraphTools(registry: ToolRegistry, kg: KnowledgeGraphPort): void {
  // Create entity tool
  registry.register(
    {
      id: 'kg_create_entity',
      name: 'kg_create_entity',
      description: 'Create an entity in the knowledge graph (person, place, organization, concept)',
      parameters: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            description: 'Entity type (person, place, organization, concept, event)',
          },
          name: {
            type: 'string',
            description: 'Name of the entity',
          },
          properties: {
            type: 'object',
            description: 'Additional properties for the entity',
          },
        },
        required: ['type', 'name'],
      },
    },
    async (userId, input) => {
      const entity = await kg.createEntity(
        userId,
        input.type as string,
        input.name as string,
        input.properties as Record<string, unknown>
      );
      return { entityId: entity.id, type: entity.type, name: entity.name };
    }
  );

  // Create relation tool
  registry.register(
    {
      id: 'kg_create_relation',
      name: 'kg_create_relation',
      description: 'Create a relationship between two entities in the knowledge graph',
      parameters: {
        type: 'object',
        properties: {
          sourceId: {
            type: 'string',
            description: 'ID of the source entity',
          },
          targetId: {
            type: 'string',
            description: 'ID of the target entity',
          },
          type: {
            type: 'string',
            description: 'Relationship type (e.g., knows, works_at, located_in)',
          },
        },
        required: ['sourceId', 'targetId', 'type'],
      },
    },
    async (userId, input) => {
      const relation = await kg.createRelation(
        userId,
        input.sourceId as string,
        input.targetId as string,
        input.type as string
      );
      return { relationId: relation.id, type: relation.type };
    }
  );

  // Query knowledge graph
  registry.register(
    {
      id: 'kg_query',
      name: 'kg_query',
      description: 'Search the knowledge graph for entities and their relationships',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Natural language query about entities or relationships',
          },
          type: {
            type: 'string',
            description: 'Optional: filter by entity type',
          },
        },
        required: ['query'],
      },
    },
    async (userId, input) => {
      const results = await kg.searchEntities(
        userId,
        input.query as string,
        input.type as string | undefined,
        10
      );
      return {
        found: results.length,
        entities: results.map(e => ({
          id: e.id,
          type: e.type,
          name: e.name,
          properties: e.properties,
        })),
      };
    }
  );
}
```

### Day 4-5: Agent API Handler

**Create `apps/backend/src/api/http/agent-router.ts`:**
```typescript
import { Router } from 'express';
import { z } from 'zod';
import { OrchestratorService } from '../../application/services/orchestrator-service';
import { LLMRouter } from '../../adapters/llm/llm-router';
import { ToolRegistry } from '../../application/services/tool-registry';
import { SecretsService } from '../../application/services/secrets-service';
import type { EventStreamPort } from '../../ports/EventStreamPort';
import type { MemoryStorePort } from '../../ports/MemoryStorePort';
import { validateBody } from '../middleware/validate';
import { authMiddleware } from '../middleware/auth';

const runAgentSchema = z.object({
  input: z.string().min(1).max(10000),
  model: z.enum(['default', 'fast', 'smart', 'reasoning']).optional(),
});

const sendMessageSchema = z.object({
  content: z.string().min(1).max(10000),
});

export function createAgentRouter(
  orchestrator: OrchestratorService,
  toolRegistry: ToolRegistry,
  secretsService: SecretsService,
  eventStream: EventStreamPort,
  memory: MemoryStorePort
) {
  const router = Router();

  // Start a new agent run
  router.post('/run', validateBody(runAgentSchema), async (req, res) => {
    const userId = req.userId!;
    const { input, model } = req.body;

    // Create the run
    const run = await orchestrator.startRun(userId);

    // Initialize LLM with user's keys
    const llm = LLMRouter.forTask(model || 'default', secretsService);
    await llm.initialize(userId);

    // Execute run in background
    orchestrator.executeRun(
      {
        userId,
        runId: run.id,
        llm,
        tools: toolRegistry,
        eventStream,
        memory,
      },
      input
    ).catch(err => {
      // Error handling is done inside executeRun
      console.error('Run execution error:', err);
    });

    // Return immediately with run ID
    res.status(202).json({
      data: {
        id: run.id,
        status: 'running',
        startedAt: run.startedAt,
      },
    });
  });

  // Get run status
  router.get('/:id/status', async (req, res) => {
    const run = await orchestrator.getRunStatus(req.params.id, req.userId!);
    res.json({ data: run });
  });

  // Get run messages
  router.get('/:id/messages', async (req, res) => {
    const messages = await orchestrator.getRunMessages(req.params.id, req.userId!);
    res.json({ data: messages });
  });

  // Cancel a run
  router.post('/:id/cancel', async (req, res) => {
    await orchestrator.cancelRun(req.userId!, req.params.id);
    res.status(204).send();
  });

  // List user's runs
  router.get('/', async (req, res) => {
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = parseInt(req.query.offset as string) || 0;
    
    const runs = await orchestrator.listRuns(req.userId!, limit, offset);
    res.json({
      data: runs,
      pagination: { limit, offset, hasMore: runs.length === limit },
    });
  });

  return router;
}
```

### Files to Create This Week

```
apps/backend/src/
  application/services/
    orchestrator-service.ts
    tool-registry.ts
    memory-tools.ts
  api/http/
    agent-router.ts
```

---

## Week 4: Memory & KG Services

### Objectives
- Implement MemoryService with embeddings
- Implement KGService
- Create memory and KG adapters

### Key Tasks

1. **Embedding Adapter:**
```typescript
// apps/backend/src/adapters/embedding/openai-embedding-adapter.ts
export class OpenAIEmbeddingAdapter implements EmbeddingPort {
  private client: OpenAI;
  private model = 'text-embedding-3-small';
  private dimension = 1536;

  async embed(text: string): Promise<number[]> {
    const response = await this.client.embeddings.create({
      model: this.model,
      input: text,
    });
    return response.data[0].embedding;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const response = await this.client.embeddings.create({
      model: this.model,
      input: texts,
    });
    return response.data.map(d => d.embedding);
  }

  getDimension(): number {
    return this.dimension;
  }
}
```

2. **MemoryService:**
   - Embed content before storage
   - Search by embedding similarity
   - Automatic memory consolidation (future)

3. **KGService:**
   - Entity extraction from text
   - Relation inference
   - Graph traversal for context

---

## Week 5: MCP Integration

### Objectives
- Implement MCP client
- Integrate with Composio
- External tool execution

### Key Tasks

1. **MCP Client Adapter:**
```typescript
// apps/backend/src/adapters/mcp/mcp-client-adapter.ts
import { Client } from '@modelcontextprotocol/sdk/client';

export class MCPClientAdapter {
  private clients: Map<string, Client> = new Map();

  async connect(serverId: string, transport: Transport): Promise<void> {
    const client = new Client({ name: 'jarvis', version: '1.0.0' });
    await client.connect(transport);
    this.clients.set(serverId, client);
  }

  async getTools(serverId: string): Promise<ToolDefinition[]> {
    const client = this.clients.get(serverId);
    const tools = await client.listTools();
    return tools.map(this.convertTool);
  }

  async invokeTool(serverId: string, toolName: string, args: unknown): Promise<unknown> {
    const client = this.clients.get(serverId);
    return client.callTool({ name: toolName, arguments: args });
  }
}
```

2. **Composio Integration:**
   - OAuth flow handling
   - Tool discovery
   - Credential injection

---

## Week 6: Monitor Agent & Safety

### Objectives
- Implement monitor agent for safety
- Add budget controls
- Policy enforcement

### Key Tasks

1. **Monitor Agent:**
   - Check tool calls for safety
   - Rate limit enforcement
   - Cost budget monitoring

2. **Safety Policies:**
   - Block dangerous tool combinations
   - PII detection
   - Content filtering

---

## Testing Checklist

### Unit Tests
- [ ] LLM adapters (mocked API calls)
- [ ] Tool registry
- [ ] Orchestrator service

### Integration Tests
- [ ] Full agent run with mock LLM
- [ ] Tool execution
- [ ] Event streaming

---

## Coordination with Other Developers

### With Backend Dev 1
- **Week 1:** Agree on port interfaces and error types
- **Week 2:** Get SecretsService for LLM key access
- **Week 3:** Integrate with WebSocket EventStreamAdapter
- **Week 4:** Use MemoryRepository and KGRepository

### With Frontend Dev
- **Week 3:** Ensure WebSocket events match expected format
- **Week 4:** Test streaming tokens in mobile UI

---

## Quick Reference

### Run Tests
```bash
pnpm test
pnpm test:watch
```

### Manual Testing
```bash
# Start backend
pnpm dev:backend

# Test agent run
curl -X POST http://localhost:3000/v1/agent/run \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"input": "What time is it?"}'
```
