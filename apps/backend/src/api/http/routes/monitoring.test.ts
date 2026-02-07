// =============================================================================
// Monitoring Agent Routes - Integration Tests
// =============================================================================
// Tests for monitoring agent API endpoints including webhooks, triggers,
// events, and priority contacts.

import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { app } from '../router.js';
import { db, queryClient } from '../../../infrastructure/db/client.js';
import {
  users,
  triggerSubscriptions,
  monitoredEvents,
  slackPriorityContacts,
  pushTokens,
} from '../../../infrastructure/db/schema.js';

// Import and mount monitoring routes for testing
import { createWebhookRoutes } from './webhooks.js';
import { createMonitoringRoutes } from './monitoring.js';
import { createOrchestratorService } from './orchestrator.js';
import { MonitoringAgentService } from '../../../application/services/MonitoringAgentService.js';
import { TriggerReplyService } from '../../../application/services/TriggerReplyService.js';
import { PushNotificationService } from '../../../application/services/PushNotificationService.js';
import { TriggerSubscriptionRepository } from '../../../adapters/storage/trigger-subscription-repository.js';
import { MonitoredEventRepository } from '../../../adapters/storage/monitored-event-repository.js';
import { SlackPriorityContactRepository } from '../../../adapters/storage/slack-priority-contact-repository.js';
import { PushTokenRepository } from '../../../adapters/storage/push-token-repository.js';

// Create a mock socket server for testing
const mockSocketServer = {
  emitToUser: () => {},
} as any;

// Initialize test dependencies
const triggerSubRepo = new TriggerSubscriptionRepository();
const eventRepo = new MonitoredEventRepository();
const priorityContactRepo = new SlackPriorityContactRepository();
const pushTokenRepo = new PushTokenRepository();
const replyService = new TriggerReplyService();
const pushService = new PushNotificationService(pushTokenRepo, { enabled: false });

const monitoringService = new MonitoringAgentService(
  triggerSubRepo,
  eventRepo,
  priorityContactRepo,
  replyService,
  pushService,
  mockSocketServer,
  createOrchestratorService,
  null, // No composio service in tests
  { webhookUrl: 'http://localhost:3000/api/v1/webhooks/composio' }
);

// Mount routes for testing
const webhookRoutes = createWebhookRoutes({ monitoringService });
const monitoringRoutes = createMonitoringRoutes({ monitoringService, pushService });
app.route('/api/v1/webhooks', webhookRoutes);
app.route('/api/v1/monitoring', monitoringRoutes);

// =============================================================================
// Test Fixtures
// =============================================================================

interface TestUser {
  id: string;
  email: string;
  accessToken: string;
}

// Create a test user and get auth tokens
async function createTestUser(suffix: string): Promise<TestUser> {
  const email = `test-monitoring-${suffix}-${Date.now()}@example.com`;
  
  const res = await app.request('/api/v1/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password: 'password123',
      displayName: `Test Monitoring User ${suffix}`,
    }),
  });

  const body = await res.json() as {
    data: {
      user: { id: string; email: string };
      tokens: { accessToken: string };
    };
  };

  return {
    id: body.data.user.id,
    email: body.data.user.email,
    accessToken: body.data.tokens.accessToken,
  };
}

// Sample Composio webhook payloads
const sampleGitHubIssuePayload = {
  type: 'GITHUB_ISSUE_ASSIGNED_EVENT',
  data: {
    issue: {
      number: 123,
      title: 'Fix authentication bug',
      body: 'Users are experiencing intermittent logout issues.',
      html_url: 'https://github.com/test/repo/issues/123',
    },
    sender: { login: 'testuser' },
    repository: { full_name: 'test/repo' },
  },
  timestamp: new Date().toISOString(),
  log_id: 'test-log-123',
};

const sampleSlackMessagePayload = {
  type: 'SLACK_RECEIVE_DIRECT_MESSAGE',
  data: {
    user: 'U12345678',
    user_name: 'john.doe',
    text: 'Hey can you fix the login page?',
    channel: 'D12345678',
    channel_name: 'direct-message',
    ts: '1234567890.123456',
  },
  timestamp: new Date().toISOString(),
  log_id: 'test-log-456',
};

// =============================================================================
// Tests
// =============================================================================

describe('Monitoring Agent Routes Integration', () => {
  let testUser: TestUser;
  const createdUserIds: string[] = [];
  const createdTriggerIds: string[] = [];
  const createdEventIds: string[] = [];

  beforeAll(async () => {
    // Create main test user
    testUser = await createTestUser('main');
    createdUserIds.push(testUser.id);
  });

  afterAll(async () => {
    // Cleanup in correct order (foreign key constraints)
    for (const userId of createdUserIds) {
      await db.delete(monitoredEvents).where(sql`user_id = ${userId}`);
      await db.delete(triggerSubscriptions).where(sql`user_id = ${userId}`);
      await db.delete(slackPriorityContacts).where(sql`user_id = ${userId}`);
      await db.delete(pushTokens).where(sql`user_id = ${userId}`);
      await db.delete(users).where(sql`id = ${userId}`);
    }
    await queryClient.end();
  });

  // Helper for authenticated requests
  const authRequest = (path: string, options: RequestInit = {}) => {
    return app.request(path, {
      ...options,
      headers: {
        ...options.headers,
        Authorization: `Bearer ${testUser.accessToken}`,
      },
    });
  };

  // ===========================================================================
  // GET /api/v1/monitoring/triggers/available
  // ===========================================================================

  describe('GET /api/v1/monitoring/available-triggers', () => {
    it('should return list of available trigger types', async () => {
      const res = await authRequest('/api/v1/monitoring/available-triggers');
      
      expect(res.status).toBe(200);
      
      const body = await res.json() as { triggers: Array<{ type: string; name: string }> };
      expect(body.triggers).toBeDefined();
      expect(Array.isArray(body.triggers)).toBe(true);
      expect(body.triggers.length).toBeGreaterThan(0);
      
      // Check for expected GitHub trigger types
      const triggerTypes = body.triggers.map((t: { type: string }) => t.type);
      expect(triggerTypes).toContain('GITHUB_ISSUE_ASSIGNED_EVENT');
      expect(triggerTypes).toContain('GITHUB_PULL_REQUEST_REVIEW_REQUESTED_EVENT');
      expect(triggerTypes).toContain('SLACK_RECEIVE_MESSAGE');
    });

    it('should require authentication', async () => {
      const res = await app.request('/api/v1/monitoring/available-triggers');
      expect(res.status).toBe(401);
    });
  });

  // ===========================================================================
  // Trigger Subscription Management
  // ===========================================================================

  describe('Trigger Subscriptions', () => {
    afterEach(async () => {
      // Clean up created triggers
      for (const triggerId of createdTriggerIds) {
        await db.delete(triggerSubscriptions).where(sql`id = ${triggerId}`);
      }
      createdTriggerIds.length = 0;
    });

    describe('POST /api/v1/monitoring/triggers', () => {
      it('should create a new trigger subscription', async () => {
        const res = await authRequest('/api/v1/monitoring/triggers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            triggerType: 'GITHUB_ISSUE_ASSIGNED_EVENT',
            autoStart: true,
            config: {},
          }),
        });

        expect(res.status).toBe(201);
        
        const body = await res.json() as {
          subscription: {
            id: string;
            triggerType: string;
            autoStart: boolean;
            enabled: boolean;
          };
        };
        expect(body.subscription).toBeDefined();
        expect(body.subscription.triggerType).toBe('GITHUB_ISSUE_ASSIGNED_EVENT');
        expect(body.subscription.autoStart).toBe(true);
        expect(body.subscription.enabled).toBe(true);
        
        createdTriggerIds.push(body.subscription.id);
      });

      it('should reject duplicate trigger type', async () => {
        // Create first subscription
        const res1 = await authRequest('/api/v1/monitoring/triggers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            triggerType: 'GITHUB_PULL_REQUEST_COMMENT_EVENT',
            autoStart: false,
          }),
        });
        
        const body1 = await res1.json() as { subscription: { id: string } };
        createdTriggerIds.push(body1.subscription.id);

        // Try to create duplicate
        const res2 = await authRequest('/api/v1/monitoring/triggers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            triggerType: 'GITHUB_PULL_REQUEST_COMMENT_EVENT',
            autoStart: true,
          }),
        });

        expect(res2.status).toBe(409);
      });

      it('should reject invalid trigger type', async () => {
        const res = await authRequest('/api/v1/monitoring/triggers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            triggerType: 'INVALID_TRIGGER_TYPE',
            autoStart: true,
          }),
        });

        expect(res.status).toBe(400);
      });
    });

    describe('GET /api/v1/monitoring/triggers', () => {
      it('should list user trigger subscriptions', async () => {
        // Create a subscription first
        const createRes = await authRequest('/api/v1/monitoring/triggers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            triggerType: 'GITHUB_MENTION_EVENT',
            autoStart: true,
          }),
        });
        const createBody = await createRes.json() as { subscription: { id: string } };
        createdTriggerIds.push(createBody.subscription.id);

        // List subscriptions
        const res = await authRequest('/api/v1/monitoring/triggers');
        
        expect(res.status).toBe(200);
        
        const body = await res.json() as { subscriptions: Array<{ id: string; triggerType: string }> };
        expect(body.subscriptions).toBeDefined();
        expect(Array.isArray(body.subscriptions)).toBe(true);
        expect(body.subscriptions.some((s: { triggerType: string }) => s.triggerType === 'GITHUB_MENTION_EVENT')).toBe(true);
      });
    });

    describe('PUT /api/v1/monitoring/triggers/:id', () => {
      it('should update a trigger subscription', async () => {
        // Create subscription
        const createRes = await authRequest('/api/v1/monitoring/triggers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            triggerType: 'GITHUB_ISSUE_COMMENT_EVENT',
            autoStart: false,
          }),
        });
        const createBody = await createRes.json() as { subscription: { id: string } };
        createdTriggerIds.push(createBody.subscription.id);

        // Update subscription
        const res = await authRequest(`/api/v1/monitoring/triggers/${createBody.subscription.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            autoStart: true,
            enabled: false,
          }),
        });

        expect(res.status).toBe(200);
        
        const body = await res.json() as { subscription: { autoStart: boolean; enabled: boolean } };
        expect(body.subscription.autoStart).toBe(true);
        expect(body.subscription.enabled).toBe(false);
      });
    });

    describe('DELETE /api/v1/monitoring/triggers/:id', () => {
      it('should delete a trigger subscription', async () => {
        // Create subscription
        const createRes = await authRequest('/api/v1/monitoring/triggers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            triggerType: 'SLACK_RECEIVE_MESSAGE',
            autoStart: false,
          }),
        });
        const createBody = await createRes.json() as { subscription: { id: string } };

        // Delete subscription
        const res = await authRequest(`/api/v1/monitoring/triggers/${createBody.subscription.id}`, {
          method: 'DELETE',
        });

        expect(res.status).toBe(200);

        // Verify it's deleted
        const listRes = await authRequest('/api/v1/monitoring/triggers');
        const listBody = await listRes.json() as { subscriptions: Array<{ id: string }> };
        expect(listBody.subscriptions.some((s: { id: string }) => s.id === createBody.subscription.id)).toBe(false);
      });
    });
  });

  // ===========================================================================
  // Webhook Processing
  // ===========================================================================

  describe('POST /api/v1/webhooks/composio', () => {
    let triggerId: string;
    let subscriptionId: string;

    beforeEach(async () => {
      // Create a trigger subscription for the test user
      const res = await authRequest('/api/v1/monitoring/triggers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          triggerType: 'GITHUB_ISSUE_ASSIGNED_EVENT',
          autoStart: false, // Use false so we can test approval
        }),
      });
      const body = await res.json() as { subscription: { id: string; triggerId: string } };
      subscriptionId = body.subscription.id;
      triggerId = body.subscription.triggerId;
    });

    afterEach(async () => {
      // Cleanup
      await db.delete(monitoredEvents).where(sql`subscription_id = ${subscriptionId}`);
      await db.delete(triggerSubscriptions).where(sql`id = ${subscriptionId}`);
    });

    it('should accept valid webhook payload', async () => {
      const payload = {
        ...sampleGitHubIssuePayload,
        trigger_id: triggerId,
      };

      const res = await app.request('/api/v1/webhooks/composio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      expect(res.status).toBe(202);
      
      const body = await res.json() as { status: string; requestId: string };
      expect(body.status).toBe('accepted');
      expect(body.requestId).toBeDefined();
    });

    it('should create a monitored event from webhook', async () => {
      const payload = {
        ...sampleGitHubIssuePayload,
        trigger_id: triggerId,
      };

      await app.request('/api/v1/webhooks/composio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      // Wait a bit for async processing
      await new Promise((r) => setTimeout(r, 500));

      // Check that event was created
      const events = await db
        .select()
        .from(monitoredEvents)
        .where(sql`subscription_id = ${subscriptionId}`);

      expect(events.length).toBeGreaterThan(0);
      expect(events[0].triggerType).toBe('GITHUB_ISSUE_ASSIGNED_EVENT');
      expect(events[0].status).toBe('pending');
      expect(events[0].requiresApproval).toBe(true);
    });

    it('should reject invalid payload', async () => {
      const res = await app.request('/api/v1/webhooks/composio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invalid: 'payload' }),
      });

      expect(res.status).toBe(400);
    });
  });

  // ===========================================================================
  // Event Management
  // ===========================================================================

  describe('Event Management', () => {
    let subscriptionId: string;
    let triggerId: string;

    beforeEach(async () => {
      // Create a trigger subscription
      const res = await authRequest('/api/v1/monitoring/triggers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          triggerType: 'GITHUB_PULL_REQUEST_REVIEW_REQUESTED_EVENT',
          autoStart: false,
        }),
      });
      const body = await res.json() as { subscription: { id: string; triggerId: string } };
      subscriptionId = body.subscription.id;
      triggerId = body.subscription.triggerId;
    });

    afterEach(async () => {
      await db.delete(monitoredEvents).where(sql`subscription_id = ${subscriptionId}`);
      await db.delete(triggerSubscriptions).where(sql`id = ${subscriptionId}`);
    });

    describe('GET /api/v1/monitoring/events', () => {
      it('should list user events', async () => {
        // Create an event via webhook
        await app.request('/api/v1/webhooks/composio', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'GITHUB_PULL_REQUEST_REVIEW_REQUESTED_EVENT',
            data: {
              pull_request: {
                number: 42,
                title: 'Test PR',
                body: 'Test description',
                html_url: 'https://github.com/test/repo/pull/42',
              },
              sender: { login: 'reviewer' },
              repository: { full_name: 'test/repo' },
            },
            timestamp: new Date().toISOString(),
            log_id: 'test-log-789',
            trigger_id: triggerId,
          }),
        });

        await new Promise((r) => setTimeout(r, 500));

        // List events
        const res = await authRequest('/api/v1/monitoring/events');
        
        expect(res.status).toBe(200);
        
        const body = await res.json() as { events: Array<{ id: string; triggerType: string }> };
        expect(body.events).toBeDefined();
        expect(Array.isArray(body.events)).toBe(true);
      });

      it('should filter events by status', async () => {
        const res = await authRequest('/api/v1/monitoring/events?status=pending');
        
        expect(res.status).toBe(200);
        
        const body = await res.json() as { events: Array<{ status: string }> };
        // All returned events should be pending
        for (const event of body.events) {
          expect(event.status).toBe('pending');
        }
      });
    });

    describe('POST /api/v1/monitoring/events/:id/approve', () => {
      it('should approve a pending event', async () => {
        // Create an event via webhook
        await app.request('/api/v1/webhooks/composio', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'GITHUB_PULL_REQUEST_REVIEW_REQUESTED_EVENT',
            data: {
              pull_request: {
                number: 43,
                title: 'Another Test PR',
                body: 'Test description',
                html_url: 'https://github.com/test/repo/pull/43',
              },
              sender: { login: 'reviewer2' },
              repository: { full_name: 'test/repo' },
            },
            timestamp: new Date().toISOString(),
            log_id: 'test-log-approve',
            trigger_id: triggerId,
          }),
        });

        await new Promise((r) => setTimeout(r, 500));

        // Get the event
        const events = await db
          .select()
          .from(monitoredEvents)
          .where(sql`subscription_id = ${subscriptionId}`);

        expect(events.length).toBeGreaterThan(0);
        const eventId = events[0].id;

        // Approve the event
        const res = await authRequest(`/api/v1/monitoring/events/${eventId}/approve`, {
          method: 'POST',
        });

        expect(res.status).toBe(200);
        
        const body = await res.json() as { orchestratorRunId: string };
        expect(body.orchestratorRunId).toBeDefined();

        // Verify event status changed
        const updatedEvents = await db
          .select()
          .from(monitoredEvents)
          .where(sql`id = ${eventId}`);
        
        expect(updatedEvents[0].status).toBe('in_progress');
      });
    });

    describe('POST /api/v1/monitoring/events/:id/reject', () => {
      it('should reject a pending event', async () => {
        // Create an event via webhook
        await app.request('/api/v1/webhooks/composio', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'GITHUB_PULL_REQUEST_REVIEW_REQUESTED_EVENT',
            data: {
              pull_request: {
                number: 44,
                title: 'PR to Reject',
                body: 'Test description',
                html_url: 'https://github.com/test/repo/pull/44',
              },
              sender: { login: 'reviewer3' },
              repository: { full_name: 'test/repo' },
            },
            timestamp: new Date().toISOString(),
            log_id: 'test-log-reject',
            trigger_id: triggerId,
          }),
        });

        await new Promise((r) => setTimeout(r, 500));

        // Get the event
        const events = await db
          .select()
          .from(monitoredEvents)
          .where(sql`subscription_id = ${subscriptionId} AND status = 'pending'`);

        expect(events.length).toBeGreaterThan(0);
        const eventId = events[0].id;

        // Reject the event
        const res = await authRequest(`/api/v1/monitoring/events/${eventId}/reject`, {
          method: 'POST',
        });

        expect(res.status).toBe(200);

        // Verify event status changed
        const updatedEvents = await db
          .select()
          .from(monitoredEvents)
          .where(sql`id = ${eventId}`);
        
        expect(updatedEvents[0].status).toBe('rejected');
      });
    });
  });

  // ===========================================================================
  // Priority Contacts
  // ===========================================================================

  describe('Priority Contacts', () => {
    afterEach(async () => {
      await db.delete(slackPriorityContacts).where(sql`user_id = ${testUser.id}`);
    });

    describe('POST /api/v1/monitoring/priority-contacts', () => {
      it('should add a priority contact', async () => {
        const res = await authRequest('/api/v1/monitoring/priority-contacts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            slackUserId: 'U12345678',
            slackUserName: 'john.doe',
            priority: 'high',
            autoStart: true,
          }),
        });

        expect(res.status).toBe(201);
        
        const body = await res.json() as {
          contact: {
            id: string;
            slackUserId: string;
            priority: string;
            autoStart: boolean;
          };
        };
        expect(body.contact).toBeDefined();
        expect(body.contact.slackUserId).toBe('U12345678');
        expect(body.contact.priority).toBe('high');
        expect(body.contact.autoStart).toBe(true);
      });

      it('should reject duplicate contact', async () => {
        // Add first contact
        await authRequest('/api/v1/monitoring/priority-contacts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            slackUserId: 'U87654321',
            priority: 'normal',
          }),
        });

        // Try to add duplicate
        const res = await authRequest('/api/v1/monitoring/priority-contacts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            slackUserId: 'U87654321',
            priority: 'high',
          }),
        });

        expect(res.status).toBe(409);
      });
    });

    describe('GET /api/v1/monitoring/priority-contacts', () => {
      it('should list priority contacts', async () => {
        // Add a contact
        await authRequest('/api/v1/monitoring/priority-contacts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            slackUserId: 'U11111111',
            slackUserName: 'jane.doe',
            priority: 'high',
          }),
        });

        // List contacts
        const res = await authRequest('/api/v1/monitoring/priority-contacts');
        
        expect(res.status).toBe(200);
        
        const body = await res.json() as { contacts: Array<{ slackUserId: string }> };
        expect(body.contacts).toBeDefined();
        expect(Array.isArray(body.contacts)).toBe(true);
        expect(body.contacts.some((c: { slackUserId: string }) => c.slackUserId === 'U11111111')).toBe(true);
      });
    });

    describe('DELETE /api/v1/monitoring/priority-contacts/:id', () => {
      it('should delete a priority contact', async () => {
        // Add a contact
        const createRes = await authRequest('/api/v1/monitoring/priority-contacts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            slackUserId: 'U22222222',
            priority: 'normal',
          }),
        });
        const createBody = await createRes.json() as { contact: { id: string } };

        // Delete contact
        const res = await authRequest(`/api/v1/monitoring/priority-contacts/${createBody.contact.id}`, {
          method: 'DELETE',
        });

        expect(res.status).toBe(200);

        // Verify deleted
        const listRes = await authRequest('/api/v1/monitoring/priority-contacts');
        const listBody = await listRes.json() as { contacts: Array<{ id: string }> };
        expect(listBody.contacts.some((c: { id: string }) => c.id === createBody.contact.id)).toBe(false);
      });
    });
  });

  // ===========================================================================
  // Push Token Management
  // ===========================================================================

  describe('Push Token Management', () => {
    afterEach(async () => {
      await db.delete(pushTokens).where(sql`user_id = ${testUser.id}`);
    });

    describe('POST /api/v1/monitoring/push-tokens', () => {
      it('should register a push token', async () => {
        const res = await authRequest('/api/v1/monitoring/push-tokens', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token: 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]',
            platform: 'ios',
          }),
        });

        expect(res.status).toBe(201);
        
        const body = await res.json() as { success: boolean };
        expect(body.success).toBe(true);
      });

      it('should reject invalid token format', async () => {
        const res = await authRequest('/api/v1/monitoring/push-tokens', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token: 'invalid-token',
            platform: 'android',
          }),
        });

        expect(res.status).toBe(400);
      });
    });

    describe('DELETE /api/v1/monitoring/push-tokens/:token', () => {
      it('should remove a push token', async () => {
        const token = 'ExponentPushToken[yyyyyyyyyyyyyyyyyyyyyy]';
        
        // Register first
        await authRequest('/api/v1/monitoring/push-tokens', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token,
            platform: 'android',
          }),
        });

        // Remove (URL encode the token)
        const res = await authRequest(`/api/v1/monitoring/push-tokens/${encodeURIComponent(token)}`, {
          method: 'DELETE',
        });

        expect(res.status).toBe(200);
      });
    });
  });
});
