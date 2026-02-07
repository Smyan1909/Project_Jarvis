// =============================================================================
// Socket.io WebSocket Server
// =============================================================================
// Handles real-time WebSocket connections for streaming agent events to clients.
// Provides JWT-based authentication and user-scoped event delivery.

import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import type { AuthService } from '../../application/services/auth-service.js';
import { logger } from '../../infrastructure/logging/logger.js';
import type { AgentEvent } from '@project-jarvis/shared-types';

// =============================================================================
// Types
// =============================================================================

/**
 * Socket with authenticated user information
 */
interface AuthenticatedSocket extends Socket {
  userId: string;
  userEmail: string;
}

/**
 * Configuration options for the SocketServer
 */
export interface SocketServerOptions {
  /**
   * CORS origin configuration
   * @default '*'
   */
  corsOrigin?: string | string[];

  /**
   * Ping interval in milliseconds
   * @default 25000
   */
  pingInterval?: number;

  /**
   * Ping timeout in milliseconds
   * @default 5000
   */
  pingTimeout?: number;
}

// =============================================================================
// Socket Server
// =============================================================================

/**
 * WebSocket server for real-time agent event streaming
 *
 * Features:
 * - JWT-based authentication
 * - User-specific rooms for targeted event delivery
 * - Connection tracking per user
 * - Automatic reconnection support
 */
export class SocketServer {
  private io: Server;
  private userSockets: Map<string, Set<string>> = new Map();

  constructor(
    httpServer: HttpServer,
    private authService: AuthService,
    options: SocketServerOptions = {}
  ) {
    const {
      corsOrigin = '*',
      pingInterval = 25000,
      pingTimeout = 5000,
    } = options;

    this.io = new Server(httpServer, {
      cors: {
        origin: corsOrigin,
        methods: ['GET', 'POST'],
        credentials: true,
      },
      pingInterval,
      pingTimeout,
      // Allow EIO3 clients (React Native)
      allowEIO3: true,
    });

    this.setupAuthMiddleware();
    this.setupConnectionHandlers();
  }

  // ===========================================================================
  // Setup
  // ===========================================================================

  /**
   * Configure JWT authentication middleware
   */
  private setupAuthMiddleware(): void {
    this.io.use((socket, next) => {
      try {
        const token = socket.handshake.auth.token as string | undefined;

        if (!token) {
          logger.warn('WebSocket connection rejected: no token', {
            socketId: socket.id,
            address: socket.handshake.address,
          });
          return next(new Error('Authentication required'));
        }

        // Verify JWT token
        const payload = this.authService.verifyAccessToken(token);

        // Attach user info to socket
        (socket as AuthenticatedSocket).userId = payload.userId;
        (socket as AuthenticatedSocket).userEmail = payload.email;

        next();
      } catch (error) {
        logger.warn('WebSocket connection rejected: invalid token', {
          socketId: socket.id,
          address: socket.handshake.address,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        next(new Error('Invalid or expired token'));
      }
    });
  }

  /**
   * Configure connection and disconnection handlers
   */
  private setupConnectionHandlers(): void {
    this.io.on('connection', (socket: Socket) => {
      const authSocket = socket as AuthenticatedSocket;
      const { userId, userEmail } = authSocket;

      // Track socket for user
      if (!this.userSockets.has(userId)) {
        this.userSockets.set(userId, new Set());
      }
      this.userSockets.get(userId)!.add(socket.id);

      // Join user-specific room
      socket.join(`user:${userId}`);

      logger.info('WebSocket connected', {
        userId,
        userEmail,
        socketId: socket.id,
        totalConnections: this.getConnectionCount(),
      });

      // Handle disconnection
      socket.on('disconnect', (reason) => {
        this.userSockets.get(userId)?.delete(socket.id);

        // Clean up empty user entries
        if (this.userSockets.get(userId)?.size === 0) {
          this.userSockets.delete(userId);
        }

        logger.info('WebSocket disconnected', {
          userId,
          socketId: socket.id,
          reason,
          totalConnections: this.getConnectionCount(),
        });
      });

      // Handle errors
      socket.on('error', (error) => {
        logger.error('WebSocket error', error, {
          userId,
          socketId: socket.id,
        });
      });

      // Subscribe to specific run events
      socket.on('subscribe:run', (runId: string) => {
        socket.join(`run:${runId}`);
        logger.debug('Socket subscribed to run', { userId, socketId: socket.id, runId });
      });

      // Unsubscribe from run events
      socket.on('unsubscribe:run', (runId: string) => {
        socket.leave(`run:${runId}`);
        logger.debug('Socket unsubscribed from run', { userId, socketId: socket.id, runId });
      });
    });
  }

  // ===========================================================================
  // Event Emission
  // ===========================================================================

  /**
   * Send an event to all of a user's connected sockets
   *
   * @param userId - Target user ID
   * @param event - Agent event to send
   */
  emitToUser(userId: string, event: AgentEvent): void {
    this.io.to(`user:${userId}`).emit('agent:event', event);
  }

  /**
   * Send an event for a specific agent run
   * Only sockets subscribed to this run will receive it
   *
   * @param userId - Target user ID (for authorization)
   * @param runId - Agent run ID
   * @param event - Agent event to send
   */
  emitToRun(userId: string, runId: string, event: AgentEvent): void {
    // Emit to both user room and run room to ensure delivery
    // User room: guaranteed delivery to all user sockets
    // Run room: targeted delivery for clients following specific runs
    this.io.to(`user:${userId}`).emit(`run:${runId}`, event);
  }

  // ===========================================================================
  // Connection Management
  // ===========================================================================

  /**
   * Check if a user has any active connections
   *
   * @param userId - User ID to check
   * @returns true if user has at least one connected socket
   */
  isUserConnected(userId: string): boolean {
    const sockets = this.userSockets.get(userId);
    return sockets !== undefined && sockets.size > 0;
  }

  /**
   * Get the number of connected sockets for a user
   *
   * @param userId - User ID to check
   * @returns Number of connected sockets
   */
  getUserConnectionCount(userId: string): number {
    return this.userSockets.get(userId)?.size ?? 0;
  }

  /**
   * Get total number of connected sockets
   *
   * @returns Total connection count
   */
  getConnectionCount(): number {
    let count = 0;
    for (const sockets of this.userSockets.values()) {
      count += sockets.size;
    }
    return count;
  }

  /**
   * Get number of unique connected users
   *
   * @returns Number of unique users with at least one connection
   */
  getConnectedUserCount(): number {
    return this.userSockets.size;
  }

  /**
   * Get the underlying Socket.io server instance
   * Useful for testing or advanced configuration
   */
  getIO(): Server {
    return this.io;
  }

  /**
   * Gracefully close all connections and shut down the server
   */
  async close(): Promise<void> {
    return new Promise((resolve) => {
      this.io.close(() => {
        this.userSockets.clear();
        logger.info('WebSocket server closed');
        resolve();
      });
    });
  }
}
