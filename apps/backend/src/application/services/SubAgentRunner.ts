// =============================================================================
// Sub-Agent Runner
// =============================================================================
// Executes an individual sub-agent's task. Handles:
// - LLM interaction with streaming
// - Tool execution (scoped to agent type)
// - Reasoning step emission
// - Guidance injection from orchestrator
// - Graceful cancellation

import { v4 as uuidv4 } from 'uuid';
import { EventEmitter } from 'events';
import type {
  SubAgentState,
  SubAgentResult,
  AgentType,
  LLMMessage,
  ToolCall,
  ReasoningStep,
  Artifact,
  ToolDefinition,
  ToolResult,
  StreamEvent,
} from '@project-jarvis/shared-types';
import type { LLMProviderPort, StreamChunk } from '../../ports/LLMProviderPort.js';
import type { ToolInvokerPort } from '../../ports/ToolInvokerPort.js';
import type { IOrchestratorStateRepository } from '../../adapters/orchestrator/OrchestratorStateRepository.js';
import { getAgentTools, AGENT_CAPABILITIES } from '../../domain/orchestrator/AgentToolScopes.js';
import type { ContextManagementService } from './ContextManagementService.js';

// =============================================================================
// Sub-Agent Configuration
// =============================================================================

export interface SubAgentConfig {
  agentId: string;
  runId: string;
  taskNodeId: string;
  agentType: AgentType;
  taskDescription: string;
  upstreamContext: string | null;
  additionalTools: string[];
  instructions?: string;
  maxIterations?: number;
}

// =============================================================================
// Sub-Agent Events
// =============================================================================

export type SubAgentEvent =
  | { type: 'token'; token: string }
  | { type: 'reasoning'; step: ReasoningStep }
  | { type: 'tool_call'; toolId: string; toolName: string; input: unknown }
  | { type: 'tool_result'; toolId: string; output: unknown; success: boolean }
  | { type: 'artifact'; artifact: Artifact }
  | { type: 'status'; status: SubAgentState['status'] }
  | { type: 'complete'; result: SubAgentResult }
  | { type: 'error'; error: string };

// =============================================================================
// Sub-Agent Runner
// =============================================================================

export class SubAgentRunner extends EventEmitter {
  private cancelled = false;
  private pendingGuidance: string | null = null;
  private state: SubAgentState;
  private maxIterations: number;

  constructor(
    private config: SubAgentConfig,
    private llm: LLMProviderPort,
    private toolInvoker: ToolInvokerPort,
    private repository: IOrchestratorStateRepository,
    private contextManager?: ContextManagementService
  ) {
    super();
    this.maxIterations = config.maxIterations ?? 20;
    
    // Initialize state
    this.state = {
      id: config.agentId,
      runId: config.runId,
      taskNodeId: config.taskNodeId,
      agentType: config.agentType,
      status: 'initializing',
      taskDescription: config.taskDescription,
      upstreamContext: config.upstreamContext,
      additionalTools: config.additionalTools,
      messages: [],
      toolCalls: [],
      reasoningSteps: [],
      artifacts: [],
      totalTokens: 0,
      totalCost: 0,
      startedAt: new Date(),
      completedAt: null,
    };
  }

  // ===========================================================================
  // Main Execution Loop
  // ===========================================================================

  async run(): Promise<SubAgentResult> {
    try {
      this.emitStatus('running');
      
      // Build system prompt
      const systemPrompt = this.buildSystemPrompt();
      
      // Build initial user message
      const userMessage = this.buildInitialMessage();
      this.state.messages.push({ role: 'user', content: userMessage });
      await this.repository.appendMessage(this.state.id, { role: 'user', content: userMessage });

      // Get available tools for this agent
      const availableToolIds = getAgentTools(this.config.agentType, this.config.additionalTools);
      const tools = await this.getToolDefinitions(availableToolIds);

      // Agent loop
      let iterations = 0;
      while (iterations < this.maxIterations && !this.cancelled) {
        iterations++;
        
        // Check for injected guidance
        if (this.pendingGuidance) {
          const guidanceMessage = `[ORCHESTRATOR GUIDANCE]: ${this.pendingGuidance}`;
          this.state.messages.push({ role: 'system', content: guidanceMessage });
          await this.repository.appendMessage(this.state.id, { role: 'system', content: guidanceMessage });
          this.pendingGuidance = null;
          
          // Emit reasoning step for guidance
          this.emitReasoning('observation', `Received guidance from orchestrator`);
        }

        // Stream LLM response
        const { content, toolCalls, tokens, cost, shouldContinue } = await this.streamLLMResponse(
          systemPrompt,
          tools
        );

        // Update metrics
        this.state.totalTokens += tokens;
        this.state.totalCost += cost;
        await this.repository.updateSubAgentMetrics(this.state.id, tokens, cost);

        // Process tool calls if any
        if (toolCalls.length > 0 && shouldContinue) {
          for (const tc of toolCalls) {
            if (this.cancelled) break;
            await this.executeToolCall(tc);
          }
          continue; // Continue the loop for more LLM responses
        }

        // No tool calls means we're done
        if (content) {
          // Check if content contains artifacts
          const artifacts = this.extractArtifacts(content);
          for (const artifact of artifacts) {
            this.state.artifacts.push(artifact);
            await this.repository.appendArtifact(this.state.id, artifact);
            this.emit('event', { type: 'artifact', artifact } as SubAgentEvent);
          }
        }

        // Task complete
        break;
      }

      if (this.cancelled) {
        return this.createResult(false, null, 'Agent was cancelled');
      }

      if (iterations >= this.maxIterations) {
        return this.createResult(false, null, `Reached maximum iterations (${this.maxIterations})`);
      }

      // Get final content from messages
      const lastAssistantMessage = [...this.state.messages]
        .reverse()
        .find(m => m.role === 'assistant');
      
      const result = this.createResult(true, lastAssistantMessage?.content || 'Task completed', null);
      this.emitStatus('completed');
      this.emit('event', { type: 'complete', result } as SubAgentEvent);
      
      return result;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.emitStatus('failed');
      this.emit('event', { type: 'error', error: errorMessage } as SubAgentEvent);
      return this.createResult(false, null, errorMessage);
    }
  }

  // ===========================================================================
  // LLM Interaction
  // ===========================================================================

  private async streamLLMResponse(
    systemPrompt: string,
    tools: ToolDefinition[]
  ): Promise<{
    content: string;
    toolCalls: Array<{ id: string; name: string; arguments: string }>;
    tokens: number;
    cost: number;
    shouldContinue: boolean;
  }> {
    let content = '';
    const toolCalls: Array<{ id: string; name: string; arguments: string }> = [];
    let tokens = 0;
    let cost = 0;
    let finishReason = 'stop';

    // Manage context before LLM call (automatic summarization if needed)
    let messagesToSend = this.state.messages;
    if (this.contextManager) {
      const contextResult = await this.contextManager.manageContext(
        this.state.messages,
        {
          modelId: this.llm.getModel(),
          systemPrompt,
          tools,
        }
      );

      if (contextResult.summarized && contextResult.summary) {
        // Update state messages with summarized version
        this.state.messages = contextResult.messages;
        messagesToSend = contextResult.messages;

        // Emit reasoning step about summarization
        this.emitReasoning(
          'observation',
          `Context summarized: ${contextResult.summary.summarizedMessageCount} messages compressed ` +
          `(${contextResult.summary.originalTokenCount} -> ${contextResult.summary.summaryTokenCount} tokens)`
        );
      }
    }

    // Emit reasoning step for thinking
    this.emitReasoning('thinking', `Processing task: ${this.config.taskDescription}`);

    for await (const chunk of this.llm.stream(messagesToSend, {
      systemPrompt,
      tools: tools.length > 0 ? tools : undefined,
      temperature: 0.7,
      maxTokens: 4096,
    })) {
      if (this.cancelled) break;

      switch (chunk.type) {
        case 'token':
          content += chunk.token;
          this.emit('event', { type: 'token', token: chunk.token } as SubAgentEvent);
          break;

        case 'tool_call':
          toolCalls.push(chunk.toolCall);
          this.emit('event', {
            type: 'tool_call',
            toolId: chunk.toolCall.id,
            toolName: chunk.toolCall.name,
            input: JSON.parse(chunk.toolCall.arguments),
          } as SubAgentEvent);
          break;

        case 'done':
          tokens = chunk.response.usage.totalTokens;
          cost = this.llm.calculateCost(
            chunk.response.usage.promptTokens,
            chunk.response.usage.completionTokens
          );
          finishReason = chunk.response.finishReason;
          break;
      }
    }

    // Add assistant message to state
    if (content || toolCalls.length > 0) {
      const assistantMessage: LLMMessage = {
        role: 'assistant',
        content: content || '',
        toolCalls: toolCalls.length > 0 ? toolCalls.map(tc => ({
          id: tc.id,
          name: tc.name,
          arguments: tc.arguments,
        })) : undefined,
      };
      this.state.messages.push(assistantMessage);
      await this.repository.appendMessage(this.state.id, assistantMessage);
    }

    // Emit decision reasoning
    if (toolCalls.length > 0) {
      this.emitReasoning('decision', `Decided to use tools: ${toolCalls.map(tc => tc.name).join(', ')}`);
    } else if (content) {
      this.emitReasoning('decision', 'Formulated response');
    }

    return {
      content,
      toolCalls,
      tokens,
      cost,
      shouldContinue: finishReason === 'tool_calls',
    };
  }

  // ===========================================================================
  // Tool Execution
  // ===========================================================================

  private async executeToolCall(tc: { id: string; name: string; arguments: string }): Promise<void> {
    const toolCallRecord: ToolCall = {
      id: uuidv4(),
      runId: this.state.runId,
      toolId: tc.name,
      input: JSON.parse(tc.arguments),
      output: null,
      status: 'pending',
      durationMs: null,
      createdAt: new Date(),
    };

    this.state.toolCalls.push(toolCallRecord);
    await this.repository.appendToolCall(this.state.id, toolCallRecord);

    const startTime = Date.now();
    
    try {
      // Execute the tool
      const result = await this.toolInvoker.invoke(
        'user', // TODO: Get actual user ID from context
        tc.name,
        JSON.parse(tc.arguments)
      );

      const durationMs = Date.now() - startTime;
      
      // Update tool call record
      toolCallRecord.status = result.success ? 'success' : 'error';
      toolCallRecord.output = result.output as Record<string, unknown>;
      toolCallRecord.durationMs = durationMs;

      // Emit result
      this.emit('event', {
        type: 'tool_result',
        toolId: tc.id,
        output: result.output,
        success: result.success,
      } as SubAgentEvent);

      // Emit observation reasoning
      this.emitReasoning('observation', `Tool ${tc.name} returned: ${result.success ? 'success' : 'error'}`);

      // Add tool result to messages
      const toolMessage: LLMMessage = {
        role: 'tool',
        content: JSON.stringify(result.output),
        toolCallId: tc.id,
      };
      this.state.messages.push(toolMessage);
      await this.repository.appendMessage(this.state.id, toolMessage);

    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      toolCallRecord.status = 'error';
      toolCallRecord.output = { error: errorMessage };
      toolCallRecord.durationMs = durationMs;

      // Emit error
      this.emit('event', {
        type: 'tool_result',
        toolId: tc.id,
        output: { error: errorMessage },
        success: false,
      } as SubAgentEvent);

      // Add error as tool result
      const toolMessage: LLMMessage = {
        role: 'tool',
        content: JSON.stringify({ error: errorMessage }),
        toolCallId: tc.id,
      };
      this.state.messages.push(toolMessage);
      await this.repository.appendMessage(this.state.id, toolMessage);
    }
  }

  private async getToolDefinitions(toolIds: string[]): Promise<ToolDefinition[]> {
    // Get all tools and filter to allowed ones
    const allTools = await this.toolInvoker.getTools('user'); // TODO: Get actual user ID
    return allTools.filter(t => toolIds.includes(t.id));
  }

  // ===========================================================================
  // Prompt Building
  // ===========================================================================

  private buildSystemPrompt(): string {
    const capabilities = AGENT_CAPABILITIES[this.config.agentType];
    const availableTools = getAgentTools(this.config.agentType, this.config.additionalTools);

    let prompt = `You are a specialized ${this.config.agentType} agent working on a specific task.

${capabilities}

## Your Task
${this.config.taskDescription}

## Guidelines
1. Focus exclusively on completing the assigned task
2. Use available tools when needed
3. Be concise and efficient
4. Report completion or issues clearly
5. Do not attempt to do more than the task requires

## Available Tools
${availableTools.join(', ')}
`;

    if (this.config.instructions) {
      prompt += `\n## Special Instructions from Orchestrator\n${this.config.instructions}\n`;
    }

    return prompt;
  }

  private buildInitialMessage(): string {
    let message = `Please complete this task: ${this.config.taskDescription}`;

    if (this.config.upstreamContext) {
      message += `\n\n## Context from Previous Tasks\n${this.config.upstreamContext}`;
    }

    return message;
  }

  // ===========================================================================
  // Artifact Extraction
  // ===========================================================================

  private extractArtifacts(content: string): Artifact[] {
    const artifacts: Artifact[] = [];

    // Extract code blocks as code artifacts
    const codeBlockRegex = /```(\w+)?\n([\s\S]*?)```/g;
    let match;
    while ((match = codeBlockRegex.exec(content)) !== null) {
      const language = match[1] || 'text';
      const code = match[2];
      artifacts.push({
        id: uuidv4(),
        type: 'code',
        name: `code_${language}_${artifacts.length + 1}`,
        content: { language, code },
        createdAt: new Date(),
      });
    }

    // Extract JSON blocks as data artifacts
    const jsonRegex = /```json\n([\s\S]*?)```/g;
    while ((match = jsonRegex.exec(content)) !== null) {
      try {
        const data = JSON.parse(match[1]);
        artifacts.push({
          id: uuidv4(),
          type: 'data',
          name: `data_${artifacts.length + 1}`,
          content: data,
          createdAt: new Date(),
        });
      } catch {
        // Not valid JSON, skip
      }
    }

    return artifacts;
  }

  // ===========================================================================
  // Control Methods
  // ===========================================================================

  /**
   * Inject guidance from the orchestrator.
   * The guidance will be added to the next LLM iteration.
   */
  injectGuidance(guidance: string): void {
    this.pendingGuidance = guidance;
  }

  /**
   * Cancel the agent execution.
   */
  cancel(reason: string): void {
    this.cancelled = true;
    this.emitReasoning('observation', `Cancelled: ${reason}`);
    this.emitStatus('cancelled');
  }

  /**
   * Get the current state of the agent.
   */
  getState(): SubAgentState {
    return { ...this.state };
  }

  // ===========================================================================
  // Helper Methods
  // ===========================================================================

  private emitStatus(status: SubAgentState['status']): void {
    this.state.status = status;
    if (status === 'completed' || status === 'failed' || status === 'cancelled') {
      this.state.completedAt = new Date();
    }
    this.emit('event', { type: 'status', status } as SubAgentEvent);
  }

  private emitReasoning(type: ReasoningStep['type'], content: string): void {
    const step: ReasoningStep = {
      id: uuidv4(),
      timestamp: new Date(),
      type,
      content,
    };
    this.state.reasoningSteps.push(step);
    this.repository.appendReasoningStep(this.state.id, step).catch(console.error);
    this.emit('event', { type: 'reasoning', step } as SubAgentEvent);
  }

  private createResult(success: boolean, output: unknown, error: string | null): SubAgentResult {
    return {
      success,
      output,
      error,
      artifacts: this.state.artifacts,
      totalTokens: this.state.totalTokens,
      totalCost: this.state.totalCost,
    };
  }
}
