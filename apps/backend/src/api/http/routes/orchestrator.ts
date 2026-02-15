// =============================================================================
// Orchestrator Routes
// =============================================================================
// API routes for the orchestrator layer. Routes user requests through the
// autonomous orchestrator that can plan, delegate, and execute tasks.

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import type { StreamEvent, MCPServerConfig } from '@project-jarvis/shared-types';

// Services
import { OrchestratorService } from '../../../application/services/OrchestratorService.js';
import { TaskPlanService } from '../../../application/services/TaskPlanService.js';
import { SubAgentManager } from '../../../application/services/SubAgentManager.js';
import { LoopDetectionService } from '../../../application/services/LoopDetectionService.js';
import { ContextManagementService } from '../../../application/services/ContextManagementService.js';
import { TokenCounterService } from '../../../application/services/TokenCounterService.js';
import { ConversationHistoryService } from '../../../application/services/ConversationHistoryService.js';
import {
  ToolRegistry,
  registerBuiltInTools,
} from '../../../application/services/ToolRegistry.js';
import { registerMemoryTools, registerKnowledgeGraphTools } from '../../../application/services/MemoryTools.js';
import { registerWebTools } from '../../../application/services/WebTools.js';
import { registerSessionTools } from '../../../application/services/SessionTools.js';

// Adapters
import {
  InMemoryOrchestratorCacheAdapter,
} from '../../../adapters/orchestrator/OrchestratorCacheAdapter.js';
import {
  OrchestratorEventStreamAdapter,
  createHonoSSEWriter,
} from '../../../adapters/orchestrator/OrchestratorEventStreamAdapter.js';

// PostgreSQL-backed services from central service registry
import {
  memoryStore,
  knowledgeGraph,
  orchestratorStateRepository,
} from '../../../services/index.js';
import { InMemoryMemoryStore } from '../../../adapters/memory/InMemoryMemoryStore.js';
import { InMemoryKnowledgeGraph } from '../../../adapters/kg/InMemoryKnowledgeGraph.js';
import { VercelEmbeddingAdapter } from '../../../adapters/embedding/VercelEmbeddingAdapter.js';
import { MessageRepository, ConversationSummaryRepository, UserRepository, AgentRunRepository } from '../../../adapters/storage/index.js';

// MCP Integration
import { MCPClientManager, type MCPConfigLoader } from '../../../adapters/mcp/MCPClientManager.js';
import { CompositeToolInvoker } from '../../../adapters/tools/CompositeToolInvoker.js';

// Composio Integration
import { 
  ComposioIntegrationService, 
  getComposioClient 
} from '@project-jarvis/mcp-servers';
import { ComposioSessionManager } from '../../../application/services/ComposioSessionManager.js';
import { db } from '../../../infrastructure/db/client.js';

// LLM and Tools
import { llmRouter } from '../../../application/services/LLMRouterService.js';
import { logger } from '../../../infrastructure/logging/logger.js';
import { config } from '../../../infrastructure/config/index.js';

// =============================================================================
// Request Schemas
// =============================================================================

const orchestratorRunSchema = z.object({
  input: z.string().min(1).max(50000),
  // Optional parameters - orchestrator will decide these if not provided
  model: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
});

const runStatusSchema = z.object({
  runId: z.string().uuid(),
});

// =============================================================================
// Singleton Instances (for MVP - replace with DI in production)
// =============================================================================

// PostgreSQL-backed state repository (imported from services)
const stateRepository = orchestratorStateRepository;

// In-memory cache adapter (can be replaced with Redis in production)
const cacheAdapter = new InMemoryOrchestratorCacheAdapter();
const eventStreamAdapter = new OrchestratorEventStreamAdapter(cacheAdapter);

// Memory store and knowledge graph are PostgreSQL-backed (imported from services)
// - memoryStore: PgMemoryStore with pgvector for semantic search
// - knowledgeGraph: PgKnowledgeGraph with pgvector for semantic search

// Create tool registry with all tools registered
const toolRegistry = new ToolRegistry();

// Create repositories for conversation history and agent runs
const messageRepository = new MessageRepository();
const conversationSummaryRepository = new ConversationSummaryRepository();
const userRepository = new UserRepository();
const agentRunRepository = new AgentRunRepository();

// Create conversation history service (singleton)
let conversationHistoryService: ConversationHistoryService | null = null;

// Test user ID for development (will be replaced with auth in production)
let testUserId: string | null = null;

/**
 * Get or create a test user for development.
 * TODO: Replace with proper auth middleware in production.
 */
async function getTestUserId(): Promise<string> {
  if (testUserId) return testUserId;

  const testEmail = 'test-orchestrator@jarvis.local';
  
  // Try to find existing test user
  const existingUser = await userRepository.findByEmail(testEmail);
  if (existingUser) {
    testUserId = existingUser.id;
    logger.info('Using existing test user', { userId: testUserId });
    return testUserId;
  }

  // Create a new test user
  const newUser = await userRepository.create({
    email: testEmail,
    passwordHash: 'test-hash-not-for-login',
    displayName: 'Test Orchestrator User',
  });
  testUserId = newUser.id;
  logger.info('Created test user for development', { userId: testUserId });
  return testUserId;
}

// =============================================================================
// MCP Client Manager Setup
// =============================================================================

// Environment-based MCP configuration loader (for MVP)
// In production, this would load from database via MCPServerService
class EnvMCPConfigLoader implements MCPConfigLoader {
  async loadConfigurations(): Promise<MCPServerConfig[]> {
    const configs: MCPServerConfig[] = [];

    // Load MCP servers from environment variables
    // Format: MCP_SERVER_<N>_URL, MCP_SERVER_<N>_NAME, MCP_SERVER_<N>_TRANSPORT
    // Example:
    //   MCP_SERVER_1_URL=http://localhost:3001/mcp
    //   MCP_SERVER_1_NAME=local-tools
    //   MCP_SERVER_1_TRANSPORT=streamable-http

    for (let i = 1; i <= 10; i++) {
      const url = process.env[`MCP_SERVER_${i}_URL`];
      const name = process.env[`MCP_SERVER_${i}_NAME`] || `mcp-server-${i}`;
      const transport = (process.env[`MCP_SERVER_${i}_TRANSPORT`] || 'streamable-http') as
        | 'streamable-http'
        | 'sse';
      const apiKey = process.env[`MCP_SERVER_${i}_API_KEY`];

      if (url) {
        configs.push({
          id: `env-mcp-${i}`,
          name,
          url,
          transport,
          authType: apiKey ? 'api-key' : 'none',
          authConfig: apiKey
            ? {
                type: 'api-key',
                apiKey: {
                  apiKey,
                  headerName: 'Authorization',
                  headerPrefix: 'Bearer',
                },
              }
            : { type: 'none' },
          enabled: true,
          priority: i,
          connectionTimeoutMs: 30000,
          requestTimeoutMs: 60000,
          maxRetries: 3,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }
    }

    return configs;
  }
}

// Create MCP client manager (will be null if no MCP servers configured)
let mcpClientManager: MCPClientManager | null = null;
let compositeToolInvoker: CompositeToolInvoker | null = null;

// Register all tools and initialize MCP
async function initializeToolRegistry(): Promise<void> {
  const log = logger.child({ module: 'orchestrator.init' });
  log.info('Initializing tool registry');

  // Built-in tools (get_current_time, calculate)
  registerBuiltInTools(toolRegistry);

  // Memory tools (remember, recall)
  registerMemoryTools(toolRegistry, memoryStore);

  // Knowledge graph tools (kg_create_entity, kg_create_relation, kg_query, kg_get_entity)
  registerKnowledgeGraphTools(toolRegistry, knowledgeGraph);

  // Session continuity tools (session_start, session_end, session_capture_*, session_recall, etc.)
  registerSessionTools(toolRegistry, knowledgeGraph);

  // Web tools (web_search, web_fetch)
  registerWebTools(toolRegistry);

  log.info('Local tool registry initialized', {
    toolCount: toolRegistry.getRegisteredToolIds().length,
    tools: toolRegistry.getRegisteredToolIds(),
  });

  // Initialize MCP client manager
  try {
    const configLoader = new EnvMCPConfigLoader();
    const configs = await configLoader.loadConfigurations();

    if (configs.length > 0) {
      log.info('Initializing MCP client manager', { serverCount: configs.length });

      mcpClientManager = new MCPClientManager(configLoader);
      await mcpClientManager.initialize();

      log.info('MCP client manager initialized', {
        servers: mcpClientManager.getServerIds(),
      });

      // Initialize Composio session manager for per-user sessions
      try {
        const composioClient = getComposioClient();
        const composioService = new ComposioIntegrationService(
          composioClient,
          process.env.COMPOSIO_CALLBACK_SCHEME || 'jarvis://'
        );
        const composioSessionManager = new ComposioSessionManager(db, composioService);
        mcpClientManager.setComposioSessionManager(composioSessionManager);
        log.info('Composio session manager configured for per-user sessions');
      } catch (composioError) {
        log.warn('Failed to initialize Composio session manager - continuing without per-user sessions', 
          composioError as Record<string, unknown>);
      }
    } else {
      log.info('No MCP servers configured, skipping MCP initialization');
    }
  } catch (error) {
    log.warn('Failed to initialize MCP client manager', error as Record<string, unknown>);
    // Continue without MCP - graceful degradation
    mcpClientManager = null;
  }

  // Create composite tool invoker
  compositeToolInvoker = new CompositeToolInvoker(toolRegistry, mcpClientManager);
  log.info('Composite tool invoker created');
}

// Initialize on module load
initializeToolRegistry().catch((error) => {
  logger.error('Failed to initialize tool registry', error as Record<string, unknown>);
});

// =============================================================================
// Service Factory
// =============================================================================

export function createOrchestratorService(onEvent: (event: StreamEvent) => void): OrchestratorService {
  const llm = llmRouter.getPowerfulProvider();
  
  // Create context management service for automatic summarization
  const tokenCounter = new TokenCounterService();
  const summaryLLM = llmRouter.getProvider('fast'); // Use fast model for summarization
  const contextManager = new ContextManagementService(tokenCounter, summaryLLM);
  
  // Create conversation history service (lazy init, singleton)
  if (!conversationHistoryService) {
    conversationHistoryService = new ConversationHistoryService(
      messageRepository,
      conversationSummaryRepository,
      tokenCounter,
      summaryLLM
    );
  }
  
  const planService = new TaskPlanService(stateRepository, cacheAdapter);
  const loopDetection = new LoopDetectionService(cacheAdapter, stateRepository);

  // Use composite tool invoker if available (includes MCP tools)
  // Falls back to local tool registry if MCP not initialized yet
  const toolInvoker = compositeToolInvoker || toolRegistry;

  const agentManager = new SubAgentManager(
    llm,
    toolInvoker,
    stateRepository,
    cacheAdapter,
    contextManager
  );

  return new OrchestratorService(
    llm,
    toolInvoker,
    memoryStore,
    stateRepository,
    cacheAdapter,
    planService,
    agentManager,
    loopDetection,
    contextManager,
    conversationHistoryService,
    agentRunRepository,
    {
      onEvent,
      enableExamplePrompts: config.ENABLE_EXAMPLE_PROMPTS === 'true',
      examplePromptsPath: config.EXAMPLE_PROMPTS_PATH,
    }
  );
}

/**
 * Get the MCP client manager (for use by MCP routes)
 */
export function getMCPClientManager(): MCPClientManager | null {
  return mcpClientManager;
}

/**
 * Get the tool registry (for use by MCP routes)
 */
export function getToolRegistry(): ToolRegistry {
  return toolRegistry;
}

// =============================================================================
// Routes
// =============================================================================

export const orchestratorRoutes = new Hono();

/**
 * POST /api/v1/orchestrator/run
 * Start an orchestrator run with streaming response.
 * 
 * This is the main entry point for user requests.
 * The orchestrator will:
 * 1. Analyze the request
 * 2. Decide whether to respond directly, execute directly, or create a plan
 * 3. Stream events back to the client as it executes
 */
orchestratorRoutes.post('/run', zValidator('json', orchestratorRunSchema), async (c) => {
  const { input } = c.req.valid('json');
  // TODO: Get userId from auth middleware in production
  const userId = await getTestUserId();
  const runId = uuidv4();

  const log = logger.child({ runId, userId });
  log.info('Starting orchestrator run', { inputPreview: input.slice(0, 100) });

  // Return SSE stream
  return streamSSE(c, async (stream) => {
    const writer = createHonoSSEWriter(stream);
    eventStreamAdapter.registerWriter(runId, writer);

    try {
      const orchestrator = createOrchestratorService((event) => {
        log.debug('Event emitted', { eventType: event.type });
        // Publish event to SSE stream
        eventStreamAdapter.publish(userId, runId, event).catch((err) => {
          log.error('Failed to publish event', { error: err, eventType: event.type });
        });
      });

      log.debug('Orchestrator service created, executing run');
      const result = await orchestrator.executeRun(userId as string, runId, input);

      log.info('Orchestrator run completed', {
        success: result.success,
        totalTokens: result.totalTokens,
        error: result.error,
        responsePreview: result.response?.slice(0, 100),
      });

      // Send completion event with the response
      await stream.writeSSE({
        event: 'orchestrator.complete',
        data: JSON.stringify({
          success: result.success,
          response: result.response,
          totalTokens: result.totalTokens,
          totalCost: result.totalCost,
          tasksCompleted: result.tasksCompleted,
          tasksFailed: result.tasksFailed,
          error: result.error,
        }),
      });
      
      // Force flush to ensure the completion event is sent immediately
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((stream as any).flush) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (stream as any).flush();
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      
      log.error('Orchestrator run failed with exception', error, { 
        errorMessage,
      });

      await stream.writeSSE({
        event: 'agent.error',
        data: JSON.stringify({
          message: errorMessage,
          code: 'ORCHESTRATOR_ERROR',
          stack: process.env.NODE_ENV === 'development' ? errorStack : undefined,
        }),
      });
      
      // Force flush to ensure the error event is sent immediately
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((stream as any).flush) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (stream as any).flush();
      }
    } finally {
      eventStreamAdapter.unregisterWriter(runId, writer);
    }
  });
});

/**
 * GET /api/v1/orchestrator/run/:runId/status
 * Get the status of an orchestrator run.
 */
orchestratorRoutes.get('/run/:runId/status', async (c) => {
  const runId = c.req.param('runId');
  
  const state = await cacheAdapter.getOrchestratorState(runId);
  if (!state) {
    return c.json({ error: 'Run not found' }, 404);
  }

  return c.json({
    runId: state.runId,
    status: state.status,
    planId: state.plan?.id || null,
    activeAgents: state.activeAgentIds.length,
    totalTokens: state.totalTokens,
    totalCost: state.totalCost,
    startedAt: state.startedAt,
    completedAt: state.completedAt,
  });
});

/**
 * GET /api/v1/orchestrator/run/:runId/events
 * Subscribe to events for an ongoing run via SSE.
 */
orchestratorRoutes.get('/run/:runId/events', async (c) => {
  const runId = c.req.param('runId');

  return streamSSE(c, async (stream) => {
    const writer = createHonoSSEWriter(stream);
    eventStreamAdapter.registerWriter(runId, writer);

    // Keep the connection open until the run completes or client disconnects
    const state = await cacheAdapter.getOrchestratorState(runId);
    if (!state) {
      await stream.writeSSE({
        event: 'error',
        data: JSON.stringify({ message: 'Run not found' }),
      });
      
      // Force flush to ensure the error event is sent immediately
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((stream as any).flush) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (stream as any).flush();
      }
      return;
    }

    // Subscribe to Redis events
    await cacheAdapter.subscribeToEvents(runId, async (event) => {
      await stream.writeSSE({
        event: event.type,
        data: JSON.stringify(event),
      });
      
      // Force flush to ensure events are sent immediately
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((stream as any).flush) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (stream as any).flush();
      }

      // Close the stream when the run is complete
      if (event.type === 'orchestrator.status') {
        const statusEvent = event as { status: string };
        if (['completed', 'failed'].includes(statusEvent.status)) {
          eventStreamAdapter.unregisterWriter(runId, writer);
        }
      }
    });

    // Wait for completion (this will be interrupted by client disconnect)
    await new Promise<void>((resolve) => {
      const checkInterval = setInterval(async () => {
        const currentState = await cacheAdapter.getOrchestratorState(runId);
        if (!currentState || ['completed', 'failed'].includes(currentState.status)) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 1000);
    });

    eventStreamAdapter.unregisterWriter(runId, writer);
    await cacheAdapter.unsubscribeFromEvents(runId);
  });
});

/**
 * POST /api/v1/orchestrator/run/:runId/cancel
 * Cancel an ongoing orchestrator run.
 */
orchestratorRoutes.post('/run/:runId/cancel', async (c) => {
  const runId = c.req.param('runId');

  const state = await cacheAdapter.getOrchestratorState(runId);
  if (!state) {
    return c.json({ error: 'Run not found' }, 404);
  }

  if (['completed', 'failed'].includes(state.status)) {
    return c.json({ error: 'Run already finished' }, 400);
  }

  // Update status to cancelled
  await stateRepository.updateOrchestratorStatus(runId, 'failed');

  // Publish cancel event
  await cacheAdapter.publishEvent(runId, {
    type: 'orchestrator.status',
    status: 'failed',
    message: 'Run cancelled by user',
  });

  return c.json({ success: true, message: 'Run cancelled' });
});

// =============================================================================
// Conversation History Routes
// =============================================================================

/**
 * GET /api/v1/orchestrator/conversation/history
 * Get conversation history for the current user.
 * 
 * Query params:
 * - limit: number of messages to return (default: 50)
 */
orchestratorRoutes.get('/conversation/history', async (c) => {
  // TODO: Get userId from auth middleware in production
  const userId = await getTestUserId();
  const limit = parseInt(c.req.query('limit') || '50', 10);

  // Lazy initialize conversation history service if not already done
  if (!conversationHistoryService) {
    const tokenCounter = new TokenCounterService();
    const summaryLLM = llmRouter.getProvider('fast');
    conversationHistoryService = new ConversationHistoryService(
      messageRepository,
      conversationSummaryRepository,
      tokenCounter,
      summaryLLM
    );
  }

  try {
    const { messages, totalCount } = await conversationHistoryService.getHistory(userId, limit);

    return c.json({
      messages: messages.map(m => ({
        id: m.id,
        role: m.role,
        content: m.content,
        metadata: m.metadata,
        createdAt: m.createdAt,
      })),
      totalCount,
      hasMore: totalCount > messages.length,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Failed to get conversation history', { error: errorMessage });
    return c.json({ error: 'Failed to get conversation history', message: errorMessage }, 500);
  }
});

/**
 * DELETE /api/v1/orchestrator/conversation/messages/:messageId
 * Delete a specific message from the conversation history.
 */
orchestratorRoutes.delete('/conversation/messages/:messageId', async (c) => {
  // TODO: Get userId from auth middleware in production
  const userId = await getTestUserId();
  const messageId = c.req.param('messageId');

  if (!conversationHistoryService) {
    return c.json({ error: 'Conversation history service not initialized' }, 500);
  }

  const deleted = await conversationHistoryService.deleteMessage(userId, messageId);
  
  if (!deleted) {
    return c.json({ error: 'Message not found or not owned by user' }, 404);
  }

  return c.json({ success: true, message: 'Message deleted' });
});

/**
 * DELETE /api/v1/orchestrator/conversation/history
 * Clear all conversation history for the current user.
 */
orchestratorRoutes.delete('/conversation/history', async (c) => {
  // TODO: Get userId from auth middleware in production
  const userId = await getTestUserId();

  if (!conversationHistoryService) {
    return c.json({ error: 'Conversation history service not initialized' }, 500);
  }

  await conversationHistoryService.clearHistory(userId);

  return c.json({ success: true, message: 'Conversation history cleared' });
});
