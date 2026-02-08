// =============================================================================
// useAgentStream Hook
// =============================================================================
// Hook for sending messages and receiving streaming responses from orchestrator.

import { useState, useCallback, useRef, useEffect } from 'react';
import { orchestratorApi } from '../services/api';
import { getMockResponse } from '../services/mockAgent';
import { useTaskObservability } from './useTaskObservability';
import { DEMO_MODE, LOAD_HISTORY_ON_STARTUP } from '../config';
import type { StreamEvent } from '../services/websocket';

// =============================================================================
// Types
// =============================================================================

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  isStreaming?: boolean;
  toolCalls?: ToolCallInfo[];
}

interface ToolCallInfo {
  id: string;
  name: string;
  input: unknown;
  output?: unknown;
  status: 'pending' | 'success' | 'error';
}

interface UseAgentStreamResult {
  messages: Message[];
  isLoading: boolean;
  error: string | null;
  sendMessage: (content: string, onResponseReady?: (text: string, messageId: string) => void) => Promise<void>;
  cancelRun: () => void;
  clearMessages: () => void;
}

// =============================================================================
// SSE Parser
// =============================================================================

interface ParsedSSEResult {
  events: StreamEvent[];
  remaining: string;
}

function parseSSE(buffer: string): ParsedSSEResult {
  const events: StreamEvent[] = [];
  const lines = buffer.split('\n');
  let remaining = '';
  let currentEvent = '';
  let currentData = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check if this might be an incomplete line (last line without terminator)
    if (i === lines.length - 1 && line !== '') {
      remaining = line;
      continue;
    }

    if (line.startsWith('event:')) {
      currentEvent = line.slice(6).trim();
    } else if (line.startsWith('data:')) {
      currentData = line.slice(5).trim();
    } else if (line === '' && currentData) {
      // Empty line signals end of event
      try {
        const parsed = JSON.parse(currentData);
        // Add event type if not present
        if (currentEvent && !parsed.type) {
          parsed.type = currentEvent;
        }
        events.push(parsed);
      } catch (e) {
        console.error('[SSE] Failed to parse event:', currentData);
      }
      currentEvent = '';
      currentData = '';
    }
  }

  // If we have partial data, keep it in remaining
  if (currentData || currentEvent) {
    remaining = lines.slice(-2).join('\n');
  }

  return { events, remaining };
}

// =============================================================================
// Hook
// =============================================================================

export function useAgentStream(): UseAgentStreamResult {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const streamingContentRef = useRef<string>('');
  const currentMessageIdRef = useRef<string | null>(null);

  const { processEvent, startRun, clearRun, status: orchestratorStatus } = useTaskObservability();

  // Load conversation history on mount (if enabled)
  useEffect(() => {
    if (DEMO_MODE) return;
    if (!LOAD_HISTORY_ON_STARTUP) return;
    
    orchestratorApi.getHistory(50)
      .then((data) => {
        const historicalMessages: Message[] = data.messages
          .filter((m) => m.role !== 'system') // Filter out system messages
          .map((m) => ({
            id: m.id,
            role: m.role as 'user' | 'assistant',
            content: m.content,
          }));
        setMessages(historicalMessages);
      })
      .catch((err) => {
        console.error('[AgentStream] Failed to load history:', err);
      });
  }, []);

  // Handle incoming stream events for chat display
  const handleChatEvent = useCallback((event: StreamEvent) => {
    switch (event.type) {
      case 'agent.token': {
        const eventData = event as { type: 'agent.token'; token: string };
        streamingContentRef.current += eventData.token;
        setMessages((prev) => {
          const lastMessage = prev[prev.length - 1];
          if (lastMessage?.isStreaming) {
            return [
              ...prev.slice(0, -1),
              { ...lastMessage, content: streamingContentRef.current },
            ];
          }
          return prev;
        });
        break;
      }

      case 'agent.tool_call': {
        const eventData = event as { type: 'agent.tool_call'; toolId: string; toolName: string; input: unknown };
        setMessages((prev) => {
          const lastMessage = prev[prev.length - 1];
          if (lastMessage?.role === 'assistant') {
            const toolCall: ToolCallInfo = {
              id: eventData.toolId,
              name: eventData.toolName,
              input: eventData.input,
              status: 'pending',
            };
            return [
              ...prev.slice(0, -1),
              {
                ...lastMessage,
                toolCalls: [...(lastMessage.toolCalls || []), toolCall],
              },
            ];
          }
          return prev;
        });
        break;
      }

      case 'agent.tool_result': {
        const eventData = event as { type: 'agent.tool_result'; toolId: string; output: unknown; success: boolean };
        setMessages((prev) => {
          const lastMessage = prev[prev.length - 1];
          if (lastMessage?.toolCalls) {
            const updatedToolCalls = lastMessage.toolCalls.map((tc) => {
              if (tc.id === eventData.toolId) {
                return {
                  ...tc,
                  output: eventData.output,
                  status: eventData.success ? 'success' : 'error',
                } as ToolCallInfo;
              }
              return tc;
            });
            return [
              ...prev.slice(0, -1),
              { ...lastMessage, toolCalls: updatedToolCalls },
            ];
          }
          return prev;
        });
        break;
      }

      case 'agent.final': {
        const eventData = event as { type: 'agent.final'; content: string; usage?: { totalTokens: number; totalCost: number } };
        setMessages((prev) => {
          const lastMessage = prev[prev.length - 1];
          if (lastMessage?.isStreaming) {
            return [
              ...prev.slice(0, -1),
              { 
                ...lastMessage, 
                content: eventData.content || streamingContentRef.current || 'Response completed.',
                isStreaming: false,
              },
            ];
          }
          return prev;
        });
        setIsLoading(false);
        break;
      }

      case 'agent.error': {
        const eventData = event as { type: 'agent.error'; message: string; code?: string };
        setError(eventData.message);
        setIsLoading(false);
        setMessages((prev) => {
          const lastMessage = prev[prev.length - 1];
          if (lastMessage?.isStreaming) {
            return [
              ...prev.slice(0, -1),
              { ...lastMessage, isStreaming: false, content: lastMessage.content || 'An error occurred.' },
            ];
          }
          return prev;
        });
        break;
      }

      case 'agent.status': {
        const eventData = event as { type: 'agent.status'; status: 'running' | 'completed' | 'failed' | 'cancelled' };
        if (eventData.status === 'completed' || eventData.status === 'failed' || eventData.status === 'cancelled') {
          setIsLoading(false);
        }
        break;
      }

      case 'orchestrator.status':
        if (event.status === 'completed' || event.status === 'failed') {
          setIsLoading(false);
        }
        break;
    }
  }, []);

  const sendMessage = useCallback(
    async (content: string, onResponseReady?: (text: string, messageId: string) => void): Promise<void> => {
      setError(null);
      setIsLoading(true);
      streamingContentRef.current = '';

      // Add user message
      const userMessage: Message = {
        id: `user-${Date.now()}`,
        role: 'user',
        content,
      };
      setMessages((prev) => [...prev, userMessage]);

      // Demo mode: use mock responses
      if (DEMO_MODE) {
        getMockResponse(content, {
          onResponse: (fullContent) => {
            const messageId = `assistant-${Date.now()}`;
            currentMessageIdRef.current = messageId;
            const assistantMessage: Message = {
              id: messageId,
              role: 'assistant',
              content: fullContent,
              isStreaming: false,
            };
            setMessages((prev) => [...prev, assistantMessage]);
            setIsLoading(false);
            onResponseReady?.(fullContent, messageId);
          },
          onError: (errorMessage) => {
            setError(errorMessage);
            setIsLoading(false);
          },
        });
        return;
      }

      // Production mode: SSE streaming
      const messageId = `assistant-${Date.now()}`;
      currentMessageIdRef.current = messageId;
      const assistantMessage: Message = {
        id: messageId,
        role: 'assistant',
        content: '',
        isStreaming: true,
      };
      setMessages((prev) => [...prev, assistantMessage]);

      // Start observability tracking
      const runId = `run-${Date.now()}`;
      startRun(runId);

      // Create abort controller for cancellation
      abortControllerRef.current = new AbortController();

      try {
        const response = await orchestratorApi.startRun(content, undefined, abortControllerRef.current?.signal);

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error?.message || `HTTP ${response.status}`);
        }

        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error('No response body');
        }

        const decoder = new TextDecoder();
        let buffer = '';
        let finalContent = '';

        while (true) {
          const { done, value } = await reader.read();

          if (done) {
            break;
          }

          // Check for cancellation
          if (abortControllerRef.current?.signal.aborted) {
            reader.cancel();
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          const { events, remaining } = parseSSE(buffer);
          buffer = remaining;

          for (const event of events) {
            // Debug logging for SSE events
            console.log('[SSE] Received event:', event.type, event);

            // Process for observability panel
            processEvent(event);

            // Process for chat display
            handleChatEvent(event);

            // Track final content for TTS callback
            if (event.type === 'agent.final') {
              const eventData = event as { type: 'agent.final'; content: string };
              finalContent = eventData.content;
            }
          }
        }

        // Call response callback for TTS
        if (finalContent && onResponseReady) {
          onResponseReady(finalContent, messageId);
        }

        setIsLoading(false);
      } catch (err: any) {
        if (err.name === 'AbortError') {
          console.log('[AgentStream] Request cancelled');
        } else {
          const errorMessage = err.message || 'Failed to get response';
          setError(errorMessage);
          setIsLoading(false);
          
          // Update streaming message to show error occurred
          setMessages((prev) => {
            const lastMessage = prev[prev.length - 1];
            if (lastMessage?.isStreaming) {
              return [
                ...prev.slice(0, -1),
                {
                  ...lastMessage,
                  isStreaming: false,
                  content: lastMessage.content || 'Sorry, an error occurred.',
                },
              ];
            }
            return prev;
          });
        }
      } finally {
        abortControllerRef.current = null;
      }
    },
    [handleChatEvent, processEvent, startRun]
  );

  const cancelRun = useCallback(() => {
    if (DEMO_MODE) {
      setIsLoading(false);
      return;
    }

    // Abort the fetch request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    setIsLoading(false);

    // Mark streaming message as complete
    setMessages((prev) => {
      const lastMessage = prev[prev.length - 1];
      if (lastMessage?.isStreaming) {
        return [
          ...prev.slice(0, -1),
          { ...lastMessage, isStreaming: false },
        ];
      }
      return prev;
    });
  }, []);

  const clearMessages = useCallback(() => {
    setMessages([]);
    setError(null);
    clearRun();
  }, [clearRun]);

  return {
    messages,
    isLoading,
    error,
    sendMessage,
    cancelRun,
    clearMessages,
  };
}
