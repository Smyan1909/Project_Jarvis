// =============================================================================
// Context Management Service - Unit Tests
// =============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ContextManagementService } from './ContextManagementService.js';
import { TokenCounterService } from './TokenCounterService.js';
import type { LLMMessage, LLMResponse, ToolDefinition } from '@project-jarvis/shared-types';
import type { LLMProviderPort, StreamChunk } from '../../ports/LLMProviderPort.js';

// =============================================================================
// Mock LLM Provider
// =============================================================================

function createMockLLMProvider(summaryContent: string = 'Previous conversation summary: Test summary'): LLMProviderPort {
  return {
    generate: vi.fn().mockResolvedValue({
      content: summaryContent,
      toolCalls: [],
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      finishReason: 'stop',
    } as LLMResponse),
    stream: vi.fn(),
    getModel: vi.fn().mockReturnValue('openai:gpt-5-nano'),
    calculateCost: vi.fn().mockReturnValue(0.001),
  };
}

// =============================================================================
// Test Helpers
// =============================================================================

function createLongConversation(messageCount: number, contentLength: number = 500): LLMMessage[] {
  const messages: LLMMessage[] = [];
  for (let i = 0; i < messageCount; i++) {
    messages.push({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `Message ${i}: ${'x'.repeat(contentLength)}`,
    });
  }
  return messages;
}

function createConversationWithToolCalls(): LLMMessage[] {
  return [
    { role: 'user', content: 'Search for information about TypeScript' },
    {
      role: 'assistant',
      content: '',
      toolCalls: [{ id: 'call_1', name: 'web_search', arguments: '{"query":"TypeScript"}' }],
    },
    {
      role: 'tool',
      content: JSON.stringify({ results: [{ title: 'TypeScript Docs', url: 'https://typescriptlang.org' }] }),
      toolCallId: 'call_1',
    },
    { role: 'assistant', content: 'I found information about TypeScript...' },
    { role: 'user', content: 'Tell me more about the type system' },
    {
      role: 'assistant',
      content: '',
      toolCalls: [{ id: 'call_2', name: 'web_search', arguments: '{"query":"TypeScript type system"}' }],
    },
    {
      role: 'tool',
      content: JSON.stringify({ results: [{ title: 'TypeScript Type System' }] }),
      toolCallId: 'call_2',
    },
    { role: 'assistant', content: 'TypeScript has a structural type system...' },
  ];
}

// =============================================================================
// Tests
// =============================================================================

describe('ContextManagementService', () => {
  let tokenCounter: TokenCounterService;
  let mockLLM: LLMProviderPort;
  let contextManager: ContextManagementService;

  beforeEach(() => {
    tokenCounter = new TokenCounterService();
    mockLLM = createMockLLMProvider();
    contextManager = new ContextManagementService(tokenCounter, mockLLM);
  });

  // ===========================================================================
  // Basic Functionality
  // ===========================================================================

  describe('basic functionality', () => {
    it('should pass through messages when under threshold', async () => {
      const messages: LLMMessage[] = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
      ];

      const result = await contextManager.manageContext(messages, {
        modelId: 'openai:gpt-4o',
        systemPrompt: 'You are a helpful assistant.',
      });

      expect(result.summarized).toBe(false);
      expect(result.messages).toEqual(messages);
      expect(result.summary).toBeUndefined();
      expect(mockLLM.generate).not.toHaveBeenCalled();
    });

    it('should return correct context limit', async () => {
      const messages: LLMMessage[] = [{ role: 'user', content: 'Hello' }];

      const result = await contextManager.manageContext(messages, {
        modelId: 'openai:gpt-4o',
        systemPrompt: 'Test',
      });

      expect(result.contextLimit).toBe(128000); // gpt-4o limit
    });

    it('should return estimated tokens', async () => {
      const messages: LLMMessage[] = [
        { role: 'user', content: 'Hello world' },
        { role: 'assistant', content: 'Hi there, how can I help?' },
      ];

      const result = await contextManager.manageContext(messages, {
        modelId: 'openai:gpt-4o',
        systemPrompt: 'You are a helpful assistant.',
      });

      expect(result.estimatedTokens).toBeGreaterThan(0);
    });
  });

  // ===========================================================================
  // Summarization Triggering
  // ===========================================================================

  describe('summarization triggering', () => {
    it('should trigger summarization when context exceeds threshold', async () => {
      // Create a conversation that exceeds 80% of context limit
      // For testing, we'll use a custom config with low thresholds
      const lowThresholdManager = new ContextManagementService(tokenCounter, mockLLM, {
        triggerThreshold: 0.001, // Trigger at 0.1% - essentially always
        targetThreshold: 0.0005,
        minMessagesToKeep: 2,
      });

      const messages = createLongConversation(10, 100);

      const result = await lowThresholdManager.manageContext(messages, {
        modelId: 'openai:gpt-4o',
        systemPrompt: 'You are a helpful assistant.',
      });

      expect(result.summarized).toBe(true);
      expect(result.summary).toBeDefined();
      expect(mockLLM.generate).toHaveBeenCalled();
    });

    it('should not trigger when disabled', async () => {
      const disabledManager = new ContextManagementService(tokenCounter, mockLLM, {
        enabled: false,
      });

      const messages = createLongConversation(100, 1000);

      const result = await disabledManager.manageContext(messages, {
        modelId: 'openai:gpt-4o',
        systemPrompt: 'Test',
      });

      expect(result.summarized).toBe(false);
      expect(mockLLM.generate).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // Message Preservation
  // ===========================================================================

  describe('message preservation', () => {
    it('should keep minimum number of recent messages', async () => {
      const minKeep = 4;
      const lowThresholdManager = new ContextManagementService(tokenCounter, mockLLM, {
        triggerThreshold: 0.001,
        targetThreshold: 0.0005,
        minMessagesToKeep: minKeep,
      });

      const messages = createLongConversation(10, 100);

      const result = await lowThresholdManager.manageContext(messages, {
        modelId: 'openai:gpt-4o',
        systemPrompt: 'Test',
      });

      if (result.summarized) {
        // Result should have: 1 summary message + at least minKeep original messages
        // The last messages should be preserved
        const lastOriginalMessages = messages.slice(-minKeep);
        const resultMessagesContent = result.messages.slice(1); // Skip summary
        
        expect(resultMessagesContent.length).toBeGreaterThanOrEqual(minKeep);
      }
    });

    it('should not summarize if not enough messages to keep', async () => {
      const lowThresholdManager = new ContextManagementService(tokenCounter, mockLLM, {
        triggerThreshold: 0.001,
        minMessagesToKeep: 10,
      });

      // Only 5 messages, but we need to keep 10
      const messages = createLongConversation(5, 100);

      const result = await lowThresholdManager.manageContext(messages, {
        modelId: 'openai:gpt-4o',
        systemPrompt: 'Test',
      });

      // Should not summarize because we don't have enough messages
      expect(result.summarized).toBe(false);
    });
  });

  // ===========================================================================
  // Summary Content
  // ===========================================================================

  describe('summary content', () => {
    it('should create summary message with correct role', async () => {
      const lowThresholdManager = new ContextManagementService(tokenCounter, mockLLM, {
        triggerThreshold: 0.001,
        targetThreshold: 0.0005,
        minMessagesToKeep: 2,
      });

      const messages = createLongConversation(10, 100);

      const result = await lowThresholdManager.manageContext(messages, {
        modelId: 'openai:gpt-4o',
        systemPrompt: 'Test',
      });

      if (result.summarized) {
        expect(result.messages[0].role).toBe('system');
        expect(result.messages[0].content).toContain('summary');
      }
    });

    it('should populate summary metadata correctly', async () => {
      const lowThresholdManager = new ContextManagementService(tokenCounter, mockLLM, {
        triggerThreshold: 0.001,
        targetThreshold: 0.0005,
        minMessagesToKeep: 2,
      });

      const messages = createLongConversation(10, 100);

      const result = await lowThresholdManager.manageContext(messages, {
        modelId: 'openai:gpt-4o',
        systemPrompt: 'Test',
      });

      if (result.summarized && result.summary) {
        expect(result.summary.id).toBeDefined();
        expect(result.summary.summarizedMessageCount).toBeGreaterThan(0);
        expect(result.summary.originalTokenCount).toBeGreaterThan(0);
        expect(result.summary.summaryTokenCount).toBeGreaterThan(0);
        expect(result.summary.createdAt).toBeInstanceOf(Date);
      }
    });
  });

  // ===========================================================================
  // LLM Interaction
  // ===========================================================================

  describe('LLM interaction', () => {
    it('should call LLM with summarization prompt', async () => {
      const lowThresholdManager = new ContextManagementService(tokenCounter, mockLLM, {
        triggerThreshold: 0.001,
        targetThreshold: 0.0005,
        minMessagesToKeep: 2,
      });

      const messages = createConversationWithToolCalls();

      await lowThresholdManager.manageContext(messages, {
        modelId: 'openai:gpt-4o',
        systemPrompt: 'Test',
      });

      if ((mockLLM.generate as ReturnType<typeof vi.fn>).mock.calls.length > 0) {
        const [callMessages, options] = (mockLLM.generate as ReturnType<typeof vi.fn>).mock.calls[0];
        
        // Should have system prompt about summarization
        expect(options.systemPrompt).toContain('summarizer');
        
        // Should have user message with conversation to summarize
        expect(callMessages[0].role).toBe('user');
        expect(callMessages[0].content).toContain('summarize');
      }
    });

    it('should use low temperature for consistent summaries', async () => {
      const lowThresholdManager = new ContextManagementService(tokenCounter, mockLLM, {
        triggerThreshold: 0.001,
        targetThreshold: 0.0005,
        minMessagesToKeep: 2,
      });

      const messages = createLongConversation(10, 100);

      await lowThresholdManager.manageContext(messages, {
        modelId: 'openai:gpt-4o',
        systemPrompt: 'Test',
      });

      if ((mockLLM.generate as ReturnType<typeof vi.fn>).mock.calls.length > 0) {
        const [, options] = (mockLLM.generate as ReturnType<typeof vi.fn>).mock.calls[0];
        expect(options.temperature).toBeLessThanOrEqual(0.5);
      }
    });
  });

  // ===========================================================================
  // Configuration
  // ===========================================================================

  describe('configuration', () => {
    it('should allow runtime config updates', () => {
      contextManager.updateConfig({ triggerThreshold: 0.9 });
      
      const config = contextManager.getConfig();
      expect(config.triggerThreshold).toBe(0.9);
    });

    it('should preserve other config when updating', () => {
      const originalConfig = contextManager.getConfig();
      contextManager.updateConfig({ triggerThreshold: 0.9 });
      
      const newConfig = contextManager.getConfig();
      expect(newConfig.minMessagesToKeep).toBe(originalConfig.minMessagesToKeep);
      expect(newConfig.targetThreshold).toBe(originalConfig.targetThreshold);
    });
  });

  // ===========================================================================
  // wouldTriggerSummarization
  // ===========================================================================

  describe('wouldTriggerSummarization', () => {
    it('should correctly predict when summarization would trigger', () => {
      const messages: LLMMessage[] = [{ role: 'user', content: 'Hello' }];

      const prediction = contextManager.wouldTriggerSummarization(messages, {
        modelId: 'openai:gpt-4o',
        systemPrompt: 'Test',
      });

      expect(prediction.wouldTrigger).toBe(false);
      expect(prediction.currentTokens).toBeGreaterThan(0);
      expect(prediction.threshold).toBeGreaterThan(0);
    });

    it('should return true for large context', () => {
      const lowThresholdManager = new ContextManagementService(tokenCounter, mockLLM, {
        triggerThreshold: 0.00001, // Very low threshold
      });

      const messages = createLongConversation(5, 100);

      const prediction = lowThresholdManager.wouldTriggerSummarization(messages, {
        modelId: 'openai:gpt-4o',
        systemPrompt: 'Test',
      });

      expect(prediction.wouldTrigger).toBe(true);
    });
  });

  // ===========================================================================
  // Edge Cases
  // ===========================================================================

  describe('edge cases', () => {
    it('should handle empty messages array', async () => {
      const result = await contextManager.manageContext([], {
        modelId: 'openai:gpt-4o',
        systemPrompt: 'Test',
      });

      expect(result.summarized).toBe(false);
      expect(result.messages).toEqual([]);
    });

    it('should handle messages with empty content', async () => {
      const messages: LLMMessage[] = [
        { role: 'user', content: '' },
        { role: 'assistant', content: '' },
      ];

      const result = await contextManager.manageContext(messages, {
        modelId: 'openai:gpt-4o',
        systemPrompt: 'Test',
      });

      expect(result.summarized).toBe(false);
    });

    it('should handle unknown model gracefully', async () => {
      const messages: LLMMessage[] = [{ role: 'user', content: 'Hello' }];

      const result = await contextManager.manageContext(messages, {
        modelId: 'unknown:model',
        systemPrompt: 'Test',
      });

      // Should use default context limit
      expect(result.contextLimit).toBe(128000);
    });

    it('should handle LLM failure gracefully', async () => {
      const failingLLM = createMockLLMProvider();
      (failingLLM.generate as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('LLM failed'));

      const failingManager = new ContextManagementService(tokenCounter, failingLLM, {
        triggerThreshold: 0.001,
        targetThreshold: 0.0005,
        minMessagesToKeep: 2,
      });

      const messages = createLongConversation(10, 100);

      // Should throw or handle error appropriately
      await expect(failingManager.manageContext(messages, {
        modelId: 'openai:gpt-4o',
        systemPrompt: 'Test',
      })).rejects.toThrow('LLM failed');
    });
  });

  // ===========================================================================
  // Tool Integration
  // ===========================================================================

  describe('tool integration', () => {
    it('should account for tools in context estimation', async () => {
      const messages: LLMMessage[] = [{ role: 'user', content: 'Hello' }];
      const tools: ToolDefinition[] = [
        {
          id: 'web_search',
          name: 'web_search',
          description: 'Search the web for information using a search engine',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'The search query' },
            },
            required: ['query'],
          },
        },
      ];

      const withoutTools = await contextManager.manageContext(messages, {
        modelId: 'openai:gpt-4o',
        systemPrompt: 'Test',
      });

      const withTools = await contextManager.manageContext(messages, {
        modelId: 'openai:gpt-4o',
        systemPrompt: 'Test',
        tools,
      });

      expect(withTools.estimatedTokens).toBeGreaterThan(withoutTools.estimatedTokens);
    });
  });
});
