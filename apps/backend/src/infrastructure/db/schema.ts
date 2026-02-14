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
    // Composio session for per-user tool calling
    composioSessionId: varchar('composio_session_id', { length: 255 }),
    composioMcpUrl: varchar('composio_mcp_url', { length: 2048 }),
    composioMcpHeaders: jsonb('composio_mcp_headers'),
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

// === Tool Permissions Domain ===
// User-level tool access control
export const userToolPermissions = pgTable('user_tool_permissions', {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    toolId: varchar('tool_id', { length: 255 }).notNull(),
    granted: boolean('granted').notNull().default(true),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// === Orchestrator Domain ===
// Task plans represent the DAG structure for executing user requests

export const taskPlans = pgTable('task_plans', {
    id: uuid('id').primaryKey().defaultRandom(),
    runId: uuid('run_id').notNull(),
    status: varchar('status', { length: 20 }).notNull().default('planning'), // 'planning' | 'executing' | 'completed' | 'failed'
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Task nodes are individual tasks within a plan
export const taskNodes = pgTable('task_nodes', {
    id: uuid('id').primaryKey().defaultRandom(),
    planId: uuid('plan_id').notNull().references(() => taskPlans.id, { onDelete: 'cascade' }),
    description: text('description').notNull(),
    agentType: varchar('agent_type', { length: 50 }).notNull(), // 'general' | 'research' | 'coding' | 'scheduling' | 'productivity' | 'messaging'
    status: varchar('status', { length: 20 }).notNull().default('pending'), // 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled'
    dependencies: jsonb('dependencies').notNull().default([]), // Array of task node IDs
    assignedAgentId: uuid('assigned_agent_id'),
    result: jsonb('result'),
    retryCount: integer('retry_count').notNull().default(0),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    completedAt: timestamp('completed_at'),
});

// Sub-agents track the execution state of each spawned agent
export const subAgents = pgTable('sub_agents', {
    id: uuid('id').primaryKey().defaultRandom(),
    runId: uuid('run_id').notNull(),
    taskNodeId: uuid('task_node_id').notNull().references(() => taskNodes.id, { onDelete: 'cascade' }),
    agentType: varchar('agent_type', { length: 50 }).notNull(),
    status: varchar('status', { length: 20 }).notNull().default('initializing'), // 'initializing' | 'running' | 'completed' | 'failed' | 'cancelled'
    taskDescription: text('task_description').notNull(),
    upstreamContext: text('upstream_context'),
    additionalTools: jsonb('additional_tools').notNull().default([]), // Array of tool IDs
    messages: jsonb('messages').notNull().default([]), // LLM message history
    toolCalls: jsonb('tool_calls').notNull().default([]), // Tool call records
    reasoningSteps: jsonb('reasoning_steps').notNull().default([]), // Reasoning/thinking steps
    artifacts: jsonb('artifacts').notNull().default([]), // Produced artifacts
    pendingGuidance: text('pending_guidance'), // Guidance injected by orchestrator
    totalTokens: integer('total_tokens').notNull().default(0),
    totalCost: real('total_cost').notNull().default(0),
    startedAt: timestamp('started_at').defaultNow().notNull(),
    completedAt: timestamp('completed_at'),
});

// Orchestrator state for crash recovery and state management
export const orchestratorStates = pgTable('orchestrator_states', {
    id: uuid('id').primaryKey().defaultRandom(),
    runId: uuid('run_id').notNull().unique(),
    userId: uuid('user_id').notNull(),
    status: varchar('status', { length: 20 }).notNull().default('idle'), // 'idle' | 'planning' | 'executing' | 'monitoring' | 'completed' | 'failed'
    planId: uuid('plan_id').references(() => taskPlans.id),
    activeAgentIds: jsonb('active_agent_ids').notNull().default([]), // Array of agent IDs
    loopCounters: jsonb('loop_counters').notNull().default({}), // Map of taskNodeId -> count
    totalInterventions: integer('total_interventions').notNull().default(0),
    totalTokens: integer('total_tokens').notNull().default(0),
    totalCost: real('total_cost').notNull().default(0),
    startedAt: timestamp('started_at').defaultNow().notNull(),
    completedAt: timestamp('completed_at'),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// === Monitoring Agent Domain ===

// Trigger subscriptions - maps Composio triggers to users
export const triggerSubscriptions = pgTable('trigger_subscriptions', {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    triggerId: varchar('trigger_id', { length: 255 }).notNull().unique(),
    triggerType: varchar('trigger_type', { length: 100 }).notNull(), // e.g., 'GITHUB_ISSUE_ASSIGNED_EVENT', 'SLACK_RECEIVE_MESSAGE'
    toolkit: varchar('toolkit', { length: 50 }).notNull(), // 'GITHUB' | 'SLACK'
    config: jsonb('config').notNull().default({}), // Trigger-specific config (repo, channel, etc.)
    autoStart: boolean('auto_start').notNull().default(false), // Whether to auto-start tasks
    enabled: boolean('enabled').notNull().default(true),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
    index('trigger_subscriptions_user_id_idx').on(table.userId),
]);

// Slack priority contacts - for determining message importance
export const slackPriorityContacts = pgTable('slack_priority_contacts', {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    slackUserId: varchar('slack_user_id', { length: 100 }).notNull(),
    slackUserName: varchar('slack_user_name', { length: 255 }),
    priority: varchar('priority', { length: 20 }).notNull().default('normal'), // 'high' | 'normal'
    autoStart: boolean('auto_start').notNull().default(false), // Override trigger's autoStart for this contact
    createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
    uniqueIndex('slack_priority_contacts_user_slack_idx').on(table.userId, table.slackUserId),
]);

// Monitored events - log of all trigger events received
export const monitoredEvents = pgTable('monitored_events', {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    subscriptionId: uuid('subscription_id').references(() => triggerSubscriptions.id, { onDelete: 'set null' }),
    triggerType: varchar('trigger_type', { length: 100 }).notNull(),
    toolkit: varchar('toolkit', { length: 50 }).notNull(),
    status: varchar('status', { length: 20 }).notNull().default('pending'), // 'pending' | 'approved' | 'rejected' | 'auto_started' | 'in_progress' | 'completed' | 'failed'
    payload: jsonb('payload').notNull(), // Raw trigger payload from Composio
    parsedContext: jsonb('parsed_context').notNull(), // Extracted: title, summary, sender, sourceUrl, etc.
    orchestratorRunId: uuid('orchestrator_run_id'), // If an orchestrator run was started
    sourceReplyId: varchar('source_reply_id', { length: 255 }), // ID of reply sent to GitHub/Slack
    sourceReplyContent: text('source_reply_content'), // Content of the reply sent
    requiresApproval: boolean('requires_approval').notNull().default(true),
    receivedAt: timestamp('received_at').defaultNow().notNull(),
    processedAt: timestamp('processed_at'),
    approvedAt: timestamp('approved_at'),
}, (table) => [
    index('monitored_events_user_received_idx').on(table.userId, table.receivedAt),
    index('monitored_events_status_idx').on(table.status),
]);

// Push notification tokens for Expo
export const pushTokens = pgTable('push_tokens', {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    token: varchar('token', { length: 500 }).notNull(),
    platform: varchar('platform', { length: 20 }).notNull(), // 'ios' | 'android'
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
    uniqueIndex('push_tokens_user_token_idx').on(table.userId, table.token),
]);

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
