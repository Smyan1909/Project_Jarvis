import { useState, useEffect, useCallback, useRef } from 'react';
import { agentApi } from '../services/api';
import { wsManager, AgentEvent } from '../services/websocket';
import { streamMockResponse } from '../services/mockAgent';
import { DEMO_MODE } from '../config';

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
  sendMessage: (content: string) => Promise<void>;
  cancelRun: () => void;
}

export function useAgentStream(): UseAgentStreamResult {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const currentRunIdRef = useRef<string | null>(null);
  const streamingContentRef = useRef<string>('');
  const cancelMockStreamRef = useRef<(() => void) | null>(null);

  // Connect WebSocket on mount (skip in demo mode)
  useEffect(() => {
    if (!DEMO_MODE) {
      wsManager.connect().catch(console.error);
    }
    return () => {
      // Don't disconnect on unmount - let it persist
      // Cancel any mock stream on unmount
      if (cancelMockStreamRef.current) {
        cancelMockStreamRef.current();
      }
    };
  }, []);

  const handleEvent = useCallback((event: AgentEvent) => {
    switch (event.type) {
      case 'agent.token':
        streamingContentRef.current += event.token;
        setMessages(prev => {
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

      case 'agent.tool_call':
        setMessages(prev => {
          const lastMessage = prev[prev.length - 1];
          if (lastMessage?.role === 'assistant') {
            const toolCall: ToolCallInfo = {
              id: event.toolId,
              name: event.toolName,
              input: event.input,
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

      case 'agent.tool_result':
        setMessages(prev => {
          const lastMessage = prev[prev.length - 1];
          if (lastMessage?.toolCalls) {
            const updatedToolCalls = lastMessage.toolCalls.map(tc => {
              if (tc.id === event.toolId) {
                const newStatus: 'success' | 'error' = event.success ? 'success' : 'error';
                return { ...tc, output: event.output, status: newStatus };
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

      case 'agent.final':
        setMessages(prev => {
          const lastMessage = prev[prev.length - 1];
          if (lastMessage?.isStreaming) {
            return [
              ...prev.slice(0, -1),
              { ...lastMessage, content: event.content, isStreaming: false },
            ];
          }
          return prev;
        });
        setIsLoading(false);
        break;

      case 'agent.error':
        setError(event.message);
        setIsLoading(false);
        setMessages(prev => {
          const lastMessage = prev[prev.length - 1];
          if (lastMessage?.isStreaming) {
            return [
              ...prev.slice(0, -1),
              { ...lastMessage, isStreaming: false },
            ];
          }
          return prev;
        });
        break;

      case 'agent.status':
        if (event.status === 'completed' || event.status === 'failed' || event.status === 'cancelled') {
          setIsLoading(false);
        }
        break;
    }
  }, []);

  const sendMessage = useCallback(async (content: string): Promise<void> => {
    setError(null);
    setIsLoading(true);
    streamingContentRef.current = '';

    // Add user message
    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: 'user',
      content,
    };
    setMessages(prev => [...prev, userMessage]);

    // Add placeholder assistant message
    const assistantMessage: Message = {
      id: `assistant-${Date.now()}`,
      role: 'assistant',
      content: '',
      isStreaming: true,
    };
    setMessages(prev => [...prev, assistantMessage]);

    // Demo mode: use mock streaming
    if (DEMO_MODE) {
      cancelMockStreamRef.current = streamMockResponse(content, {
        onToken: (token) => {
          streamingContentRef.current += token;
          setMessages(prev => {
            const lastMessage = prev[prev.length - 1];
            if (lastMessage?.isStreaming) {
              return [
                ...prev.slice(0, -1),
                { ...lastMessage, content: streamingContentRef.current },
              ];
            }
            return prev;
          });
        },
        onComplete: (fullContent) => {
          setMessages(prev => {
            const lastMessage = prev[prev.length - 1];
            if (lastMessage?.isStreaming) {
              return [
                ...prev.slice(0, -1),
                { ...lastMessage, content: fullContent, isStreaming: false },
              ];
            }
            return prev;
          });
          setIsLoading(false);
          cancelMockStreamRef.current = null;
        },
        onError: (errorMessage) => {
          setError(errorMessage);
          setIsLoading(false);
          cancelMockStreamRef.current = null;
        },
      });
      return;
    }

    // Production mode: use real API and WebSocket
    try {
      // Start the run
      const response = await agentApi.startRun(content);
      const runId = response.data.data.id;
      currentRunIdRef.current = runId;

      // Subscribe to events
      wsManager.subscribe(runId, handleEvent);
    } catch (err: any) {
      setError(err.message || 'Failed to start conversation');
      setIsLoading(false);
      // Remove the streaming message
      setMessages(prev => prev.slice(0, -1));
    }
  }, [handleEvent]);

  const cancelRun = useCallback(() => {
    // Demo mode: cancel mock stream
    if (DEMO_MODE && cancelMockStreamRef.current) {
      cancelMockStreamRef.current();
      cancelMockStreamRef.current = null;
      setIsLoading(false);
      // Mark streaming message as complete
      setMessages(prev => {
        const lastMessage = prev[prev.length - 1];
        if (lastMessage?.isStreaming) {
          return [
            ...prev.slice(0, -1),
            { ...lastMessage, isStreaming: false },
          ];
        }
        return prev;
      });
      return;
    }

    // Production mode: cancel via API
    if (currentRunIdRef.current) {
      agentApi.cancelRun(currentRunIdRef.current).catch(console.error);
      setIsLoading(false);
    }
  }, []);

  return {
    messages,
    isLoading,
    error,
    sendMessage,
    cancelRun,
  };
}
