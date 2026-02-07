// =============================================================================
// Socket Server - E2E Integration Tests
// =============================================================================
// Tests run with a real Socket.io server and client to verify WebSocket
// functionality including authentication, connection management, and events.

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { createServer, Server as HttpServer } from 'http';
import { io as ioc, Socket as ClientSocket } from 'socket.io-client';
import { SocketServer } from './socket-server.js';
import { AuthService } from '../../application/services/auth-service.js';
import { UserRepository } from '../../adapters/storage/user-repository.js';
import { RefreshTokenRepository } from '../../adapters/storage/refresh-token-repository.js';
import { db, queryClient } from '../../infrastructure/db/client.js';
import { users } from '../../infrastructure/db/schema.js';
import { sql } from 'drizzle-orm';
import type { AgentEvent } from '@project-jarvis/shared-types';

describe('SocketServer E2E Integration', () => {
  let httpServer: HttpServer;
  let socketServer: SocketServer;
  let authService: AuthService;
  let userRepo: UserRepository;
  let refreshTokenRepo: RefreshTokenRepository;
  let testUserId: string;
  let testUserEmail: string;
  let accessToken: string;
  let serverPort: number;
  const clients: ClientSocket[] = [];

  // ===========================================================================
  // Setup / Teardown
  // ===========================================================================

  beforeAll(async () => {
    // Create repositories and services
    userRepo = new UserRepository();
    refreshTokenRepo = new RefreshTokenRepository();
    authService = new AuthService(userRepo, refreshTokenRepo);

    // Create a test user and get tokens
    testUserEmail = `ws-test-${Date.now()}@example.com`;
    const result = await authService.register(testUserEmail, 'password123', 'WS Test User');
    accessToken = result.tokens.accessToken;

    // Get user ID from token
    const payload = authService.verifyAccessToken(accessToken);
    testUserId = payload.userId;

    // Create HTTP server on random port
    httpServer = createServer();
    await new Promise<void>((resolve) => {
      httpServer.listen(0, () => {
        const addr = httpServer.address();
        serverPort = typeof addr === 'object' && addr ? addr.port : 0;
        resolve();
      });
    });

    // Create SocketServer
    socketServer = new SocketServer(httpServer, authService, {
      corsOrigin: '*',
      pingInterval: 5000,
      pingTimeout: 2000,
    });
  });

  afterEach(async () => {
    // Disconnect all test clients
    for (const client of clients) {
      if (client.connected) {
        client.disconnect();
      }
    }
    clients.length = 0;

    // Small delay to let disconnects process
    await new Promise((resolve) => setTimeout(resolve, 50));
  });

  afterAll(async () => {
    // Close socket server
    await socketServer.close();

    // Close HTTP server
    await new Promise<void>((resolve) => {
      httpServer.close(() => resolve());
    });

    // Clean up test user
    await db.delete(users).where(sql`email = ${testUserEmail}`);
    await queryClient.end();
  });

  // ===========================================================================
  // Helper Functions
  // ===========================================================================

  function createClient(token?: string): ClientSocket {
    const client = ioc(`http://localhost:${serverPort}`, {
      auth: { token: token ?? accessToken },
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
    });
    clients.push(client);
    return client;
  }

  function waitForConnect(client: ClientSocket): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Connection timeout')), 5000);
      client.on('connect', () => {
        clearTimeout(timeout);
        resolve();
      });
      client.on('connect_error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }

  function waitForDisconnect(client: ClientSocket): Promise<void> {
    return new Promise((resolve) => {
      if (!client.connected) {
        resolve();
        return;
      }
      client.on('disconnect', () => resolve());
    });
  }

  function waitForEvent<T>(client: ClientSocket, event: string): Promise<T> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Event timeout: ${event}`)), 5000);
      client.once(event, (data: T) => {
        clearTimeout(timeout);
        resolve(data);
      });
    });
  }

  // ===========================================================================
  // Authentication Tests
  // ===========================================================================

  describe('Authentication', () => {
    it('should accept connection with valid JWT token', async () => {
      const client = createClient();
      await waitForConnect(client);

      expect(client.connected).toBe(true);
    });

    it('should reject connection without token', async () => {
      const client = createClient('');

      await expect(waitForConnect(client)).rejects.toThrow();
      expect(client.connected).toBe(false);
    });

    it('should reject connection with invalid token', async () => {
      const client = createClient('invalid-token-here');

      await expect(waitForConnect(client)).rejects.toThrow();
      expect(client.connected).toBe(false);
    });

    it('should reject connection with expired token', async () => {
      // Create an expired-looking token (malformed)
      const expiredToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJleHAiOjB9.invalid';
      const client = createClient(expiredToken);

      await expect(waitForConnect(client)).rejects.toThrow();
      expect(client.connected).toBe(false);
    });
  });

  // ===========================================================================
  // Connection Management Tests
  // ===========================================================================

  describe('Connection Management', () => {
    it('should track connected users', async () => {
      expect(socketServer.isUserConnected(testUserId)).toBe(false);

      const client = createClient();
      await waitForConnect(client);

      expect(socketServer.isUserConnected(testUserId)).toBe(true);
      expect(socketServer.getUserConnectionCount(testUserId)).toBe(1);
    });

    it('should track multiple connections for same user', async () => {
      const client1 = createClient();
      const client2 = createClient();

      await Promise.all([waitForConnect(client1), waitForConnect(client2)]);

      expect(socketServer.getUserConnectionCount(testUserId)).toBe(2);
      expect(socketServer.getConnectionCount()).toBe(2);
    });

    it('should clean up on disconnect', async () => {
      const client = createClient();
      await waitForConnect(client);

      expect(socketServer.isUserConnected(testUserId)).toBe(true);

      client.disconnect();
      await waitForDisconnect(client);

      // Give some time for cleanup
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(socketServer.isUserConnected(testUserId)).toBe(false);
    });

    it('should maintain connection count correctly with partial disconnects', async () => {
      const client1 = createClient();
      const client2 = createClient();

      await Promise.all([waitForConnect(client1), waitForConnect(client2)]);
      expect(socketServer.getUserConnectionCount(testUserId)).toBe(2);

      client1.disconnect();
      await waitForDisconnect(client1);
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(socketServer.getUserConnectionCount(testUserId)).toBe(1);
      expect(socketServer.isUserConnected(testUserId)).toBe(true);
    });
  });

  // ===========================================================================
  // Event Emission Tests
  // ===========================================================================

  describe('Event Emission', () => {
    it('should emit events to user room', async () => {
      const client = createClient();
      await waitForConnect(client);

      const eventPromise = waitForEvent<AgentEvent>(client, 'agent:event');

      const testEvent: AgentEvent = {
        type: 'agent.token',
        token: 'Hello',
      };
      socketServer.emitToUser(testUserId, testEvent);

      const received = await eventPromise;
      expect(received).toEqual(testEvent);
    });

    it('should emit run-specific events', async () => {
      const client = createClient();
      await waitForConnect(client);

      const runId = 'test-run-123';
      const eventPromise = waitForEvent<AgentEvent>(client, `run:${runId}`);

      const testEvent: AgentEvent = {
        type: 'agent.status',
        status: 'running',
      };
      socketServer.emitToRun(testUserId, runId, testEvent);

      const received = await eventPromise;
      expect(received).toEqual(testEvent);
    });

    it('should deliver events to all user connections', async () => {
      const client1 = createClient();
      const client2 = createClient();

      await Promise.all([waitForConnect(client1), waitForConnect(client2)]);

      const event1Promise = waitForEvent<AgentEvent>(client1, 'agent:event');
      const event2Promise = waitForEvent<AgentEvent>(client2, 'agent:event');

      const testEvent: AgentEvent = {
        type: 'agent.final',
        content: 'Done!',
      };
      socketServer.emitToUser(testUserId, testEvent);

      const [received1, received2] = await Promise.all([event1Promise, event2Promise]);
      expect(received1).toEqual(testEvent);
      expect(received2).toEqual(testEvent);
    });

    it('should emit tool call events correctly', async () => {
      const client = createClient();
      await waitForConnect(client);

      const runId = 'test-run-456';
      const eventPromise = waitForEvent<AgentEvent>(client, `run:${runId}`);

      const testEvent: AgentEvent = {
        type: 'agent.tool_call',
        toolId: 'call-123',
        toolName: 'web_search',
        input: { query: 'What is TypeScript?' },
      };
      socketServer.emitToRun(testUserId, runId, testEvent);

      const received = await eventPromise;
      expect(received).toEqual(testEvent);
    });

    it('should emit tool result events correctly', async () => {
      const client = createClient();
      await waitForConnect(client);

      const runId = 'test-run-789';
      const eventPromise = waitForEvent<AgentEvent>(client, `run:${runId}`);

      const testEvent: AgentEvent = {
        type: 'agent.tool_result',
        toolId: 'call-123',
        output: { results: ['Result 1', 'Result 2'] },
        success: true,
      };
      socketServer.emitToRun(testUserId, runId, testEvent);

      const received = await eventPromise;
      expect(received).toEqual(testEvent);
    });

    it('should emit error events correctly', async () => {
      const client = createClient();
      await waitForConnect(client);

      const runId = 'test-run-error';
      const eventPromise = waitForEvent<AgentEvent>(client, `run:${runId}`);

      const testEvent: AgentEvent = {
        type: 'agent.error',
        message: 'Something went wrong',
        code: 'TOOL_ERROR',
      };
      socketServer.emitToRun(testUserId, runId, testEvent);

      const received = await eventPromise;
      expect(received).toEqual(testEvent);
    });
  });

  // ===========================================================================
  // Run Subscription Tests
  // ===========================================================================

  describe('Run Subscription', () => {
    it('should allow subscribing to specific runs', async () => {
      const client = createClient();
      await waitForConnect(client);

      const runId = 'subscribe-test-run';

      // Subscribe to the run
      client.emit('subscribe:run', runId);

      // Give time for subscription
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Events should be received
      const eventPromise = waitForEvent<AgentEvent>(client, `run:${runId}`);

      socketServer.emitToRun(testUserId, runId, {
        type: 'agent.token',
        token: 'Subscribed!',
      });

      const received = await eventPromise;
      expect(received.type).toBe('agent.token');
    });
  });

  // ===========================================================================
  // Isolation Tests
  // ===========================================================================

  describe('User Isolation', () => {
    it('should not deliver events to other users', async () => {
      // Create another user
      const otherEmail = `ws-test-other-${Date.now()}@example.com`;
      const otherResult = await authService.register(otherEmail, 'password123', 'Other User');

      const myClient = createClient();
      const otherClient = createClient(otherResult.tokens.accessToken);

      await Promise.all([waitForConnect(myClient), waitForConnect(otherClient)]);

      // Set up event listeners
      let otherReceivedEvent = false;
      otherClient.on('agent:event', () => {
        otherReceivedEvent = true;
      });

      const myEventPromise = waitForEvent<AgentEvent>(myClient, 'agent:event');

      // Emit to my user only
      socketServer.emitToUser(testUserId, {
        type: 'agent.token',
        token: 'Private message',
      });

      // Wait for my event
      await myEventPromise;

      // Give time for potential incorrect delivery
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Other user should not have received the event
      expect(otherReceivedEvent).toBe(false);

      // Clean up other user
      await db.delete(users).where(sql`email = ${otherEmail}`);
    });
  });

  // ===========================================================================
  // Server Lifecycle Tests
  // ===========================================================================

  describe('Server Lifecycle', () => {
    it('should return correct connection counts', async () => {
      expect(socketServer.getConnectionCount()).toBe(0);
      expect(socketServer.getConnectedUserCount()).toBe(0);

      const client = createClient();
      await waitForConnect(client);

      expect(socketServer.getConnectionCount()).toBe(1);
      expect(socketServer.getConnectedUserCount()).toBe(1);
    });

    it('should expose Socket.io server instance', () => {
      const io = socketServer.getIO();
      expect(io).toBeDefined();
    });
  });
});
