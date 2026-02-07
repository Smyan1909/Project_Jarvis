import { getAccessToken } from './api';
import { WS_URL } from '../config';

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

export interface WebSocketManager {
  connect: () => Promise<void>;
  disconnect: () => void;
  subscribe: (runId: string, callback: (event: AgentEvent) => void) => () => void;
  getStatus: () => ConnectionStatus;
  onStatusChange: (callback: (status: ConnectionStatus) => void) => () => void;
}

// Agent event types (from shared-types)
export type AgentEvent =
  | { type: 'agent.token'; token: string }
  | { type: 'agent.tool_call'; toolId: string; toolName: string; input: unknown }
  | { type: 'agent.tool_result'; toolId: string; output: unknown; success: boolean }
  | { type: 'agent.final'; content: string; usage?: { totalTokens: number; totalCost: number } }
  | { type: 'agent.error'; message: string; code?: string }
  | { type: 'agent.status'; status: 'running' | 'completed' | 'failed' | 'cancelled' };

export function createWebSocketManager(): WebSocketManager {
  let socket: WebSocket | null = null;
  let status: ConnectionStatus = 'disconnected';
  let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  let reconnectAttempts = 0;
  const maxReconnectAttempts = 5;

  const statusListeners = new Set<(status: ConnectionStatus) => void>();
  const runListeners = new Map<string, Set<(event: AgentEvent) => void>>();

  function setStatus(newStatus: ConnectionStatus) {
    status = newStatus;
    statusListeners.forEach(cb => cb(status));
  }

  async function connect(): Promise<void> {
    if (socket?.readyState === WebSocket.OPEN) {
      return;
    }

    setStatus('connecting');

    const token = await getAccessToken();
    if (!token) {
      setStatus('error');
      throw new Error('No access token available');
    }

    return new Promise((resolve, reject) => {
      socket = new WebSocket(WS_URL);

      socket.onopen = () => {
        // Authenticate
        socket?.send(JSON.stringify({ type: 'auth', token }));
      };

      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          // Handle auth response
          if (data.type === 'auth.success') {
            setStatus('connected');
            reconnectAttempts = 0;
            resolve();
            return;
          }

          if (data.type === 'auth.error') {
            setStatus('error');
            reject(new Error(data.message));
            return;
          }

          // Handle run events
          if (data.runId && runListeners.has(data.runId)) {
            runListeners.get(data.runId)?.forEach(cb => cb(data.event));
          }

          // Handle global agent events (format: run:<runId>)
          const runIdMatch = data.channel?.match(/^run:(.+)$/);
          if (runIdMatch && runListeners.has(runIdMatch[1])) {
            runListeners.get(runIdMatch[1])?.forEach(cb => cb(data.event));
          }
        } catch (e) {
          console.error('WebSocket message parse error:', e);
        }
      };

      socket.onerror = (error) => {
        console.error('WebSocket error:', error);
        setStatus('error');
      };

      socket.onclose = () => {
        setStatus('disconnected');
        socket = null;

        // Attempt reconnect
        if (reconnectAttempts < maxReconnectAttempts) {
          reconnectAttempts++;
          const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
          reconnectTimeout = setTimeout(() => {
            connect().catch(console.error);
          }, delay);
        }
      };
    });
  }

  function disconnect() {
    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout);
      reconnectTimeout = null;
    }
    reconnectAttempts = maxReconnectAttempts; // Prevent reconnect
    socket?.close();
    socket = null;
    setStatus('disconnected');
  }

  function subscribe(runId: string, callback: (event: AgentEvent) => void): () => void {
    if (!runListeners.has(runId)) {
      runListeners.set(runId, new Set());
    }
    runListeners.get(runId)!.add(callback);

    // Subscribe to run channel
    socket?.send(JSON.stringify({ type: 'subscribe', channel: `run:${runId}` }));

    return () => {
      runListeners.get(runId)?.delete(callback);
      if (runListeners.get(runId)?.size === 0) {
        runListeners.delete(runId);
        socket?.send(JSON.stringify({ type: 'unsubscribe', channel: `run:${runId}` }));
      }
    };
  }

  function getStatus(): ConnectionStatus {
    return status;
  }

  function onStatusChange(callback: (status: ConnectionStatus) => void): () => void {
    statusListeners.add(callback);
    return () => statusListeners.delete(callback);
  }

  return {
    connect,
    disconnect,
    subscribe,
    getStatus,
    onStatusChange,
  };
}

// Singleton instance
export const wsManager = createWebSocketManager();
