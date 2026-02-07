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

// LLM and Tools
import { llmRouter } from '../../../application/services/LLMRouterService.js';

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

// =============================================================================
// Mock Tool Invoker (for MVP - replace with real implementation)
// =============================================================================

import type { ToolInvokerPort } from '../../../ports/ToolInvokerPort.js';
import type { ToolDefinition, ToolResult } from '@project-jarvis/shared-types';

class MockToolInvoker implements ToolInvokerPort {
  private tools: ToolDefinition[] = [
    {
      id: 'get_current_time',
      name: 'get_current_time',
      description: 'Get the current date and time',
      parameters: {
        type: 'object',
        properties: {
          timezone: { type: 'string', description: 'Timezone (e.g., "America/New_York", "UTC")' },
        },
      },
    },
    {
      id: 'calculate',
      name: 'calculate',
      description: 'Perform mathematical calculations',
      parameters: {
        type: 'object',
        properties: {
          expression: { type: 'string', description: 'Mathematical expression to evaluate' },
        },
        required: ['expression'],
      },
    },
    {
      id: 'recall',
      name: 'recall',
      description: 'Search memories for relevant information',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'What to search for in memories' },
          limit: { type: 'number', description: 'Maximum number of memories to return' },
        },
        required: ['query'],
      },
    },
  ];

  async getTools(userId: string): Promise<ToolDefinition[]> {
    return this.tools;
  }

  async invoke(userId: string, toolId: string, input: Record<string, unknown>): Promise<ToolResult> {
    switch (toolId) {
      case 'get_current_time': {
        const tz = (input.timezone as string) || 'UTC';
        return {
          success: true,
          output: {
            datetime: new Date().toLocaleString('en-US', { timeZone: tz }),
            timezone: tz,
            timestamp: Date.now(),
          },
        };
      }
      case 'calculate': {
        try {
          const expr = input.expression as string;
          // Safe evaluation using Function constructor with limited scope
          const safeEval = new Function(
            'Math',
            `return ${expr.replace(/[^0-9+\-*/().sqrt,pow,sin,cos,tan,log,abs,floor,ceil,round\s]/g, '')}`
          );
          const result = safeEval(Math);
          return { success: true, output: { expression: expr, result } };
        } catch (error) {
          return { success: false, output: null, error: 'Invalid expression' };
        }
      }
      case 'recall': {
        // Mock memory recall - returns empty for now
        return {
          success: true,
          output: { found: 0, memories: [] },
        };
      }
      default:
        return { success: false, output: null, error: `Unknown tool: ${toolId}` };
    }
  }

  async hasPermission(userId: string, toolId: string): Promise<boolean> {
    return this.tools.some(t => t.id === toolId);
  }
}

const mockToolInvoker = new MockToolInvoker();

// =============================================================================
// Mock Memory Store (for MVP - replace with real implementation)
// =============================================================================

import type { MemoryStorePort } from '../../../ports/MemoryStorePort.js';
import type { MemoryItem, MemorySearchResult } from '@project-jarvis/shared-types';

class MockMemoryStore implements MemoryStorePort {
  private memories: Map<string, MemoryItem> = new Map();

  async store(userId: string, content: string, metadata?: Record<string, unknown>): Promise<MemoryItem> {
    const item: MemoryItem = {
      id: uuidv4(),
      userId,
      content,
      embedding: [], // Would be real embeddings in production
      metadata: metadata || {},
      createdAt: new Date(),
    };
    this.memories.set(item.id, item);
    return item;
  }

  async search(userId: string, query: string, limit?: number): Promise<MemorySearchResult[]> {
    // Mock search - returns recent memories for the user
    const userMemories = Array.from(this.memories.values())
      .filter(m => m.userId === userId)
      .slice(0, limit || 5)
      .map(m => ({
        id: m.id,
        content: m.content,
        metadata: m.metadata,
        similarity: 0.8, // Mock similarity
        createdAt: m.createdAt,
      }));
    return userMemories;
  }

  async getRecent(userId: string, limit?: number): Promise<MemoryItem[]> {
    return Array.from(this.memories.values())
      .filter(m => m.userId === userId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit || 10);
  }

  async delete(userId: string, memoryId: string): Promise<void> {
    const memory = this.memories.get(memoryId);
    if (memory && memory.userId === userId) {
      this.memories.delete(memoryId);
    }
  }
}

const mockMemoryStore = new MockMemoryStore();

// =============================================================================
// Service Factory
// =============================================================================

function createOrchestratorService(onEvent: (event: StreamEvent) => void): OrchestratorService {
  const llm = llmRouter.getPowerfulProvider();
  
  const planService = new TaskPlanService(stateRepository, cacheAdapter);
  const loopDetection = new LoopDetectionService(cacheAdapter, stateRepository);
  const agentManager = new SubAgentManager(
    llm,
    mockToolInvoker,
    stateRepository,
    cacheAdapter
  );

  return new OrchestratorService(
    llm,
    mockToolInvoker,
    mockMemoryStore,
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
