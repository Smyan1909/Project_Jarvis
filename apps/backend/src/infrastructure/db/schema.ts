import { pgTable, uuid, text, timestamp, varchar, integer, jsonb, real, customType, boolean, uniqueIndex, index } from 'drizzle-orm/pg-core';

// Custom pgvector type
const vector = customType<{ data: number[]; driverData: string }>({
    dataType() {
        return 'vector(1536)';
    },
    toDriver(value: number[]): string {
        return `[${value.join(',')}]`;
    },
    fromDriver(value: string): number[] {
        return value.slice(1, -1).split(',').map(Number);
    },
});

// === User Domain ===
export const users = pgTable('users', {
    id: uuid('id').primaryKey().defaultRandom(),
    email: varchar('email', { length: 255 }).notNull().unique(),
    passwordHash: text('password_hash').notNull(),
    displayName: varchar('display_name', { length: 255 }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const userSecrets = pgTable('user_secrets', {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    provider: varchar('provider', { length: 50 }).notNull(), // 'openai' | 'anthropic' | 'composio' | 'github' | 'custom'
    name: varchar('name', { length: 255 }).notNull(),
    encryptedValue: text('encrypted_value').notNull(),
    iv: varchar('iv', { length: 64 }).notNull(),
    authTag: varchar('auth_tag', { length: 64 }).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
    uniqueIndex('user_secrets_user_provider_idx').on(table.userId, table.provider),
]);

export const refreshTokens = pgTable('refresh_tokens', {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
});

// === Agent Domain ===
export const agentRuns = pgTable('agent_runs', {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    status: varchar('status', { length: 20 }).notNull().default('pending'), // 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
    totalTokens: integer('total_tokens').notNull().default(0),
    totalCost: real('total_cost').notNull().default(0),
    startedAt: timestamp('started_at').defaultNow().notNull(),
    completedAt: timestamp('completed_at'),
});

export const messages = pgTable('messages', {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    runId: uuid('run_id').references(() => agentRuns.id, { onDelete: 'set null' }), // nullable - messages can exist without a run
    role: varchar('role', { length: 20 }).notNull(), // 'user' | 'assistant' | 'system' | 'tool'
    content: text('content').notNull(),
    toolCallId: varchar('tool_call_id', { length: 100 }), // LLM-generated IDs (not UUIDs)
    toolCalls: jsonb('tool_calls'), // For assistant messages with tool invocations
    metadata: jsonb('metadata').default({}), // Subject, time gaps, intent, etc.
    createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
    // Index for loading user's recent conversation history
    index('messages_user_id_created_at_idx').on(table.userId, table.createdAt),
]);

export const toolCalls = pgTable('tool_calls', {
    id: uuid('id').primaryKey().defaultRandom(),
    runId: uuid('run_id').notNull().references(() => agentRuns.id, { onDelete: 'cascade' }),
    toolId: varchar('tool_id', { length: 255 }).notNull(),
    input: jsonb('input').notNull(),
    output: jsonb('output'),
    status: varchar('status', { length: 20 }).notNull().default('pending'), // 'pending' | 'success' | 'error'
    durationMs: integer('duration_ms'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
});

// === Conversation Domain ===
// Rolling summaries of older conversation history (one per user)
export const conversationSummaries = pgTable('conversation_summaries', {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }).unique(),
    content: text('content').notNull(),
    summarizedMessageCount: integer('summarized_message_count').notNull(),
    summarizedUpToMessageId: uuid('summarized_up_to_message_id').references(() => messages.id, { onDelete: 'set null' }),
    originalTokenCount: integer('original_token_count').notNull(),
    summaryTokenCount: integer('summary_token_count').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// === Memory Domain ===
export const memories = pgTable('memories', {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    content: text('content').notNull(),
    embedding: vector('embedding'), // OpenAI text-embedding-3-small (1536 dimensions)
    metadata: jsonb('metadata').default({}),
    createdAt: timestamp('created_at').defaultNow().notNull(),
});

// === Knowledge Graph Domain ===
export const kgEntities = pgTable('kg_entities', {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    type: varchar('type', { length: 100 }).notNull(),
    name: varchar('name', { length: 500 }).notNull(),
    properties: jsonb('properties').default({}),
    embedding: vector('embedding'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const kgRelations = pgTable('kg_relations', {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    sourceId: uuid('source_id').notNull().references(() => kgEntities.id, { onDelete: 'cascade' }),
    targetId: uuid('target_id').notNull().references(() => kgEntities.id, { onDelete: 'cascade' }),
    type: varchar('type', { length: 100 }).notNull(),
    properties: jsonb('properties').default({}),
    createdAt: timestamp('created_at').defaultNow().notNull(),
});

// === MCP Domain ===
// Global MCP server configurations (admin-managed)
export const mcpServers = pgTable('mcp_servers', {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 255 }).notNull(),
    description: text('description'),
    url: varchar('url', { length: 2048 }).notNull(),
    transport: varchar('transport', { length: 50 }).notNull().default('streamable-http'), // 'streamable-http' | 'sse'
    authType: varchar('auth_type', { length: 50 }).notNull().default('none'), // 'oauth' | 'api-key' | 'none'
    // Encrypted auth configuration (OAuth tokens, API keys, etc.)
    // Structure varies based on authType - see MCPAuthConfig in shared-types
    authConfig: jsonb('auth_config'),
    enabled: boolean('enabled').notNull().default(true),
    priority: integer('priority').notNull().default(0), // Higher = higher priority for tool conflicts
    // Timeouts and retry configuration
    connectionTimeoutMs: integer('connection_timeout_ms').notNull().default(30000),
    requestTimeoutMs: integer('request_timeout_ms').notNull().default(60000),
    maxRetries: integer('max_retries').notNull().default(3),
    // Timestamps
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
});
