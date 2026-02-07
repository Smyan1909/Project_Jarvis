// =============================================================================
// Token Counter Service - Unit Tests
// =============================================================================

import { describe, it, expect } from 'vitest';
import { TokenCounterService } from './TokenCounterService.js';
import type { LLMMessage, ToolDefinition } from '@project-jarvis/shared-types';

describe('TokenCounterService', () => {
  const tokenCounter = new TokenCounterService();

  // ===========================================================================
  // estimateTokens
  // ===========================================================================

  describe('estimateTokens', () => {
    it('should return 0 for empty string', () => {
      expect(tokenCounter.estimateTokens('')).toBe(0);
    });

    it('should return 0 for null/undefined', () => {
      expect(tokenCounter.estimateTokens(null as unknown as string)).toBe(0);
      expect(tokenCounter.estimateTokens(undefined as unknown as string)).toBe(0);
    });

    it('should estimate tokens for short text', () => {
      const text = 'Hello world'; // 11 chars
      const tokens = tokenCounter.estimateTokens(text);
      // ~11/3.5 = ~3.14, rounded up = 4
      expect(tokens).toBeGreaterThan(0);
      expect(tokens).toBeLessThan(10);
    });

    it('should estimate tokens for longer text', () => {
      const text = 'The quick brown fox jumps over the lazy dog'; // 43 chars
      const tokens = tokenCounter.estimateTokens(text);
      // ~43/3.5 = ~12.3
      expect(tokens).toBeGreaterThan(10);
      expect(tokens).toBeLessThan(20);
    });

    it('should apply JSON penalty for JSON-like content', () => {
      const plainText = 'Hello world this is plain text content';
      const jsonText = '{"hello": "world", "this": "is", "json": true}';
      
      const plainTokens = tokenCounter.estimateTokens(plainText);
      const jsonTokens = tokenCounter.estimateTokens(jsonText);
      
      // JSON should have higher token count due to penalty
      // Both are similar length, but JSON gets 1.2x multiplier
      expect(jsonTokens).toBeGreaterThan(plainTokens * 0.9);
    });

    it('should handle very long text', () => {
      const longText = 'x'.repeat(10000);
      const tokens = tokenCounter.estimateTokens(longText);
      // 10000/3.5 = ~2857
      expect(tokens).toBeGreaterThan(2500);
      expect(tokens).toBeLessThan(3500);
    });
  });

  // ===========================================================================
  // estimateMessageTokens
  // ===========================================================================

  describe('estimateMessageTokens', () => {
    it('should include overhead for simple message', () => {
      const message: LLMMessage = {
        role: 'user',
        content: 'Hello',
      };
      const tokens = tokenCounter.estimateMessageTokens(message);
      // Content (~2 tokens) + overhead (4 tokens) = ~6
      expect(tokens).toBeGreaterThan(4);
    });

    it('should count tool call ID tokens', () => {
      const messageWithToolId: LLMMessage = {
        role: 'tool',
        content: 'Result data',
        toolCallId: 'call_abc123xyz',
      };
      const messageWithoutToolId: LLMMessage = {
        role: 'assistant',
        content: 'Result data',
      };
      
      const withToolIdTokens = tokenCounter.estimateMessageTokens(messageWithToolId);
      const withoutToolIdTokens = tokenCounter.estimateMessageTokens(messageWithoutToolId);
      
      expect(withToolIdTokens).toBeGreaterThan(withoutToolIdTokens);
    });

    it('should count tool calls tokens', () => {
      const messageWithToolCalls: LLMMessage = {
        role: 'assistant',
        content: '',
        toolCalls: [
          { id: 'call_1', name: 'web_search', arguments: '{"query": "test"}' },
          { id: 'call_2', name: 'calculate', arguments: '{"expression": "1+1"}' },
        ],
      };
      const messageWithoutToolCalls: LLMMessage = {
        role: 'assistant',
        content: '',
      };
      
      const withToolCallsTokens = tokenCounter.estimateMessageTokens(messageWithToolCalls);
      const withoutToolCallsTokens = tokenCounter.estimateMessageTokens(messageWithoutToolCalls);
      
      expect(withToolCallsTokens).toBeGreaterThan(withoutToolCallsTokens);
    });
  });

  // ===========================================================================
  // estimateMessagesTokens
  // ===========================================================================

  describe('estimateMessagesTokens', () => {
    it('should return 0 for empty array', () => {
      expect(tokenCounter.estimateMessagesTokens([])).toBe(0);
    });

    it('should sum tokens for multiple messages', () => {
      const messages: LLMMessage[] = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
        { role: 'user', content: 'How are you?' },
      ];
      
      const totalTokens = tokenCounter.estimateMessagesTokens(messages);
      const individualSum = messages.reduce(
        (sum, msg) => sum + tokenCounter.estimateMessageTokens(msg),
        0
      );
      
      expect(totalTokens).toBe(individualSum);
    });
  });

  // ===========================================================================
  // estimateToolsTokens
  // ===========================================================================

  describe('estimateToolsTokens', () => {
    it('should return 0 for empty array', () => {
      expect(tokenCounter.estimateToolsTokens([])).toBe(0);
    });

    it('should return 0 for null/undefined', () => {
      expect(tokenCounter.estimateToolsTokens(null as unknown as ToolDefinition[])).toBe(0);
      expect(tokenCounter.estimateToolsTokens(undefined as unknown as ToolDefinition[])).toBe(0);
    });

    it('should estimate tokens for tool definitions', () => {
      const tools: ToolDefinition[] = [
        {
          id: 'web_search',
          name: 'web_search',
          description: 'Search the web for information',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'The search query' },
            },
            required: ['query'],
          },
        },
      ];
      
      const tokens = tokenCounter.estimateToolsTokens(tools);
      expect(tokens).toBeGreaterThan(20); // Tool with description and params
    });

    it('should scale with number of tools', () => {
      const oneTool: ToolDefinition[] = [
        {
          id: 'tool1',
          name: 'tool1',
          description: 'Description',
          parameters: { type: 'object', properties: {} },
        },
      ];
      
      const threeTools: ToolDefinition[] = [
        ...oneTool,
        {
          id: 'tool2',
          name: 'tool2',
          description: 'Description',
          parameters: { type: 'object', properties: {} },
        },
        {
          id: 'tool3',
          name: 'tool3',
          description: 'Description',
          parameters: { type: 'object', properties: {} },
        },
      ];
      
      const oneToolTokens = tokenCounter.estimateToolsTokens(oneTool);
      const threeToolsTokens = tokenCounter.estimateToolsTokens(threeTools);
      
      expect(threeToolsTokens).toBeGreaterThan(oneToolTokens * 2);
    });
  });

  // ===========================================================================
  // estimateTotalContext
  // ===========================================================================

  describe('estimateTotalContext', () => {
    it('should combine all components', () => {
      const systemPrompt = 'You are a helpful assistant.';
      const messages: LLMMessage[] = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi!' },
      ];
      const tools: ToolDefinition[] = [
        {
          id: 'test',
          name: 'test',
          description: 'Test tool',
          parameters: { type: 'object', properties: {} },
        },
      ];
      
      const total = tokenCounter.estimateTotalContext(systemPrompt, messages, tools);
      
      // Should be greater than any individual component
      expect(total).toBeGreaterThan(tokenCounter.estimateTokens(systemPrompt));
      expect(total).toBeGreaterThan(tokenCounter.estimateMessagesTokens(messages));
      expect(total).toBeGreaterThan(tokenCounter.estimateToolsTokens(tools));
    });

    it('should work without tools', () => {
      const systemPrompt = 'You are a helpful assistant.';
      const messages: LLMMessage[] = [{ role: 'user', content: 'Hello' }];
      
      const withTools = tokenCounter.estimateTotalContext(systemPrompt, messages, []);
      const withoutTools = tokenCounter.estimateTotalContext(systemPrompt, messages);
      
      expect(withTools).toBe(withoutTools);
    });
  });

  // ===========================================================================
  // getTokenBreakdown
  // ===========================================================================

  describe('getTokenBreakdown', () => {
    it('should provide breakdown of all components', () => {
      const systemPrompt = 'You are a helpful assistant.';
      const messages: LLMMessage[] = [
        { role: 'user', content: 'Hello' },
      ];
      const tools: ToolDefinition[] = [
        {
          id: 'test',
          name: 'test',
          description: 'Test tool',
          parameters: { type: 'object', properties: {} },
        },
      ];
      
      const breakdown = tokenCounter.getTokenBreakdown(systemPrompt, messages, tools);
      
      expect(breakdown.systemPrompt).toBeGreaterThan(0);
      expect(breakdown.messages).toBeGreaterThan(0);
      expect(breakdown.tools).toBeGreaterThan(0);
      expect(breakdown.total).toBe(
        breakdown.systemPrompt + breakdown.messages + breakdown.tools
      );
    });
  });

  // ===========================================================================
  // findTokenThresholdIndex
  // ===========================================================================

  describe('findTokenThresholdIndex', () => {
    it('should return -1 when threshold is never exceeded', () => {
      const messages: LLMMessage[] = [
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: 'Hello' },
      ];
      
      const index = tokenCounter.findTokenThresholdIndex(messages, 10000);
      expect(index).toBe(-1);
    });

    it('should return index where threshold is exceeded', () => {
      const messages: LLMMessage[] = [
        { role: 'user', content: 'A'.repeat(100) }, // ~30 tokens
        { role: 'assistant', content: 'B'.repeat(100) }, // ~30 tokens
        { role: 'user', content: 'C'.repeat(100) }, // ~30 tokens
      ];
      
      // Set threshold at ~50 tokens, should hit at index 1
      const index = tokenCounter.findTokenThresholdIndex(messages, 50);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(messages.length);
    });

    it('should return 0 if first message exceeds threshold', () => {
      const messages: LLMMessage[] = [
        { role: 'user', content: 'A'.repeat(500) },
      ];
      
      const index = tokenCounter.findTokenThresholdIndex(messages, 10);
      expect(index).toBe(0);
    });
  });
});
