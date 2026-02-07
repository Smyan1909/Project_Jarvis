// =============================================================================
// Monitoring API Routes
// =============================================================================
// REST API routes for managing monitoring agent configuration and events.
// All routes require authentication.

import { Hono } from 'hono';
import { z } from 'zod';
import { authMiddleware, type AuthVariables } from '../middleware/auth.js';
import { logger } from '../../../infrastructure/logging/logger.js';
import type { MonitoringAgentService } from '../../../application/services/MonitoringAgentService.js';
import type { PushNotificationService } from '../../../application/services/PushNotificationService.js';
import {
  TriggerConfigInputSchema,
  TriggerConfigUpdateSchema,
  PriorityContactInputSchema,
  PushTokenInputSchema,
  MonitoredEventStatusSchema,
} from '@project-jarvis/shared-types';

// =============================================================================
// Types
// =============================================================================

/**
 * Dependencies for monitoring routes
 */
export interface MonitoringRouteDependencies {
  monitoringService: MonitoringAgentService;
  pushService: PushNotificationService;
}

/**
 * Hono app with auth variables
 */
type MonitoringApp = Hono<{ Variables: AuthVariables }>;

// =============================================================================
// Routes
// =============================================================================

/**
 * Create monitoring API routes
 */
export function createMonitoringRoutes(deps: MonitoringRouteDependencies): MonitoringApp {
  const monitoringRoutes = new Hono<{ Variables: AuthVariables }>();
  const log = logger.child({ route: 'monitoring' });

  // All routes require authentication
  monitoringRoutes.use('*', authMiddleware);

  // ===========================================================================
  // Trigger Subscriptions
  // ===========================================================================

  /**
   * GET /monitoring/triggers
   * 
   * List all trigger subscriptions for the authenticated user.
   */
  monitoringRoutes.get('/triggers', async (c) => {
    const userId = c.get('userId');
    
    try {
      const subscriptions = await deps.monitoringService.listTriggerSubscriptions(userId);
      return c.json({ subscriptions });
    } catch (error) {
      log.error('Failed to list trigger subscriptions', error, { userId });
      return c.json({ error: 'Failed to list subscriptions' }, 500);
    }
  });

  /**
   * POST /monitoring/triggers
   * 
   * Create a new trigger subscription.
   */
  monitoringRoutes.post('/triggers', async (c) => {
    const userId = c.get('userId');
    
    try {
      const body = await c.req.json();
      const input = TriggerConfigInputSchema.parse(body);
      
      const subscription = await deps.monitoringService.createTriggerSubscription(userId, input);
      return c.json({ subscription }, 201);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return c.json({ error: 'Invalid request', details: error.errors }, 400);
      }
      if (error instanceof Error && error.message.includes('already exists')) {
        return c.json({ error: error.message }, 409);
      }
      log.error('Failed to create trigger subscription', error, { userId });
      return c.json({ error: 'Failed to create subscription' }, 500);
    }
  });

  /**
   * PUT /monitoring/triggers/:id
   * 
   * Update a trigger subscription.
   */
  monitoringRoutes.put('/triggers/:id', async (c) => {
    const userId = c.get('userId');
    const { id } = c.req.param();
    
    try {
      const body = await c.req.json();
      const updates = TriggerConfigUpdateSchema.parse(body);
      
      const subscription = await deps.monitoringService.updateTriggerSubscription(id, userId, updates);
      return c.json({ subscription });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return c.json({ error: 'Invalid request', details: error.errors }, 400);
      }
      if (error instanceof Error && error.message.includes('not found')) {
        return c.json({ error: 'Subscription not found' }, 404);
      }
      if (error instanceof Error && error.message.includes('Not authorized')) {
        return c.json({ error: 'Not authorized' }, 403);
      }
      log.error('Failed to update trigger subscription', error, { userId, id });
      return c.json({ error: 'Failed to update subscription' }, 500);
    }
  });

  /**
   * DELETE /monitoring/triggers/:id
   * 
   * Delete a trigger subscription.
   */
  monitoringRoutes.delete('/triggers/:id', async (c) => {
    const userId = c.get('userId');
    const { id } = c.req.param();
    
    try {
      await deps.monitoringService.deleteTriggerSubscription(id, userId);
      return c.json({ success: true });
    } catch (error) {
      if (error instanceof Error && error.message.includes('not found')) {
        return c.json({ error: 'Subscription not found' }, 404);
      }
      if (error instanceof Error && error.message.includes('Not authorized')) {
        return c.json({ error: 'Not authorized' }, 403);
      }
      log.error('Failed to delete trigger subscription', error, { userId, id });
      return c.json({ error: 'Failed to delete subscription' }, 500);
    }
  });

  /**
   * GET /monitoring/available-triggers
   * 
   * Get list of available trigger types.
   */
  monitoringRoutes.get('/available-triggers', (c) => {
    const triggers = deps.monitoringService.getAvailableTriggerTypes();
    return c.json({ triggers });
  });

  /**
   * POST /monitoring/triggers/setup-github
   * 
   * Set up default GitHub triggers for the user.
   * Call this after user connects their GitHub account.
   */
  monitoringRoutes.post('/triggers/setup-github', async (c) => {
    const userId = c.get('userId');
    
    try {
      const subscriptions = await deps.monitoringService.setupDefaultGitHubTriggers(userId);
      return c.json({ 
        success: true,
        subscriptions,
        count: subscriptions.length,
      });
    } catch (error) {
      log.error('Failed to setup GitHub triggers', error, { userId });
      return c.json({ error: 'Failed to setup triggers' }, 500);
    }
  });

  // ===========================================================================
  // Priority Contacts
  // ===========================================================================

  /**
   * GET /monitoring/priority-contacts
   * 
   * List all priority contacts for the authenticated user.
   */
  monitoringRoutes.get('/priority-contacts', async (c) => {
    const userId = c.get('userId');
    
    try {
      const contacts = await deps.monitoringService.listPriorityContacts(userId);
      return c.json({ contacts });
    } catch (error) {
      log.error('Failed to list priority contacts', error, { userId });
      return c.json({ error: 'Failed to list contacts' }, 500);
    }
  });

  /**
   * POST /monitoring/priority-contacts
   * 
   * Add a new priority contact.
   */
  monitoringRoutes.post('/priority-contacts', async (c) => {
    const userId = c.get('userId');
    
    try {
      const body = await c.req.json();
      const input = PriorityContactInputSchema.parse(body);
      
      const contact = await deps.monitoringService.addPriorityContact(userId, input);
      return c.json({ contact }, 201);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return c.json({ error: 'Invalid request', details: error.errors }, 400);
      }
      if (error instanceof Error && error.message.includes('already exists')) {
        return c.json({ error: error.message }, 409);
      }
      log.error('Failed to add priority contact', error, { userId });
      return c.json({ error: 'Failed to add contact' }, 500);
    }
  });

  /**
   * DELETE /monitoring/priority-contacts/:id
   * 
   * Remove a priority contact.
   */
  monitoringRoutes.delete('/priority-contacts/:id', async (c) => {
    const userId = c.get('userId');
    const { id } = c.req.param();
    
    try {
      await deps.monitoringService.removePriorityContact(id, userId);
      return c.json({ success: true });
    } catch (error) {
      if (error instanceof Error && error.message.includes('not found')) {
        return c.json({ error: 'Contact not found' }, 404);
      }
      log.error('Failed to remove priority contact', error, { userId, id });
      return c.json({ error: 'Failed to remove contact' }, 500);
    }
  });

  // ===========================================================================
  // Events
  // ===========================================================================

  /**
   * GET /monitoring/events
   * 
   * Get event history for the authenticated user.
   * 
   * Query parameters:
   * - limit: number (default: 50)
   * - offset: number (default: 0)
   * - status: MonitoredEventStatus (optional)
   */
  monitoringRoutes.get('/events', async (c) => {
    const userId = c.get('userId');
    const { limit, offset, status } = c.req.query();
    
    try {
      // Validate status if provided
      let validatedStatus: string | undefined;
      if (status) {
        const statusResult = MonitoredEventStatusSchema.safeParse(status);
        if (!statusResult.success) {
          return c.json({ error: 'Invalid status parameter' }, 400);
        }
        validatedStatus = statusResult.data;
      }

      const events = await deps.monitoringService.getEventHistory(userId, {
        limit: limit ? parseInt(limit, 10) : 50,
        offset: offset ? parseInt(offset, 10) : 0,
        status: validatedStatus as any,
      });
      
      return c.json({ events });
    } catch (error) {
      log.error('Failed to get event history', error, { userId });
      return c.json({ error: 'Failed to get events' }, 500);
    }
  });

  /**
   * POST /monitoring/events/:id/approve
   * 
   * Approve a pending event and start processing.
   */
  monitoringRoutes.post('/events/:id/approve', async (c) => {
    const userId = c.get('userId');
    const { id } = c.req.param();
    
    try {
      const result = await deps.monitoringService.approveEvent(id, userId);
      return c.json(result);
    } catch (error) {
      if (error instanceof Error && error.message.includes('not found')) {
        return c.json({ error: 'Event not found' }, 404);
      }
      if (error instanceof Error && error.message.includes('Cannot approve')) {
        return c.json({ error: error.message }, 400);
      }
      log.error('Failed to approve event', error, { userId, id });
      return c.json({ error: 'Failed to approve event' }, 500);
    }
  });

  /**
   * POST /monitoring/events/:id/reject
   * 
   * Reject a pending event.
   */
  monitoringRoutes.post('/events/:id/reject', async (c) => {
    const userId = c.get('userId');
    const { id } = c.req.param();
    
    try {
      await deps.monitoringService.rejectEvent(id, userId);
      return c.json({ success: true });
    } catch (error) {
      if (error instanceof Error && error.message.includes('not found')) {
        return c.json({ error: 'Event not found' }, 404);
      }
      if (error instanceof Error && error.message.includes('Cannot reject')) {
        return c.json({ error: error.message }, 400);
      }
      log.error('Failed to reject event', error, { userId, id });
      return c.json({ error: 'Failed to reject event' }, 500);
    }
  });

  // ===========================================================================
  // Push Tokens
  // ===========================================================================

  /**
   * POST /monitoring/push-tokens
   * 
   * Register a push notification token.
   */
  monitoringRoutes.post('/push-tokens', async (c) => {
    const userId = c.get('userId');
    
    try {
      const body = await c.req.json();
      const input = PushTokenInputSchema.parse(body);
      
      await deps.pushService.registerToken(userId, input.token, input.platform);
      return c.json({ success: true }, 201);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return c.json({ error: 'Invalid request', details: error.errors }, 400);
      }
      if (error instanceof Error && error.message.includes('Invalid Expo')) {
        return c.json({ error: error.message }, 400);
      }
      log.error('Failed to register push token', error, { userId });
      return c.json({ error: 'Failed to register token' }, 500);
    }
  });

  /**
   * DELETE /monitoring/push-tokens/:token
   * 
   * Remove a push notification token.
   */
  monitoringRoutes.delete('/push-tokens/:token', async (c) => {
    const userId = c.get('userId');
    const { token } = c.req.param();
    
    try {
      await deps.pushService.removeToken(userId, decodeURIComponent(token));
      return c.json({ success: true });
    } catch (error) {
      log.error('Failed to remove push token', error, { userId });
      return c.json({ error: 'Failed to remove token' }, 500);
    }
  });

  return monitoringRoutes;
}

// =============================================================================
// Default Export
// =============================================================================

export default createMonitoringRoutes;
