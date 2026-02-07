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
import {
  ToolRegistry,
  registerBuiltInTools,
} from '../../../application/services/ToolRegistry.js';
import { registerMemoryTools, registerKnowledgeGraphTools } from '../../../application/services/MemoryTools.js';
import { registerWebTools } from '../../../application/services/WebTools.js';

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

// MCP Integration
import { MCPClientManager, type MCPConfigLoader } from '../../../adapters/mcp/MCPClientManager.js';
import { CompositeToolInvoker } from '../../../adapters/tools/CompositeToolInvoker.js';

// LLM and Tools
import { llmRouter } from '../../../application/services/LLMRouterService.js';
import { logger } from '../../../infrastructure/logging/logger.js';

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

function createOrchestratorService(onEvent: (event: StreamEvent) => void): OrchestratorService {
  const llm = llmRouter.getPowerfulProvider();
  
  // Create context management service for automatic summarization
  const tokenCounter = new TokenCounterService();
  const summaryLLM = llmRouter.getProvider('fast'); // Use fast model for summarization
  const contextManager = new ContextManagementService(tokenCounter, summaryLLM);
  
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
    { onEvent }
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
  // For now, use a placeholder userId - in production this comes from auth middleware
  const userId = 'anonymous';
  const runId = uuidv4();

  const log = logger.child({ runId, userId });
  log.info('Starting orchestrator run', { inputPreview: input.slice(0, 100) });

  // Return SSE stream
  return streamSSE(c, async (stream) => {
    const writer = createHonoSSEWriter(stream);
    eventStreamAdapter.registerWriter(runId, writer);

    try {
      const orchestrator = createOrchestratorService((event) => {
        // Events are already published via the adapter, but we can log here
        log.debug('Event emitted', { eventType: event.type });
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
      return;
    }

    // Subscribe to Redis events
    await cacheAdapter.subscribeToEvents(runId, async (event) => {
      await stream.writeSSE({
        event: event.type,
        data: JSON.stringify(event),
      });

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
