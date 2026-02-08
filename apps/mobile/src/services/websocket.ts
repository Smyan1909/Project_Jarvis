// =============================================================================
// WebSocket Service - Socket.io Client
// =============================================================================
// Real-time connection to backend using Socket.io for streaming events.

import { io, Socket } from 'socket.io-client';
import { getAccessToken } from './api';
import { SOCKET_URL, DEMO_MODE } from '../config';

// =============================================================================
// Types
// =============================================================================

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

// Re-export StreamEvent type for convenience
// In production, import from @project-jarvis/shared-types
export type StreamEvent =
  | { type: 'agent.token'; token: string }
  | { type: 'agent.tool_call'; toolId: string; toolName: string; input: unknown }
  | { type: 'agent.tool_result'; toolId: string; output: unknown; success: boolean }
  | { type: 'agent.final'; content: string; usage?: { totalTokens: number; totalCost: number } }
  | { type: 'agent.error'; message: string; code?: string }
  | { type: 'agent.status'; status: 'running' | 'completed' | 'failed' | 'cancelled' }
  | { type: 'orchestrator.status'; status: string; message?: string }
  | { type: 'plan.created'; planId: string; taskCount: number; structure: string; tasks: any[] }
  | { type: 'plan.modified'; planId: string; modification: string; reason: string; affectedTaskIds: string[] }
  | { type: 'task.started'; taskId: string; description: string; agentType: string; agentId: string }
  | { type: 'task.progress'; taskId: string; agentId: string; progress: string }
  | { type: 'task.completed'; taskId: string; success: boolean; result?: unknown; error?: string }
  | { type: 'agent.spawned'; agentId: string; taskId: string; agentType: string; taskDescription: string }
  | { type: 'agent.reasoning'; agentId: string; step: { id: string; type: string; content: string } }
  | { type: 'agent.intervention'; agentId: string; taskId: string; reason: string; action: string; guidance?: string }
  | { type: 'agent.terminated'; agentId: string; taskId: string; reason: string; error?: string }
  | { type: 'monitoring.event_received'; eventId: string; triggerType: string; toolkit: string; title: string; summary: string }
  | { type: string; [key: string]: unknown };

// Backwards compatibility alias
export type AgentEvent = StreamEvent;

export interface SocketManager {
  connect: () => Promise<void>;
  disconnect: () => void;
  subscribeToRun: (runId: string, callback: (event: StreamEvent) => void) => () => void;
  getStatus: () => ConnectionStatus;
  onStatusChange: (callback: (status: ConnectionStatus) => void) => () => void;
  isConnected: () => boolean;
}

// =============================================================================
// Socket Manager Factory
// =============================================================================

export function createSocketManager(): SocketManager {
  let socket: Socket | null = null;
  let status: ConnectionStatus = 'disconnected';
  let reconnectAttempts = 0;
  const maxReconnectAttempts = 5;

  const statusListeners = new Set<(status: ConnectionStatus) => void>();
  const runListeners = new Map<string, Set<(event: StreamEvent) => void>>();

  function setStatus(newStatus: ConnectionStatus) {
    status = newStatus;
    statusListeners.forEach((cb) => cb(status));
  }

  async function connect(): Promise<void> {
    // Skip in demo mode
    if (DEMO_MODE) {
      console.log('[Socket] Demo mode - skipping connection');
      return;
    }

    // Already connected
    if (socket?.connected) {
      return;
    }

    // Get auth token
    const token = await getAccessToken();
    if (!token) {
      console.log('[Socket] No access token available');
      setStatus('error');
      return;
    }

    setStatus('connecting');

    return new Promise((resolve, reject) => {
      socket = io(SOCKET_URL, {
        auth: { token },
        transports: ['websocket'],
        reconnection: true,
        reconnectionAttempts: maxReconnectAttempts,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        timeout: 10000,
      });

      socket.on('connect', () => {
        console.log('[Socket] Connected');
        setStatus('connected');
        reconnectAttempts = 0;
        resolve();
      });

      socket.on('disconnect', (reason) => {
        console.log('[Socket] Disconnected:', reason);
        setStatus('disconnected');
      });

      socket.on('connect_error', (error) => {
        console.error('[Socket] Connection error:', error.message);
        reconnectAttempts++;
        if (reconnectAttempts >= maxReconnectAttempts) {
          setStatus('error');
          reject(error);
        }
      });

      // Handle agent events broadcast to user
      socket.on('agent:event', (event: StreamEvent) => {
        // Broadcast to all run listeners (for events not specific to a run)
        runListeners.forEach((listeners) => {
          listeners.forEach((cb) => cb(event));
        });
      });

      // Handle run-specific events
      socket.onAny((eventName: string, event: StreamEvent) => {
        // Check if event is for a specific run (format: run:<runId>)
        if (eventName.startsWith('run:')) {
          const runId = eventName.slice(4);
          const listeners = runListeners.get(runId);
          if (listeners) {
            listeners.forEach((cb) => cb(event));
          }
        }
      });
    });
  }

  function disconnect(): void {
    if (socket) {
      socket.disconnect();
      socket = null;
    }
    setStatus('disconnected');
  }

  function subscribeToRun(runId: string, callback: (event: StreamEvent) => void): () => void {
    // Add listener
    if (!runListeners.has(runId)) {
      runListeners.set(runId, new Set());
    }
    runListeners.get(runId)!.add(callback);

    // Subscribe to run events via socket
    if (socket?.connected) {
      socket.emit('subscribe:run', runId);
    }

    // Return unsubscribe function
    return () => {
      const listeners = runListeners.get(runId);
      if (listeners) {
        listeners.delete(callback);
        if (listeners.size === 0) {
          runListeners.delete(runId);
          // Unsubscribe from run events
          if (socket?.connected) {
            socket.emit('unsubscribe:run', runId);
          }
        }
      }
    };
  }

  function getStatus(): ConnectionStatus {
    return status;
  }

  function onStatusChange(callback: (status: ConnectionStatus) => void): () => void {
    statusListeners.add(callback);
    // Immediately call with current status
    callback(status);
    return () => statusListeners.delete(callback);
  }

  function isConnected(): boolean {
    return socket?.connected ?? false;
  }

  return {
    connect,
    disconnect,
    subscribeToRun,
    getStatus,
    onStatusChange,
    isConnected,
  };
}

// =============================================================================
// Singleton Instance
// =============================================================================

export const socketManager = createSocketManager();

// Backwards compatibility
export const wsManager = socketManager;
