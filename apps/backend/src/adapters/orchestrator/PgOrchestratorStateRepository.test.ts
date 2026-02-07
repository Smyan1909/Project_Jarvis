// =============================================================================
// PgOrchestratorStateRepository - Integration Tests
// =============================================================================
// Tests run against the real database to verify SQL queries work correctly.

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { db, queryClient } from '../../infrastructure/db/client.js';
import {
  taskPlans,
  taskNodes,
  subAgents,
  orchestratorStates,
  users,
  agentRuns,
} from '../../infrastructure/db/schema.js';
import { PgOrchestratorStateRepository } from './PgOrchestratorStateRepository.js';
import { UserRepository } from '../storage/user-repository.js';
import { AgentRunRepository } from '../storage/agent-run-repository.js';

describe('PgOrchestratorStateRepository Integration', () => {
  let repo: PgOrchestratorStateRepository;
  let userRepo: UserRepository;
  let agentRunRepo: AgentRunRepository;
  let testUserId: string;
  let testRunId: string;
  const cleanupPlanIds: string[] = [];
  const cleanupNodeIds: string[] = [];
  const cleanupAgentIds: string[] = [];

  beforeAll(async () => {
    repo = new PgOrchestratorStateRepository();
    userRepo = new UserRepository();
    agentRunRepo = new AgentRunRepository();

    // Create a test user
    const user = await userRepo.create({
      email: `orchestrator-test-${Date.now()}@example.com`,
      passwordHash: 'test-hash',
      displayName: 'Orchestrator Test User',
    });
    testUserId = user.id;

    // Create a test agent run
    const run = await agentRunRepo.create(testUserId);
    testRunId = run.id;
  });

  afterEach(async () => {
    // Clean up in reverse dependency order
    for (const agentId of cleanupAgentIds) {
      await db.delete(subAgents).where(sql`id = ${agentId}`);
    }
    cleanupAgentIds.length = 0;

    for (const nodeId of cleanupNodeIds) {
      await db.delete(taskNodes).where(sql`id = ${nodeId}`);
    }
    cleanupNodeIds.length = 0;

    for (const planId of cleanupPlanIds) {
      await db.delete(orchestratorStates).where(sql`plan_id = ${planId}`);
      await db.delete(taskPlans).where(sql`id = ${planId}`);
    }
    cleanupPlanIds.length = 0;

    // Clean up orchestrator states for the test run
    await db.delete(orchestratorStates).where(sql`run_id = ${testRunId}`);
  });

  afterAll(async () => {
    // Clean up test data (cascades)
    await db.delete(agentRuns).where(sql`id = ${testRunId}`);
    await db.delete(users).where(sql`id = ${testUserId}`);
    await queryClient.end();
  });

  // ===========================================================================
  // Task Plans Tests
  // ===========================================================================

  describe('Task Plans', () => {
    describe('createPlan()', () => {
      it('should create a new task plan with planning status', async () => {
        const plan = await repo.createPlan(testRunId);
        cleanupPlanIds.push(plan.id);

        expect(plan).toBeDefined();
        expect(plan.id).toBeDefined();
        expect(plan.runId).toBe(testRunId);
        expect(plan.status).toBe('planning');
        expect(plan.nodes).toEqual([]);
        expect(plan.createdAt).toBeInstanceOf(Date);
        expect(plan.updatedAt).toBeInstanceOf(Date);
      });
    });

    describe('getPlan()', () => {
      it('should find a plan by ID', async () => {
        const created = await repo.createPlan(testRunId);
        cleanupPlanIds.push(created.id);

        const found = await repo.getPlan(created.id);

        expect(found).toBeDefined();
        expect(found!.id).toBe(created.id);
        expect(found!.runId).toBe(testRunId);
      });

      it('should return null for non-existent ID', async () => {
        const found = await repo.getPlan('00000000-0000-0000-0000-000000000000');
        expect(found).toBeNull();
      });

      it('should include task nodes when getting a plan', async () => {
        const plan = await repo.createPlan(testRunId);
        cleanupPlanIds.push(plan.id);

        const node = await repo.createTaskNode(plan.id, {
          description: 'Test task',
          agentType: 'general',
          dependencies: [],
        });
        cleanupNodeIds.push(node.id);

        const found = await repo.getPlan(plan.id);

        expect(found!.nodes).toHaveLength(1);
        expect(found!.nodes[0].description).toBe('Test task');
      });
    });

    describe('getPlanByRunId()', () => {
      it('should find a plan by run ID', async () => {
        const created = await repo.createPlan(testRunId);
        cleanupPlanIds.push(created.id);

        const found = await repo.getPlanByRunId(testRunId);

        expect(found).toBeDefined();
        expect(found!.id).toBe(created.id);
      });

      it('should return null for run with no plan', async () => {
        const newRun = await agentRunRepo.create(testUserId);
        
        const found = await repo.getPlanByRunId(newRun.id);
        
        expect(found).toBeNull();
        
        // Cleanup
        await db.delete(agentRuns).where(sql`id = ${newRun.id}`);
      });
    });

    describe('updatePlanStatus()', () => {
      it('should update plan status', async () => {
        const plan = await repo.createPlan(testRunId);
        cleanupPlanIds.push(plan.id);

        await repo.updatePlanStatus(plan.id, 'executing');

        const found = await repo.getPlan(plan.id);
        expect(found!.status).toBe('executing');
      });
    });
  });

  // ===========================================================================
  // Task Nodes Tests
  // ===========================================================================

  describe('Task Nodes', () => {
    let testPlanId: string;

    beforeAll(async () => {
      // Note: This creates a plan that persists across node tests
      // It will be cleaned up in afterAll
    });

    describe('createTaskNode()', () => {
      it('should create a task node with pending status', async () => {
        const plan = await repo.createPlan(testRunId);
        cleanupPlanIds.push(plan.id);

        const node = await repo.createTaskNode(plan.id, {
          description: 'Research task',
          agentType: 'research',
          dependencies: [],
        });
        cleanupNodeIds.push(node.id);

        expect(node).toBeDefined();
        expect(node.id).toBeDefined();
        expect(node.description).toBe('Research task');
        expect(node.agentType).toBe('research');
        expect(node.status).toBe('pending');
        expect(node.dependencies).toEqual([]);
        expect(node.assignedAgentId).toBeNull();
        expect(node.result).toBeNull();
        expect(node.retryCount).toBe(0);
      });

      it('should create a node with dependencies', async () => {
        const plan = await repo.createPlan(testRunId);
        cleanupPlanIds.push(plan.id);

        const node1 = await repo.createTaskNode(plan.id, {
          description: 'First task',
          agentType: 'general',
          dependencies: [],
        });
        cleanupNodeIds.push(node1.id);

        const node2 = await repo.createTaskNode(plan.id, {
          description: 'Second task',
          agentType: 'coding',
          dependencies: [node1.id],
        });
        cleanupNodeIds.push(node2.id);

        expect(node2.dependencies).toContain(node1.id);
      });
    });

    describe('createTaskNodes()', () => {
      it('should create multiple nodes at once', async () => {
        const plan = await repo.createPlan(testRunId);
        cleanupPlanIds.push(plan.id);

        const nodes = await repo.createTaskNodes(plan.id, [
          { description: 'Task 1', agentType: 'research', dependencies: [] },
          { description: 'Task 2', agentType: 'coding', dependencies: [] },
          { description: 'Task 3', agentType: 'general', dependencies: [] },
        ]);

        nodes.forEach(n => cleanupNodeIds.push(n.id));

        expect(nodes).toHaveLength(3);
        expect(nodes[0].description).toBe('Task 1');
        expect(nodes[1].description).toBe('Task 2');
        expect(nodes[2].description).toBe('Task 3');
      });

      it('should return empty array for empty input', async () => {
        const plan = await repo.createPlan(testRunId);
        cleanupPlanIds.push(plan.id);

        const nodes = await repo.createTaskNodes(plan.id, []);

        expect(nodes).toEqual([]);
      });
    });

    describe('getTaskNode()', () => {
      it('should find a node by ID', async () => {
        const plan = await repo.createPlan(testRunId);
        cleanupPlanIds.push(plan.id);

        const created = await repo.createTaskNode(plan.id, {
          description: 'Find me',
          agentType: 'general',
          dependencies: [],
        });
        cleanupNodeIds.push(created.id);

        const found = await repo.getTaskNode(created.id);

        expect(found).toBeDefined();
        expect(found!.id).toBe(created.id);
        expect(found!.description).toBe('Find me');
      });

      it('should return null for non-existent ID', async () => {
        const found = await repo.getTaskNode('00000000-0000-0000-0000-000000000000');
        expect(found).toBeNull();
      });
    });

    describe('getTaskNodesByPlan()', () => {
      it('should return all nodes for a plan', async () => {
        const plan = await repo.createPlan(testRunId);
        cleanupPlanIds.push(plan.id);

        const node1 = await repo.createTaskNode(plan.id, {
          description: 'Node 1',
          agentType: 'general',
          dependencies: [],
        });
        const node2 = await repo.createTaskNode(plan.id, {
          description: 'Node 2',
          agentType: 'research',
          dependencies: [],
        });
        cleanupNodeIds.push(node1.id, node2.id);

        const nodes = await repo.getTaskNodesByPlan(plan.id);

        expect(nodes).toHaveLength(2);
      });
    });

    describe('updateTaskNodeStatus()', () => {
      it('should update node status', async () => {
        const plan = await repo.createPlan(testRunId);
        cleanupPlanIds.push(plan.id);

        const node = await repo.createTaskNode(plan.id, {
          description: 'Status test',
          agentType: 'general',
          dependencies: [],
        });
        cleanupNodeIds.push(node.id);

        await repo.updateTaskNodeStatus(node.id, 'in_progress');

        const found = await repo.getTaskNode(node.id);
        expect(found!.status).toBe('in_progress');
      });

      it('should set completedAt for terminal statuses', async () => {
        const plan = await repo.createPlan(testRunId);
        cleanupPlanIds.push(plan.id);

        const node = await repo.createTaskNode(plan.id, {
          description: 'Complete test',
          agentType: 'general',
          dependencies: [],
        });
        cleanupNodeIds.push(node.id);

        await repo.updateTaskNodeStatus(node.id, 'completed');

        const found = await repo.getTaskNode(node.id);
        expect(found!.status).toBe('completed');
        expect(found!.completedAt).toBeInstanceOf(Date);
      });
    });

    describe('updateTaskNodeResult()', () => {
      it('should update node result', async () => {
        const plan = await repo.createPlan(testRunId);
        cleanupPlanIds.push(plan.id);

        const node = await repo.createTaskNode(plan.id, {
          description: 'Result test',
          agentType: 'general',
          dependencies: [],
        });
        cleanupNodeIds.push(node.id);

        const result = { summary: 'Task completed', data: [1, 2, 3] };
        await repo.updateTaskNodeResult(node.id, result);

        const found = await repo.getTaskNode(node.id);
        expect(found!.result).toEqual(result);
      });
    });

    describe('assignAgentToNode()', () => {
      it('should assign an agent ID to a node', async () => {
        const plan = await repo.createPlan(testRunId);
        cleanupPlanIds.push(plan.id);

        const node = await repo.createTaskNode(plan.id, {
          description: 'Assign test',
          agentType: 'general',
          dependencies: [],
        });
        cleanupNodeIds.push(node.id);

        const agentId = '12345678-1234-1234-1234-123456789012';
        await repo.assignAgentToNode(node.id, agentId);

        const found = await repo.getTaskNode(node.id);
        expect(found!.assignedAgentId).toBe(agentId);
      });
    });

    describe('incrementRetryCount()', () => {
      it('should increment retry count and return new value', async () => {
        const plan = await repo.createPlan(testRunId);
        cleanupPlanIds.push(plan.id);

        const node = await repo.createTaskNode(plan.id, {
          description: 'Retry test',
          agentType: 'general',
          dependencies: [],
        });
        cleanupNodeIds.push(node.id);

        const count1 = await repo.incrementRetryCount(node.id);
        const count2 = await repo.incrementRetryCount(node.id);
        const count3 = await repo.incrementRetryCount(node.id);

        expect(count1).toBe(1);
        expect(count2).toBe(2);
        expect(count3).toBe(3);

        const found = await repo.getTaskNode(node.id);
        expect(found!.retryCount).toBe(3);
      });
    });
  });

  // ===========================================================================
  // Sub-Agents Tests
  // ===========================================================================

  describe('Sub-Agents', () => {
    describe('createSubAgent()', () => {
      it('should create a sub-agent with initial state', async () => {
        const plan = await repo.createPlan(testRunId);
        cleanupPlanIds.push(plan.id);

        const node = await repo.createTaskNode(plan.id, {
          description: 'Agent task',
          agentType: 'research',
          dependencies: [],
        });
        cleanupNodeIds.push(node.id);

        const agent = await repo.createSubAgent({
          runId: testRunId,
          taskNodeId: node.id,
          agentType: 'research',
          status: 'initializing',
          taskDescription: 'Research the topic',
          upstreamContext: 'Previous context here',
          additionalTools: ['web_search', 'web_fetch'],
        });
        cleanupAgentIds.push(agent.id);

        expect(agent).toBeDefined();
        expect(agent.id).toBeDefined();
        expect(agent.runId).toBe(testRunId);
        expect(agent.taskNodeId).toBe(node.id);
        expect(agent.agentType).toBe('research');
        expect(agent.status).toBe('initializing');
        expect(agent.taskDescription).toBe('Research the topic');
        expect(agent.upstreamContext).toBe('Previous context here');
        expect(agent.additionalTools).toEqual(['web_search', 'web_fetch']);
        expect(agent.messages).toEqual([]);
        expect(agent.toolCalls).toEqual([]);
        expect(agent.reasoningSteps).toEqual([]);
        expect(agent.artifacts).toEqual([]);
        expect(agent.totalTokens).toBe(0);
        expect(agent.totalCost).toBe(0);
      });
    });

    describe('getSubAgent()', () => {
      it('should find a sub-agent by ID', async () => {
        const plan = await repo.createPlan(testRunId);
        cleanupPlanIds.push(plan.id);

        const node = await repo.createTaskNode(plan.id, {
          description: 'Find agent task',
          agentType: 'general',
          dependencies: [],
        });
        cleanupNodeIds.push(node.id);

        const created = await repo.createSubAgent({
          runId: testRunId,
          taskNodeId: node.id,
          agentType: 'general',
          status: 'running',
          taskDescription: 'Do something',
          upstreamContext: null,
          additionalTools: [],
        });
        cleanupAgentIds.push(created.id);

        const found = await repo.getSubAgent(created.id);

        expect(found).toBeDefined();
        expect(found!.id).toBe(created.id);
      });

      it('should return null for non-existent ID', async () => {
        const found = await repo.getSubAgent('00000000-0000-0000-0000-000000000000');
        expect(found).toBeNull();
      });
    });

    describe('getSubAgentsByRun()', () => {
      it('should return all agents for a run', async () => {
        const plan = await repo.createPlan(testRunId);
        cleanupPlanIds.push(plan.id);

        const node1 = await repo.createTaskNode(plan.id, {
          description: 'Task 1',
          agentType: 'general',
          dependencies: [],
        });
        const node2 = await repo.createTaskNode(plan.id, {
          description: 'Task 2',
          agentType: 'research',
          dependencies: [],
        });
        cleanupNodeIds.push(node1.id, node2.id);

        const agent1 = await repo.createSubAgent({
          runId: testRunId,
          taskNodeId: node1.id,
          agentType: 'general',
          status: 'running',
          taskDescription: 'Task 1',
          upstreamContext: null,
          additionalTools: [],
        });
        const agent2 = await repo.createSubAgent({
          runId: testRunId,
          taskNodeId: node2.id,
          agentType: 'research',
          status: 'running',
          taskDescription: 'Task 2',
          upstreamContext: null,
          additionalTools: [],
        });
        cleanupAgentIds.push(agent1.id, agent2.id);

        const agents = await repo.getSubAgentsByRun(testRunId);

        expect(agents.length).toBeGreaterThanOrEqual(2);
      });
    });

    describe('getActiveSubAgents()', () => {
      it('should return only running and initializing agents', async () => {
        const plan = await repo.createPlan(testRunId);
        cleanupPlanIds.push(plan.id);

        const node1 = await repo.createTaskNode(plan.id, {
          description: 'Active task',
          agentType: 'general',
          dependencies: [],
        });
        const node2 = await repo.createTaskNode(plan.id, {
          description: 'Completed task',
          agentType: 'research',
          dependencies: [],
        });
        cleanupNodeIds.push(node1.id, node2.id);

        const activeAgent = await repo.createSubAgent({
          runId: testRunId,
          taskNodeId: node1.id,
          agentType: 'general',
          status: 'running',
          taskDescription: 'Active',
          upstreamContext: null,
          additionalTools: [],
        });
        const completedAgent = await repo.createSubAgent({
          runId: testRunId,
          taskNodeId: node2.id,
          agentType: 'research',
          status: 'completed',
          taskDescription: 'Done',
          upstreamContext: null,
          additionalTools: [],
        });
        cleanupAgentIds.push(activeAgent.id, completedAgent.id);

        const activeAgents = await repo.getActiveSubAgents(testRunId);

        const activeIds = activeAgents.map(a => a.id);
        expect(activeIds).toContain(activeAgent.id);
        expect(activeIds).not.toContain(completedAgent.id);
      });
    });

    describe('updateSubAgentStatus()', () => {
      it('should update agent status', async () => {
        const plan = await repo.createPlan(testRunId);
        cleanupPlanIds.push(plan.id);

        const node = await repo.createTaskNode(plan.id, {
          description: 'Status test',
          agentType: 'general',
          dependencies: [],
        });
        cleanupNodeIds.push(node.id);

        const agent = await repo.createSubAgent({
          runId: testRunId,
          taskNodeId: node.id,
          agentType: 'general',
          status: 'initializing',
          taskDescription: 'Test',
          upstreamContext: null,
          additionalTools: [],
        });
        cleanupAgentIds.push(agent.id);

        await repo.updateSubAgentStatus(agent.id, 'running');

        const found = await repo.getSubAgent(agent.id);
        expect(found!.status).toBe('running');
      });

      it('should set completedAt for terminal statuses', async () => {
        const plan = await repo.createPlan(testRunId);
        cleanupPlanIds.push(plan.id);

        const node = await repo.createTaskNode(plan.id, {
          description: 'Complete test',
          agentType: 'general',
          dependencies: [],
        });
        cleanupNodeIds.push(node.id);

        const agent = await repo.createSubAgent({
          runId: testRunId,
          taskNodeId: node.id,
          agentType: 'general',
          status: 'running',
          taskDescription: 'Test',
          upstreamContext: null,
          additionalTools: [],
        });
        cleanupAgentIds.push(agent.id);

        await repo.updateSubAgentStatus(agent.id, 'completed');

        const found = await repo.getSubAgent(agent.id);
        expect(found!.status).toBe('completed');
        expect(found!.completedAt).toBeInstanceOf(Date);
      });
    });

    describe('appendMessage()', () => {
      it('should append a message to agent history', async () => {
        const plan = await repo.createPlan(testRunId);
        cleanupPlanIds.push(plan.id);

        const node = await repo.createTaskNode(plan.id, {
          description: 'Message test',
          agentType: 'general',
          dependencies: [],
        });
        cleanupNodeIds.push(node.id);

        const agent = await repo.createSubAgent({
          runId: testRunId,
          taskNodeId: node.id,
          agentType: 'general',
          status: 'running',
          taskDescription: 'Test',
          upstreamContext: null,
          additionalTools: [],
        });
        cleanupAgentIds.push(agent.id);

        const message = { role: 'user' as const, content: 'Hello' };
        await repo.appendMessage(agent.id, message);

        const found = await repo.getSubAgent(agent.id);
        expect(found!.messages).toHaveLength(1);
        expect(found!.messages[0].content).toBe('Hello');
      });

      it('should append multiple messages in order', async () => {
        const plan = await repo.createPlan(testRunId);
        cleanupPlanIds.push(plan.id);

        const node = await repo.createTaskNode(plan.id, {
          description: 'Multi-message test',
          agentType: 'general',
          dependencies: [],
        });
        cleanupNodeIds.push(node.id);

        const agent = await repo.createSubAgent({
          runId: testRunId,
          taskNodeId: node.id,
          agentType: 'general',
          status: 'running',
          taskDescription: 'Test',
          upstreamContext: null,
          additionalTools: [],
        });
        cleanupAgentIds.push(agent.id);

        await repo.appendMessage(agent.id, { role: 'user', content: 'First' });
        await repo.appendMessage(agent.id, { role: 'assistant', content: 'Second' });
        await repo.appendMessage(agent.id, { role: 'user', content: 'Third' });

        const found = await repo.getSubAgent(agent.id);
        expect(found!.messages).toHaveLength(3);
        expect(found!.messages[0].content).toBe('First');
        expect(found!.messages[1].content).toBe('Second');
        expect(found!.messages[2].content).toBe('Third');
      });
    });

    describe('appendToolCall()', () => {
      it('should append a tool call to agent history', async () => {
        const plan = await repo.createPlan(testRunId);
        cleanupPlanIds.push(plan.id);

        const node = await repo.createTaskNode(plan.id, {
          description: 'Tool call test',
          agentType: 'general',
          dependencies: [],
        });
        cleanupNodeIds.push(node.id);

        const agent = await repo.createSubAgent({
          runId: testRunId,
          taskNodeId: node.id,
          agentType: 'general',
          status: 'running',
          taskDescription: 'Test',
          upstreamContext: null,
          additionalTools: [],
        });
        cleanupAgentIds.push(agent.id);

        const toolCall = {
          id: 'call-123',
          runId: testRunId,
          toolId: 'web_search',
          input: { query: 'test' },
          output: { results: [] },
          status: 'success' as const,
          durationMs: 100,
          createdAt: new Date(),
        };
        await repo.appendToolCall(agent.id, toolCall);

        const found = await repo.getSubAgent(agent.id);
        expect(found!.toolCalls).toHaveLength(1);
        expect(found!.toolCalls[0].toolId).toBe('web_search');
      });
    });

    describe('updateSubAgentMetrics()', () => {
      it('should increment tokens and cost', async () => {
        const plan = await repo.createPlan(testRunId);
        cleanupPlanIds.push(plan.id);

        const node = await repo.createTaskNode(plan.id, {
          description: 'Metrics test',
          agentType: 'general',
          dependencies: [],
        });
        cleanupNodeIds.push(node.id);

        const agent = await repo.createSubAgent({
          runId: testRunId,
          taskNodeId: node.id,
          agentType: 'general',
          status: 'running',
          taskDescription: 'Test',
          upstreamContext: null,
          additionalTools: [],
        });
        cleanupAgentIds.push(agent.id);

        await repo.updateSubAgentMetrics(agent.id, 100, 0.001);
        await repo.updateSubAgentMetrics(agent.id, 200, 0.002);

        const found = await repo.getSubAgent(agent.id);
        expect(found!.totalTokens).toBe(300);
        expect(found!.totalCost).toBeCloseTo(0.003, 5);
      });
    });

    describe('setGuidance() and clearGuidance()', () => {
      it('should set and clear guidance', async () => {
        const plan = await repo.createPlan(testRunId);
        cleanupPlanIds.push(plan.id);

        const node = await repo.createTaskNode(plan.id, {
          description: 'Guidance test',
          agentType: 'general',
          dependencies: [],
        });
        cleanupNodeIds.push(node.id);

        const agent = await repo.createSubAgent({
          runId: testRunId,
          taskNodeId: node.id,
          agentType: 'general',
          status: 'running',
          taskDescription: 'Test',
          upstreamContext: null,
          additionalTools: [],
        });
        cleanupAgentIds.push(agent.id);

        await repo.setGuidance(agent.id, 'Focus on the main topic');

        // Note: guidance is stored in pendingGuidance, not directly accessible
        // This test verifies the operation doesn't throw

        await repo.clearGuidance(agent.id);
        // Verify no error on clear
      });
    });
  });

  // ===========================================================================
  // Orchestrator State Tests
  // ===========================================================================

  describe('Orchestrator State', () => {
    describe('createOrchestratorState()', () => {
      it('should create orchestrator state with idle status', async () => {
        const state = await repo.createOrchestratorState(testRunId, testUserId);

        expect(state).toBeDefined();
        expect(state.id).toBeDefined();
        expect(state.runId).toBe(testRunId);
        expect(state.userId).toBe(testUserId);
        expect(state.status).toBe('idle');
        expect(state.plan).toBeNull();
        expect(state.activeAgentIds).toEqual([]);
        expect(state.loopCounters).toEqual({});
        expect(state.totalInterventions).toBe(0);
        expect(state.totalTokens).toBe(0);
        expect(state.totalCost).toBe(0);
      });
    });

    describe('getOrchestratorState()', () => {
      it('should find state by run ID', async () => {
        await repo.createOrchestratorState(testRunId, testUserId);

        const found = await repo.getOrchestratorState(testRunId);

        expect(found).toBeDefined();
        expect(found!.runId).toBe(testRunId);
      });

      it('should return null for non-existent run', async () => {
        const found = await repo.getOrchestratorState('00000000-0000-0000-0000-000000000000');
        expect(found).toBeNull();
      });

      it('should hydrate plan when present', async () => {
        await repo.createOrchestratorState(testRunId, testUserId);

        const plan = await repo.createPlan(testRunId);
        cleanupPlanIds.push(plan.id);

        await repo.updateOrchestratorPlan(testRunId, plan.id);

        const found = await repo.getOrchestratorState(testRunId);

        expect(found!.plan).toBeDefined();
        expect(found!.plan!.id).toBe(plan.id);
      });
    });

    describe('updateOrchestratorStatus()', () => {
      it('should update status', async () => {
        await repo.createOrchestratorState(testRunId, testUserId);

        await repo.updateOrchestratorStatus(testRunId, 'executing');

        const found = await repo.getOrchestratorState(testRunId);
        expect(found!.status).toBe('executing');
      });

      it('should set completedAt for terminal statuses', async () => {
        await repo.createOrchestratorState(testRunId, testUserId);

        await repo.updateOrchestratorStatus(testRunId, 'completed');

        const found = await repo.getOrchestratorState(testRunId);
        expect(found!.status).toBe('completed');
        expect(found!.completedAt).toBeInstanceOf(Date);
      });
    });

    describe('addActiveAgent() and removeActiveAgent()', () => {
      it('should add and remove active agents', async () => {
        await repo.createOrchestratorState(testRunId, testUserId);

        // Use valid UUIDs for agent IDs (active_agent_ids is UUID[] in the database)
        const agentId1 = '11111111-1111-1111-1111-111111111111';
        const agentId2 = '22222222-2222-2222-2222-222222222222';

        await repo.addActiveAgent(testRunId, agentId1);
        await repo.addActiveAgent(testRunId, agentId2);

        let found = await repo.getOrchestratorState(testRunId);
        expect(found!.activeAgentIds).toContain(agentId1);
        expect(found!.activeAgentIds).toContain(agentId2);

        await repo.removeActiveAgent(testRunId, agentId1);

        found = await repo.getOrchestratorState(testRunId);
        expect(found!.activeAgentIds).not.toContain(agentId1);
        expect(found!.activeAgentIds).toContain(agentId2);
      });
    });

    describe('incrementLoopCounter()', () => {
      it('should increment loop counter for a task', async () => {
        await repo.createOrchestratorState(testRunId, testUserId);

        const taskNodeId = '12345678-1234-1234-1234-123456789012';

        const count1 = await repo.incrementLoopCounter(testRunId, taskNodeId);
        const count2 = await repo.incrementLoopCounter(testRunId, taskNodeId);
        const count3 = await repo.incrementLoopCounter(testRunId, taskNodeId);

        expect(count1).toBe(1);
        expect(count2).toBe(2);
        expect(count3).toBe(3);

        const found = await repo.getOrchestratorState(testRunId);
        expect(found!.loopCounters[taskNodeId]).toBe(3);
      });
    });

    describe('incrementInterventions()', () => {
      it('should increment intervention count', async () => {
        await repo.createOrchestratorState(testRunId, testUserId);

        const count1 = await repo.incrementInterventions(testRunId);
        const count2 = await repo.incrementInterventions(testRunId);

        expect(count1).toBe(1);
        expect(count2).toBe(2);

        const found = await repo.getOrchestratorState(testRunId);
        expect(found!.totalInterventions).toBe(2);
      });
    });

    describe('updateOrchestratorMetrics()', () => {
      it('should increment tokens and cost', async () => {
        await repo.createOrchestratorState(testRunId, testUserId);

        await repo.updateOrchestratorMetrics(testRunId, 500, 0.01);
        await repo.updateOrchestratorMetrics(testRunId, 300, 0.005);

        const found = await repo.getOrchestratorState(testRunId);
        expect(found!.totalTokens).toBe(800);
        expect(found!.totalCost).toBeCloseTo(0.015, 5);
      });
    });
  });
});
