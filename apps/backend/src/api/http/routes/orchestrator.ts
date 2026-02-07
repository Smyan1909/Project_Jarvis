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
import type { StreamEvent } from '@project-jarvis/shared-types';

// Services
import { OrchestratorService } from '../../../application/services/OrchestratorService.js';
import { TaskPlanService } from '../../../application/services/TaskPlanService.js';
import { SubAgentManager } from '../../../application/services/SubAgentManager.js';
import { LoopDetectionService } from '../../../application/services/LoopDetectionService.js';
import {
  ToolRegistry,
  registerBuiltInTools,
} from '../../../application/services/ToolRegistry.js';
import { registerMemoryTools, registerKnowledgeGraphTools } from '../../../application/services/MemoryTools.js';
import { registerWebTools } from '../../../application/services/WebTools.js';

// Adapters
import {
  InMemoryOrchestratorStateRepository,
} from '../../../adapters/orchestrator/OrchestratorStateRepository.js';
import {
  InMemoryOrchestratorCacheAdapter,
} from '../../../adapters/orchestrator/OrchestratorCacheAdapter.js';
import {
  OrchestratorEventStreamAdapter,
  createHonoSSEWriter,
} from '../../../adapters/orchestrator/OrchestratorEventStreamAdapter.js';
import { InMemoryMemoryStore } from '../../../adapters/memory/InMemoryMemoryStore.js';
import { InMemoryKnowledgeGraph } from '../../../adapters/kg/InMemoryKnowledgeGraph.js';
import { VercelEmbeddingAdapter } from '../../../adapters/embedding/VercelEmbeddingAdapter.js';

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

// Create singleton instances for MVP
// In production, these would be injected via a DI container
const stateRepository = new InMemoryOrchestratorStateRepository();
const cacheAdapter = new InMemoryOrchestratorCacheAdapter();
const eventStreamAdapter = new OrchestratorEventStreamAdapter(cacheAdapter);

// Create embedding adapter for memory and KG
const embeddingAdapter = new VercelEmbeddingAdapter();

// Create real memory store and knowledge graph
const memoryStore = new InMemoryMemoryStore(embeddingAdapter);
const knowledgeGraph = new InMemoryKnowledgeGraph(embeddingAdapter);

// Create tool registry with all tools registered
const toolRegistry = new ToolRegistry();

// Register all tools
function initializeToolRegistry(): void {
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

  log.info('Tool registry initialized', {
    toolCount: toolRegistry.getRegisteredToolIds().length,
    tools: toolRegistry.getRegisteredToolIds(),
  });
}

// Initialize on module load
initializeToolRegistry();

// =============================================================================
// Service Factory
// =============================================================================

function createOrchestratorService(onEvent: (event: StreamEvent) => void): OrchestratorService {
  const llm = llmRouter.getPowerfulProvider();
  
  const planService = new TaskPlanService(stateRepository, cacheAdapter);
  const loopDetection = new LoopDetectionService(cacheAdapter, stateRepository);
  const agentManager = new SubAgentManager(
    llm,
    toolRegistry,
    stateRepository,
    cacheAdapter
  );

  return new OrchestratorService(
    llm,
    toolRegistry,
    memoryStore,
    stateRepository,
    cacheAdapter,
    planService,
    agentManager,
    loopDetection,
    { onEvent }
  );
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

  // Return SSE stream
  return streamSSE(c, async (stream) => {
    const writer = createHonoSSEWriter(stream);
    eventStreamAdapter.registerWriter(runId, writer);

    try {
      const orchestrator = createOrchestratorService((event) => {
        // Events are already published via the adapter, but we can log here
        console.log(`[Run ${runId}] Event: ${event.type}`);
      });

      const result = await orchestrator.executeRun(userId as string, runId, input);

      // Send completion event
      await stream.writeSSE({
        event: 'orchestrator.complete',
        data: JSON.stringify({
          success: result.success,
          totalTokens: result.totalTokens,
          totalCost: result.totalCost,
          tasksCompleted: result.tasksCompleted,
          tasksFailed: result.tasksFailed,
        }),
      });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[Run ${runId}] Error:`, error);

      await stream.writeSSE({
        event: 'agent.error',
        data: JSON.stringify({
          message: errorMessage,
          code: 'ORCHESTRATOR_ERROR',
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
