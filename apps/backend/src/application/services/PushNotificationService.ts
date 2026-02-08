// =============================================================================
// Push Notification Service
// =============================================================================
// Sends push notifications to mobile devices using Expo's push notification service.

import * as ExpoModule from 'expo-server-sdk';
import { logger } from '../../infrastructure/logging/logger.js';
import type { PushTokenRepository } from '../../adapters/storage/push-token-repository.js';

// Handle ESM/CJS interop - expo-server-sdk is CJS
// At runtime the module has both .default and .Expo properties
const ExpoClass = (ExpoModule as any).default ?? (ExpoModule as any).Expo ?? ExpoModule;
const Expo = typeof ExpoClass === 'function' ? ExpoClass : ExpoClass.Expo;
type ExpoPushMessage = ExpoModule.ExpoPushMessage;
type ExpoPushReceipt = ExpoModule.ExpoPushReceipt;

// =============================================================================
// Types
// =============================================================================

/**
 * Push notification data to send
 */
export interface PushNotification {
  title: string;
  body: string;
  data?: Record<string, unknown>;
  badge?: number;
  sound?: 'default' | null;
  channelId?: string; // Android-specific
  priority?: 'default' | 'normal' | 'high';
}

/**
 * Result of sending a push notification
 */
export interface PushResult {
  success: boolean;
  ticketId?: string;
  error?: string;
}

/**
 * Configuration for the PushNotificationService
 */
export interface PushNotificationServiceConfig {
  /**
   * Whether to actually send push notifications
   * Set to false for development/testing
   * @default true
   */
  enabled?: boolean;
}

// =============================================================================
// Service
// =============================================================================

/**
 * Service for sending push notifications via Expo
 */
export class PushNotificationService {
  private expo: InstanceType<typeof Expo>;
  private enabled: boolean;
  private log = logger.child({ service: 'PushNotificationService' });

  constructor(
    private pushTokenRepo: PushTokenRepository,
    config: PushNotificationServiceConfig = {}
  ) {
    this.expo = new Expo();
    this.enabled = config.enabled ?? true;
  }

  // ===========================================================================
  // Public Methods
  // ===========================================================================

  /**
   * Send a push notification to all of a user's devices
   */
  async sendToUser(userId: string, notification: PushNotification): Promise<PushResult[]> {
    if (!this.enabled) {
      this.log.debug('Push notifications disabled, skipping', { userId });
      return [];
    }

    // Get all tokens for the user
    const tokens = await this.pushTokenRepo.findByUserId(userId);
    
    if (tokens.length === 0) {
      this.log.debug('No push tokens found for user', { userId });
      return [];
    }

    // Filter to valid Expo push tokens
    const validTokens = tokens.filter(t => Expo.isExpoPushToken(t.token));
    
    if (validTokens.length === 0) {
      this.log.warn('No valid Expo push tokens for user', { 
        userId, 
        totalTokens: tokens.length 
      });
      return [];
    }

    // Build messages
    const messages: ExpoPushMessage[] = validTokens.map(tokenRecord => ({
      to: tokenRecord.token,
      title: notification.title,
      body: notification.body,
      data: notification.data,
      badge: notification.badge,
      sound: notification.sound ?? 'default',
      channelId: notification.channelId,
      priority: notification.priority ?? 'high',
    }));

    // Send in chunks (Expo recommends max 100 per request)
    const chunks = this.expo.chunkPushNotifications(messages);
    const results: PushResult[] = [];

    for (const chunk of chunks) {
      try {
        const ticketChunk = await this.expo.sendPushNotificationsAsync(chunk);
        
        for (let i = 0; i < ticketChunk.length; i++) {
          const ticket = ticketChunk[i];
          const token = validTokens[i];
          
          if (ticket.status === 'ok') {
            results.push({
              success: true,
              ticketId: ticket.id,
            });
          } else {
            // Handle error
            const error = ticket.status === 'error' ? ticket.message : 'Unknown error';
            this.log.warn('Push notification failed', {
              userId,
              token: token.token.substring(0, 20) + '...',
              error,
            });
            
            // If token is invalid, remove it
            if (ticket.details?.error === 'DeviceNotRegistered') {
              await this.removeInvalidToken(userId, token.token);
            }
            
            results.push({
              success: false,
              error,
            });
          }
        }
      } catch (error) {
        this.log.error('Failed to send push notification chunk', error, { userId });
        results.push({
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    const successCount = results.filter(r => r.success).length;
    this.log.info('Push notifications sent', {
      userId,
      total: results.length,
      success: successCount,
      failed: results.length - successCount,
    });

    return results;
  }

  /**
   * Send a notification to multiple users
   */
  async sendToUsers(
    userIds: string[],
    notification: PushNotification
  ): Promise<Map<string, PushResult[]>> {
    const results = new Map<string, PushResult[]>();

    // Send in parallel but with some concurrency limit
    const CONCURRENCY = 10;
    
    for (let i = 0; i < userIds.length; i += CONCURRENCY) {
      const batch = userIds.slice(i, i + CONCURRENCY);
      const batchResults = await Promise.all(
        batch.map(async (userId) => ({
          userId,
          results: await this.sendToUser(userId, notification),
        }))
      );

      for (const { userId, results: userResults } of batchResults) {
        results.set(userId, userResults);
      }
    }

    return results;
  }

  /**
   * Register a push token for a user
   */
  async registerToken(
    userId: string,
    token: string,
    platform: 'ios' | 'android'
  ): Promise<void> {
    // Validate the token
    if (!Expo.isExpoPushToken(token)) {
      throw new Error(`Invalid Expo push token: ${token}`);
    }

    await this.pushTokenRepo.upsert({
      userId,
      token,
      platform,
    });

    this.log.info('Push token registered', {
      userId,
      platform,
      tokenPrefix: token.substring(0, 20) + '...',
    });
  }

  /**
   * Remove a push token for a user
   */
  async removeToken(userId: string, token: string): Promise<void> {
    const deleted = await this.pushTokenRepo.deleteByUserAndToken(userId, token);
    
    if (deleted) {
      this.log.info('Push token removed', {
        userId,
        tokenPrefix: token.substring(0, 20) + '...',
      });
    }
  }

  /**
   * Get push receipt for a ticket (for debugging)
   */
  async getReceipts(ticketIds: string[]): Promise<Record<string, ExpoPushReceipt>> {
    const receiptIdChunks = this.expo.chunkPushNotificationReceiptIds(ticketIds);
    const receipts: Record<string, ExpoPushReceipt> = {};

    for (const chunk of receiptIdChunks) {
      try {
        const chunkReceipts = await this.expo.getPushNotificationReceiptsAsync(chunk);
        Object.assign(receipts, chunkReceipts);
      } catch (error) {
        this.log.error('Failed to get push receipts', error);
      }
    }

    return receipts;
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  /**
   * Remove an invalid token from the database
   */
  private async removeInvalidToken(userId: string, token: string): Promise<void> {
    try {
      await this.pushTokenRepo.deleteByUserAndToken(userId, token);
      this.log.info('Removed invalid push token', {
        userId,
        tokenPrefix: token.substring(0, 20) + '...',
      });
    } catch (error) {
      this.log.error('Failed to remove invalid token', error, { userId });
    }
  }
}

// =============================================================================
// Notification Templates
// =============================================================================

/**
 * Pre-built notification templates for common monitoring events
 */
export const MonitoringNotificationTemplates = {
  /**
   * Notification for a new trigger event that requires approval
   */
  eventReceivedPendingApproval(data: {
    toolkit: 'GITHUB' | 'SLACK';
    title: string;
    summary: string;
    eventId: string;
  }): PushNotification {
    return {
      title: `${data.toolkit === 'GITHUB' ? 'GitHub' : 'Slack'}: Action Required`,
      body: `${data.title}\n${data.summary}`,
      data: {
        type: 'monitoring_event',
        eventId: data.eventId,
        action: 'pending_approval',
      },
      priority: 'high',
    };
  },

  /**
   * Notification for an auto-started task
   */
  eventAutoStarted(data: {
    toolkit: 'GITHUB' | 'SLACK';
    title: string;
    eventId: string;
    runId: string;
  }): PushNotification {
    return {
      title: `Jarvis: Auto-started Task`,
      body: `${data.toolkit === 'GITHUB' ? 'GitHub' : 'Slack'}: ${data.title}`,
      data: {
        type: 'monitoring_event',
        eventId: data.eventId,
        action: 'auto_started',
        orchestratorRunId: data.runId,
      },
      priority: 'default',
    };
  },

  /**
   * Notification for a completed task
   */
  taskCompleted(data: {
    title: string;
    eventId: string;
  }): PushNotification {
    return {
      title: 'Task Completed',
      body: data.title,
      data: {
        type: 'monitoring_event',
        eventId: data.eventId,
        action: 'completed',
      },
      priority: 'default',
    };
  },

  /**
   * Notification for a failed task
   */
  taskFailed(data: {
    title: string;
    eventId: string;
    error: string;
  }): PushNotification {
    return {
      title: 'Task Failed',
      body: `${data.title}: ${data.error}`,
      data: {
        type: 'monitoring_event',
        eventId: data.eventId,
        action: 'failed',
      },
      priority: 'high',
    };
  },
};
