// =============================================================================
// WebSocket Event Stream Adapter - Unit Tests
// =============================================================================
// Tests verify the adapter correctly constructs and emits events.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WebSocketEventStreamAdapter } from './websocket-adapter.js';
import type { SocketServer } from '../../api/ws/socket-server.js';
import type { AgentEvent } from '@project-jarvis/shared-types';

describe('WebSocketEventStreamAdapter', () => {
  let adapter: WebSocketEventStreamAdapter;
  let mockSocketServer: {
    emitToRun: ReturnType<typeof vi.fn>;
    emitToUser: ReturnType<typeof vi.fn>;
  };

  const testUserId = 'user-123';
  const testRunId = 'run-456';

  beforeEach(() => {
    mockSocketServer = {
      emitToRun: vi.fn(),
      emitToUser: vi.fn(),
    };
    adapter = new WebSocketEventStreamAdapter(mockSocketServer as unknown as SocketServer);
  });

  // ===========================================================================
  // publish() tests
  // ===========================================================================

  describe('publish()', () => {
    it('should emit event to run via socket server', async () => {
      const event: AgentEvent = {
        type: 'agent.token',
        token: 'Hello',
      };

      await adapter.publish(testUserId, testRunId, event);

      expect(mockSocketServer.emitToRun).toHaveBeenCalledWith(testUserId, testRunId, event);
    });

    it('should handle complex events', async () => {
      const event: AgentEvent = {
        type: 'agent.tool_call',
        toolId: 'call-123',
        toolName: 'web_search',
        input: { query: 'test', options: { limit: 10 } },
      };

      await adapter.publish(testUserId, testRunId, event);

      expect(mockSocketServer.emitToRun).toHaveBeenCalledWith(testUserId, testRunId, event);
    });
  });

  // ===========================================================================
  // publishToken() tests
  // ===========================================================================

  describe('publishToken()', () => {
    it('should construct and emit token event', async () => {
      await adapter.publishToken(testUserId, testRunId, 'Hello');

      expect(mockSocketServer.emitToRun).toHaveBeenCalledWith(testUserId, testRunId, {
        type: 'agent.token',
        token: 'Hello',
      });
    });

    it('should handle empty token', async () => {
      await adapter.publishToken(testUserId, testRunId, '');

      expect(mockSocketServer.emitToRun).toHaveBeenCalledWith(testUserId, testRunId, {
        type: 'agent.token',
        token: '',
      });
    });

    it('should handle special characters in token', async () => {
      const specialToken = '<script>alert("xss")</script>';

      await adapter.publishToken(testUserId, testRunId, specialToken);

      expect(mockSocketServer.emitToRun).toHaveBeenCalledWith(testUserId, testRunId, {
        type: 'agent.token',
        token: specialToken,
      });
    });
  });

  // ===========================================================================
  // publishToolCall() tests
  // ===========================================================================

  describe('publishToolCall()', () => {
    it('should construct and emit tool call event', async () => {
      await adapter.publishToolCall(testUserId, testRunId, 'call-123', 'web_search', {
        query: 'TypeScript',
      });

      expect(mockSocketServer.emitToRun).toHaveBeenCalledWith(testUserId, testRunId, {
        type: 'agent.tool_call',
        toolId: 'call-123',
        toolName: 'web_search',
        input: { query: 'TypeScript' },
      });
    });

    it('should handle complex input objects', async () => {
      const complexInput = {
        file: '/path/to/file.ts',
        options: {
          overwrite: true,
          backup: false,
          permissions: 0o644,
        },
        content: 'const x = 1;\n',
      };

      await adapter.publishToolCall(testUserId, testRunId, 'call-456', 'file_write', complexInput);

      expect(mockSocketServer.emitToRun).toHaveBeenCalledWith(testUserId, testRunId, {
        type: 'agent.tool_call',
        toolId: 'call-456',
        toolName: 'file_write',
        input: complexInput,
      });
    });

    it('should handle null input', async () => {
      await adapter.publishToolCall(testUserId, testRunId, 'call-789', 'no_args_tool', null);

      expect(mockSocketServer.emitToRun).toHaveBeenCalledWith(testUserId, testRunId, {
        type: 'agent.tool_call',
        toolId: 'call-789',
        toolName: 'no_args_tool',
        input: null,
      });
    });
  });

  // ===========================================================================
  // publishToolResult() tests
  // ===========================================================================

  describe('publishToolResult()', () => {
    it('should construct and emit successful tool result event', async () => {
      await adapter.publishToolResult(testUserId, testRunId, 'call-123', { result: 'success' }, true);

      expect(mockSocketServer.emitToRun).toHaveBeenCalledWith(testUserId, testRunId, {
        type: 'agent.tool_result',
        toolId: 'call-123',
        output: { result: 'success' },
        success: true,
      });
    });

    it('should construct and emit failed tool result event', async () => {
      await adapter.publishToolResult(
        testUserId,
        testRunId,
        'call-456',
        { error: 'File not found' },
        false
      );

      expect(mockSocketServer.emitToRun).toHaveBeenCalledWith(testUserId, testRunId, {
        type: 'agent.tool_result',
        toolId: 'call-456',
        output: { error: 'File not found' },
        success: false,
      });
    });

    it('should handle array output', async () => {
      const arrayOutput = ['item1', 'item2', 'item3'];

      await adapter.publishToolResult(testUserId, testRunId, 'call-789', arrayOutput, true);

      expect(mockSocketServer.emitToRun).toHaveBeenCalledWith(testUserId, testRunId, {
        type: 'agent.tool_result',
        toolId: 'call-789',
        output: arrayOutput,
        success: true,
      });
    });
  });

  // ===========================================================================
  // publishFinal() tests
  // ===========================================================================

  describe('publishFinal()', () => {
    it('should construct and emit final event without usage', async () => {
      await adapter.publishFinal(testUserId, testRunId, 'Task completed successfully!');

      expect(mockSocketServer.emitToRun).toHaveBeenCalledWith(testUserId, testRunId, {
        type: 'agent.final',
        content: 'Task completed successfully!',
        usage: undefined,
      });
    });

    it('should construct and emit final event with usage', async () => {
      await adapter.publishFinal(testUserId, testRunId, 'Done!', {
        totalTokens: 1500,
        totalCost: 0.003,
      });

      expect(mockSocketServer.emitToRun).toHaveBeenCalledWith(testUserId, testRunId, {
        type: 'agent.final',
        content: 'Done!',
        usage: {
          totalTokens: 1500,
          totalCost: 0.003,
        },
      });
    });

    it('should handle empty content', async () => {
      await adapter.publishFinal(testUserId, testRunId, '');

      expect(mockSocketServer.emitToRun).toHaveBeenCalledWith(testUserId, testRunId, {
        type: 'agent.final',
        content: '',
        usage: undefined,
      });
    });
  });

  // ===========================================================================
  // publishError() tests
  // ===========================================================================

  describe('publishError()', () => {
    it('should construct and emit error event without code', async () => {
      await adapter.publishError(testUserId, testRunId, 'Something went wrong');

      expect(mockSocketServer.emitToRun).toHaveBeenCalledWith(testUserId, testRunId, {
        type: 'agent.error',
        message: 'Something went wrong',
        code: undefined,
      });
    });

    it('should construct and emit error event with code', async () => {
      await adapter.publishError(testUserId, testRunId, 'API rate limited', 'RATE_LIMIT');

      expect(mockSocketServer.emitToRun).toHaveBeenCalledWith(testUserId, testRunId, {
        type: 'agent.error',
        message: 'API rate limited',
        code: 'RATE_LIMIT',
      });
    });
  });

  // ===========================================================================
  // publishStatus() tests
  // ===========================================================================

  describe('publishStatus()', () => {
    it('should emit running status', async () => {
      await adapter.publishStatus(testUserId, testRunId, 'running');

      expect(mockSocketServer.emitToRun).toHaveBeenCalledWith(testUserId, testRunId, {
        type: 'agent.status',
        status: 'running',
      });
    });

    it('should emit completed status', async () => {
      await adapter.publishStatus(testUserId, testRunId, 'completed');

      expect(mockSocketServer.emitToRun).toHaveBeenCalledWith(testUserId, testRunId, {
        type: 'agent.status',
        status: 'completed',
      });
    });

    it('should emit failed status', async () => {
      await adapter.publishStatus(testUserId, testRunId, 'failed');

      expect(mockSocketServer.emitToRun).toHaveBeenCalledWith(testUserId, testRunId, {
        type: 'agent.status',
        status: 'failed',
      });
    });

    it('should emit cancelled status', async () => {
      await adapter.publishStatus(testUserId, testRunId, 'cancelled');

      expect(mockSocketServer.emitToRun).toHaveBeenCalledWith(testUserId, testRunId, {
        type: 'agent.status',
        status: 'cancelled',
      });
    });
  });

  // ===========================================================================
  // Multiple calls tests
  // ===========================================================================

  describe('Multiple Calls', () => {
    it('should handle rapid successive calls', async () => {
      // Simulate streaming tokens
      await Promise.all([
        adapter.publishToken(testUserId, testRunId, 'Hello'),
        adapter.publishToken(testUserId, testRunId, ' '),
        adapter.publishToken(testUserId, testRunId, 'World'),
        adapter.publishToken(testUserId, testRunId, '!'),
      ]);

      expect(mockSocketServer.emitToRun).toHaveBeenCalledTimes(4);
    });

    it('should handle interleaved event types', async () => {
      await adapter.publishStatus(testUserId, testRunId, 'running');
      await adapter.publishToken(testUserId, testRunId, 'Processing...');
      await adapter.publishToolCall(testUserId, testRunId, 'call-1', 'search', {});
      await adapter.publishToolResult(testUserId, testRunId, 'call-1', { found: true }, true);
      await adapter.publishToken(testUserId, testRunId, 'Done');
      await adapter.publishFinal(testUserId, testRunId, 'Complete', { totalTokens: 100, totalCost: 0.001 });

      expect(mockSocketServer.emitToRun).toHaveBeenCalledTimes(6);
    });
  });
});
