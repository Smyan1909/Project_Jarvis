// =============================================================================
// useAgentStream Hook
// =============================================================================
// Hook for sending messages and receiving streaming responses from orchestrator.

import { useState, useCallback, useRef, useEffect } from 'react';
import { orchestratorApi } from '../services/api';
import { getMockResponse } from '../services/mockAgent';
import { useTaskObservability } from './useTaskObservability';
import { DEMO_MODE, LOAD_HISTORY_ON_STARTUP } from '../config';
import { logger } from '../utils/logger';
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
  parseErrors: string[];
}

function parseSSE(buffer: string): ParsedSSEResult {
  const events: StreamEvent[] = [];
  const parseErrors: string[] = [];
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
        const errorMsg = e instanceof Error ? e.message : String(e);
        logger.error('AgentStream', `Failed to parse SSE event: ${errorMsg}`, { rawData: currentData });
        parseErrors.push(`Failed to parse: ${currentData.substring(0, 100)}... - ${errorMsg}`);
      }
      currentEvent = '';
      currentData = '';
    }
  }

  // If we have partial data, keep it in remaining
  if (currentData || currentEvent) {
    remaining = lines.slice(-2).join('\n');
  }

  return { events, remaining, parseErrors };
}

// =============================================================================
// Constants
// =============================================================================

const STREAM_TIMEOUT_MS = 30000; // 30 seconds timeout for no data
const MAX_BUFFER_SIZE = 100000; // 100KB max buffer before warning

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
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const { processEvent, startRun, clearRun, status: orchestratorStatus } = useTaskObservability();

  // Cleanup function for unmount
  const cleanupStream = useCallback(() => {
    logger.info('AgentStream', 'Cleaning up stream resources');
    
    // Clear timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    
    // Cancel reader
    if (readerRef.current) {
      logger.debug('AgentStream', 'Cancelling stream reader');
      readerRef.current.cancel().catch((err) => {
        logger.warn('AgentStream', 'Error cancelling reader (ignored)', err);
      });
      readerRef.current = null;
    }
    
    // Abort controller
    if (abortControllerRef.current) {
      logger.debug('AgentStream', 'Aborting fetch request');
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    
    setIsLoading(false);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      logger.info('AgentStream', 'useAgentStream unmounting - cleaning up');
      cleanupStream();
    };
  }, [cleanupStream]);

  // Load conversation history on mount (if enabled)
  useEffect(() => {
    logger.info('AgentStream', 'useAgentStream mounted');
    
    if (DEMO_MODE) {
      logger.info('AgentStream', 'Demo mode - skipping history load');
      return;
    }
    if (!LOAD_HISTORY_ON_STARTUP) {
      logger.info('AgentStream', 'History loading disabled');
      return;
    }
    
    logger.info('AgentStream', 'Loading conversation history');
    orchestratorApi.getHistory(50)
      .then((data) => {
        const historicalMessages: Message[] = data.messages
          .filter((m) => m.role !== 'system') // Filter out system messages
          .map((m) => ({
            id: m.id,
            role: m.role as 'user' | 'assistant',
            content: m.content,
          }));
        logger.info('AgentStream', `Loaded ${historicalMessages.length} historical messages`);
        setMessages(historicalMessages);
      })
      .catch((err) => {
        logger.error('AgentStream', 'Failed to load history', err);
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
      logger.info('AgentStream', 'Sending message', { contentLength: content.length });
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
      logger.debug('AgentStream', 'User message added', { messageId: userMessage.id });

      // Demo mode: use mock responses
      if (DEMO_MODE) {
        logger.info('AgentStream', 'Demo mode - using mock response');
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
            logger.info('AgentStream', 'Mock response complete', { messageId, contentLength: fullContent.length });
            onResponseReady?.(fullContent, messageId);
          },
          onError: (errorMessage) => {
            logger.error('AgentStream', 'Mock response error', { error: errorMessage });
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
      logger.info('AgentStream', 'Starting SSE stream', { messageId });

      // Start observability tracking
      const runId = `run-${Date.now()}`;
      logger.info('AgentStream', 'Starting observability tracking', { runId });
      startRun(runId);

      // Create abort controller for cancellation
      abortControllerRef.current = new AbortController();

      // Track last activity for timeout
      let lastActivityTime = Date.now();

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
        
        // Store reader reference for cleanup
        readerRef.current = reader;

        const decoder = new TextDecoder();
        let buffer = '';
        let finalContent = '';
        let eventCount = 0;
        let allParseErrors: string[] = [];

        // Set up timeout check
        const checkTimeout = () => {
          const timeSinceLastActivity = Date.now() - lastActivityTime;
          if (timeSinceLastActivity > STREAM_TIMEOUT_MS) {
            logger.error('AgentStream', `Stream timeout after ${STREAM_TIMEOUT_MS}ms without data`);
            throw new Error('Stream timeout - no data received from server');
          }
        };

        while (true) {
          // Check timeout before reading
          checkTimeout();
          
          // Set timeout for this read operation
          timeoutRef.current = setTimeout(() => {
            logger.warn('AgentStream', 'Read operation timeout - cancelling stream');
            cleanupStream();
            setError('Stream timeout - connection stalled');
          }, STREAM_TIMEOUT_MS);

          let readResult: { done: boolean; value?: Uint8Array };
          try {
            readResult = await reader.read();
            lastActivityTime = Date.now(); // Update activity time on successful read
          } catch (readError) {
            logger.error('AgentStream', 'Error reading from stream', readError);
            throw new Error(`Stream read error: ${readError instanceof Error ? readError.message : String(readError)}`);
          } finally {
            // Clear timeout after read completes
            if (timeoutRef.current) {
              clearTimeout(timeoutRef.current);
              timeoutRef.current = null;
            }
          }

          const { done, value } = readResult;

          if (done) {
            logger.info('AgentStream', 'SSE stream complete', { eventsReceived: eventCount });
            break;
          }

          // Check for cancellation
          if (abortControllerRef.current?.signal.aborted) {
            logger.info('AgentStream', 'Request cancelled');
            reader.cancel();
            break;
          }

          // Check buffer size
          if (buffer.length > MAX_BUFFER_SIZE) {
            logger.warn('AgentStream', `Buffer exceeded ${MAX_BUFFER_SIZE} bytes - possible parsing issue`);
          }

          buffer += decoder.decode(value, { stream: true });
          const { events, remaining, parseErrors } = parseSSE(buffer);
          buffer = remaining;
          
          // Collect parse errors
          if (parseErrors.length > 0) {
            allParseErrors.push(...parseErrors);
          }

          for (const event of events) {
            eventCount++;
            logger.debug('AgentStream', `SSE event received: ${event.type}`, event);

            // Process for observability panel
            processEvent(event);

            // Process for chat display
            handleChatEvent(event);

            // Track final content for TTS callback
            if (event.type === 'agent.final') {
              const eventData = event as { type: 'agent.final'; content: string };
              finalContent = eventData.content;
              logger.info('AgentStream', 'Agent response complete', { contentLength: finalContent.length });
            }
          }
        }

        // Report parse errors if any
        if (allParseErrors.length > 0) {
          logger.warn('AgentStream', `Had ${allParseErrors.length} SSE parse errors during stream`);
          // Only show error to user if we got no valid events
          if (eventCount === 0) {
            setError(`Failed to parse server response. ${allParseErrors[0]}`);
          }
        }

        // Call response callback for TTS
        if (finalContent && onResponseReady) {
          logger.debug('AgentStream', 'Calling TTS callback');
          onResponseReady(finalContent, messageId);
        }

        setIsLoading(false);
      } catch (err: any) {
        if (err.name === 'AbortError') {
          logger.info('AgentStream', 'Request cancelled by user');
        } else {
          const errorMessage = err.message || 'Failed to get response';
          logger.error('AgentStream', 'Error during message send', { error: errorMessage });
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
        // Clean up all resources
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
          timeoutRef.current = null;
        }
        readerRef.current = null;
        abortControllerRef.current = null;
      }
    },
    [handleChatEvent, processEvent, startRun, cleanupStream]
  );

  const cancelRun = useCallback(() => {
    logger.info('AgentStream', 'Cancelling run');
    cleanupStream();

    if (DEMO_MODE) {
      logger.debug('AgentStream', 'Demo mode - cancelling mock run');
      return;
    }

    // Mark streaming message as complete
    setMessages((prev) => {
      const lastMessage = prev[prev.length - 1];
      if (lastMessage?.isStreaming) {
        logger.debug('AgentStream', 'Marking streaming message as complete');
        return [
          ...prev.slice(0, -1),
          { ...lastMessage, isStreaming: false },
        ];
      }
      return prev;
    });
  }, [cleanupStream]);

  const clearMessages = useCallback(() => {
    logger.info('AgentStream', 'Clearing messages');
    setMessages([]);
    setError(null);
    clearRun();
    logger.info('AgentStream', 'Messages cleared');
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
