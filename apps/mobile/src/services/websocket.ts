// =============================================================================
// WebSocket Service - Socket.io Client
// =============================================================================
// Real-time connection to backend using Socket.io for streaming events.

import { io, Socket } from 'socket.io-client';
import { getAccessToken } from './api';
import { SOCKET_URL, DEMO_MODE } from '../config';
import { logger } from '../utils/logger';

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
    if (status !== newStatus) {
      logger.info('Socket', `Status changed: ${status} -> ${newStatus}`);
      status = newStatus;
      statusListeners.forEach((cb) => cb(status));
    }
  }

  async function connect(): Promise<void> {
    logger.info('Socket', 'Connection requested');
    
    // Skip in demo mode
    if (DEMO_MODE) {
      logger.info('Socket', 'Demo mode - skipping connection');
      return;
    }

    // Already connected
    if (socket?.connected) {
      logger.debug('Socket', 'Already connected');
      return;
    }

    // Get auth token
    const token = await getAccessToken();
    if (!token) {
      logger.error('Socket', 'No access token available');
      setStatus('error');
      return;
    }

    setStatus('connecting');
    logger.info('Socket', `Connecting to ${SOCKET_URL}`);

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
        logger.info('Socket', `Connected (ID: ${socket?.id})`);
        setStatus('connected');
        reconnectAttempts = 0;
        resolve();
      });

      socket.on('disconnect', (reason) => {
        logger.info('Socket', `Disconnected: ${reason}`);
        setStatus('disconnected');
      });

      socket.on('connect_error', (error) => {
        logger.error('Socket', `Connection error: ${error.message}`);
        reconnectAttempts++;
        logger.warn('Socket', `Reconnect attempt ${reconnectAttempts}/${maxReconnectAttempts}`);
        if (reconnectAttempts >= maxReconnectAttempts) {
          logger.error('Socket', 'Max reconnection attempts reached');
          setStatus('error');
          reject(error);
        }
      });

      socket.on('reconnect', (attemptNumber) => {
        logger.info('Socket', `Reconnected on attempt ${attemptNumber}`);
      });

      socket.on('reconnect_attempt', (attemptNumber) => {
        logger.debug('Socket', `Reconnection attempt ${attemptNumber}`);
      });

      // Handle agent events broadcast to user
      socket.on('agent:event', (event: StreamEvent) => {
        logger.debug('Socket', `Agent event received: ${event.type}`, event);
        // Broadcast to all run listeners (for events not specific to a run)
        runListeners.forEach((listeners, runId) => {
          logger.debug('Socket', `Broadcasting to ${listeners.size} listeners for run ${runId}`);
          listeners.forEach((cb) => cb(event));
        });
      });

      // Handle run-specific events
      socket.onAny((eventName: string, event: StreamEvent) => {
        // Check if event is for a specific run (format: run:<runId>)
        if (eventName.startsWith('run:')) {
          const runId = eventName.slice(4);
          logger.debug('Socket', `Run-specific event received: ${eventName}`, { runId, type: event.type });
          const listeners = runListeners.get(runId);
          if (listeners) {
            listeners.forEach((cb) => cb(event));
          } else {
            logger.warn('Socket', `No listeners found for run ${runId}`);
          }
        }
      });
    });
  }

  function disconnect(): void {
    logger.info('Socket', 'Disconnecting');
    if (socket) {
      socket.disconnect();
      socket = null;
      logger.info('Socket', 'Disconnected successfully');
    } else {
      logger.debug('Socket', 'No active socket to disconnect');
    }
    setStatus('disconnected');
  }

  function subscribeToRun(runId: string, callback: (event: StreamEvent) => void): () => void {
    logger.info('Socket', `Subscribing to run: ${runId}`);
    
    // Add listener
    if (!runListeners.has(runId)) {
      runListeners.set(runId, new Set());
      logger.debug('Socket', `Created new listener set for run: ${runId}`);
    }
    runListeners.get(runId)!.add(callback);
    logger.debug('Socket', `Added listener for run ${runId}. Total listeners: ${runListeners.get(runId)!.size}`);

    // Subscribe to run events via socket
    if (socket?.connected) {
      logger.debug('Socket', `Emitting subscribe:run for ${runId}`);
      socket.emit('subscribe:run', runId);
    } else {
      logger.warn('Socket', `Cannot subscribe to run ${runId} - socket not connected`);
    }

    // Return unsubscribe function
    return () => {
      logger.info('Socket', `Unsubscribing from run: ${runId}`);
      const listeners = runListeners.get(runId);
      if (listeners) {
        listeners.delete(callback);
        logger.debug('Socket', `Removed listener for run ${runId}. Remaining: ${listeners.size}`);
        if (listeners.size === 0) {
          runListeners.delete(runId);
          logger.debug('Socket', `Deleted empty listener set for run: ${runId}`);
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
    logger.debug('Socket', `Status change listener added. Total listeners: ${statusListeners.size + 1}`);
    statusListeners.add(callback);
    // Immediately call with current status
    callback(status);
    return () => {
      logger.debug('Socket', 'Status change listener removed');
      statusListeners.delete(callback);
    };
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
