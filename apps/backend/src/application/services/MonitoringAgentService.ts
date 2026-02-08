// =============================================================================
// Monitoring Agent Service
// =============================================================================
// Core service for the monitoring agent that listens for GitHub and Slack
// triggers, evaluates their importance, and initiates autonomous coding tasks.

import { v4 as uuidv4 } from 'uuid';
import { logger } from '../../infrastructure/logging/logger.js';
import type { TriggerSubscriptionRepository, CreateTriggerSubscriptionData } from '../../adapters/storage/trigger-subscription-repository.js';
import type { MonitoredEventRepository, CreateMonitoredEventData } from '../../adapters/storage/monitored-event-repository.js';
import type { SlackPriorityContactRepository } from '../../adapters/storage/slack-priority-contact-repository.js';
import type { TriggerReplyService, ReplyAction } from './TriggerReplyService.js';
import type { PushNotificationService } from './PushNotificationService.js';
import { MonitoringNotificationTemplates } from './PushNotificationService.js';
import type { SocketServer } from '../../api/ws/socket-server.js';
import type { OrchestratorService, OrchestratorRunResult } from './OrchestratorService.js';
import type { StreamEvent } from '@project-jarvis/shared-types';
import {
  ALL_GITHUB_TRIGGER_TYPES,
  TRIGGER_METADATA,
} from '@project-jarvis/shared-types';
import type {
  TriggerSubscription,
  TriggerConfigInput,
  TriggerConfigUpdate,
  MonitoredEvent,
  MonitoredEventStatus,
  SlackPriorityContact,
  PriorityContactInput,
  ParsedTriggerContext,
  ComposioTriggerPayload,
  TriggerType,
  GitHubTriggerType,
  SlackTriggerType,
  MonitoringToolkit,
  AvailableTriggerInfo,
  MonitoringEventReceived,
  MonitoringEventStatusChange,
} from '@project-jarvis/shared-types';

// =============================================================================
// Composio Service Interface
// =============================================================================

/**
 * Interface for Composio integration service
 * This allows the service to be optional and mockable
 */
export interface ComposioServiceInterface {
  executeTool(
    userId: string,
    toolSlug: string,
    args: Record<string, unknown>
  ): Promise<{ data: unknown; error: string | null; logId?: string }>;
}

// =============================================================================
// Types
// =============================================================================

/**
 * Options for querying event history
 */
export interface EventHistoryOptions {
  limit?: number;
  offset?: number;
  status?: MonitoredEventStatus;
}

/**
 * Result of evaluating a trigger
 */
interface TriggerEvaluation {
  shouldAutoStart: boolean;
  requiresApproval: boolean;
  reason: string;
}

/**
 * Factory function type for creating OrchestratorService instances
 * Each run needs its own orchestrator instance for proper event handling
 */
export type OrchestratorServiceFactory = (
  onEvent: (event: StreamEvent) => void
) => OrchestratorService;

/**
 * Configuration for the MonitoringAgentService
 */
export interface MonitoringAgentServiceConfig {
  /**
   * Composio webhook URL for setting up triggers
   */
  webhookUrl: string;
}

// =============================================================================
// Service
// =============================================================================

/**
 * Core service for the monitoring agent
 */
export class MonitoringAgentService {
  private log = logger.child({ service: 'MonitoringAgentService' });

  constructor(
    private triggerSubRepo: TriggerSubscriptionRepository,
    private eventRepo: MonitoredEventRepository,
    private priorityContactRepo: SlackPriorityContactRepository,
    private replyService: TriggerReplyService,
    private pushService: PushNotificationService,
    private socketServer: SocketServer,
    private createOrchestratorService: OrchestratorServiceFactory,
    private composioService: ComposioServiceInterface | null,
    private config: MonitoringAgentServiceConfig
  ) {}

  // ===========================================================================
  // Webhook Processing
  // ===========================================================================

  /**
   * Main entry point for Composio webhook payloads
   */
  async processWebhook(payload: ComposioTriggerPayload): Promise<void> {
    const log = this.log.child({ 
      method: 'processWebhook',
      triggerType: payload.type,
      logId: payload.log_id,
    });
    
    log.info('Processing webhook payload');

    try {
      // 1. Look up trigger subscription by triggerId
      const triggerId = payload.trigger_id;
      if (!triggerId) {
        log.warn('Webhook missing trigger_id, attempting to match by type');
        // This shouldn't happen in production, but handle gracefully
        return;
      }

      const subscription = await this.triggerSubRepo.findByTriggerId(triggerId);
      if (!subscription) {
        log.warn('No subscription found for trigger', { triggerId });
        return;
      }

      if (!subscription.enabled) {
        log.info('Subscription is disabled, ignoring', { triggerId });
        return;
      }

      const userId = subscription.userId;
      log.info('Found subscription for user', { userId, subscriptionId: subscription.id });

      // 2. Parse payload into ParsedTriggerContext
      const parsedContext = await this.parsePayload(
        subscription.toolkit,
        payload.type as TriggerType,
        payload.data
      );

      // 3. Evaluate trigger importance
      const evaluation = await this.evaluateTrigger(
        userId,
        subscription,
        parsedContext
      );
      log.info('Trigger evaluated', { 
        shouldAutoStart: evaluation.shouldAutoStart,
        requiresApproval: evaluation.requiresApproval,
        reason: evaluation.reason,
      });

      // 4. Create MonitoredEvent record
      const eventData: CreateMonitoredEventData = {
        userId,
        subscriptionId: subscription.id,
        triggerType: payload.type as TriggerType,
        toolkit: subscription.toolkit,
        payload: payload.data,
        parsedContext,
        requiresApproval: evaluation.requiresApproval,
        status: evaluation.shouldAutoStart ? 'auto_started' : 'pending',
      };
      const event = await this.eventRepo.create(eventData);
      log.info('Monitored event created', { eventId: event.id });

      // 5. Handle based on evaluation
      let orchestratorRunId: string | null = null;

      if (evaluation.shouldAutoStart) {
        // Start orchestrator run immediately
        orchestratorRunId = await this.startOrchestratorRun(userId, event, parsedContext);
        await this.eventRepo.update(event.id, { 
          orchestratorRunId: orchestratorRunId,
          status: 'in_progress',
        });
      }

      // 6. Generate and send reply to source platform
      const replyAction: ReplyAction = evaluation.shouldAutoStart ? 'auto_starting' : 'awaiting_approval';
      const replyContent = await this.replyService.generateReply({
        triggerType: event.triggerType,
        toolkit: event.toolkit,
        parsedContext,
        action: replyAction,
      });

      const sourceReplyId = await this.replyToSource(userId, event, replyContent);
      await this.eventRepo.update(event.id, { 
        sourceReplyId,
        sourceReplyContent: replyContent,
      });

      // 7. Notify user via WebSocket and push
      await this.notifyUser(userId, event, evaluation.shouldAutoStart, orchestratorRunId);

      // 8. Insert system message into conversation
      await this.insertConversationMessage(userId, event, orchestratorRunId);

      log.info('Webhook processing complete', { 
        eventId: event.id, 
        autoStarted: evaluation.shouldAutoStart,
        orchestratorRunId,
      });

    } catch (error) {
      log.error('Failed to process webhook', error);
      throw error;
    }
  }

  // ===========================================================================
  // Trigger Subscription Management
  // ===========================================================================

  /**
   * Create a new trigger subscription
   */
  async createTriggerSubscription(
    userId: string,
    input: TriggerConfigInput
  ): Promise<TriggerSubscription> {
    const log = this.log.child({ method: 'createTriggerSubscription', userId });

    // Check if subscription already exists for this trigger type
    const existing = await this.triggerSubRepo.findByUserAndType(userId, input.triggerType);
    if (existing) {
      throw new Error(`Subscription already exists for trigger type: ${input.triggerType}`);
    }

    // Get toolkit from trigger type
    const metadata = TRIGGER_METADATA[input.triggerType];
    const toolkit = metadata.toolkit;

    // Create trigger in Composio
    let triggerId: string;
    if (this.composioService) {
      // TODO: Implement Composio trigger creation
      // const trigger = await this.composioService.triggers.create(
      //   userId,
      //   input.triggerType,
      //   { triggerConfig: input.config }
      // );
      // triggerId = trigger.triggerId;
      triggerId = `trigger_${uuidv4()}`; // Placeholder until Composio integration
    } else {
      triggerId = `trigger_${uuidv4()}`; // Placeholder for testing
    }

    // Store subscription
    const subscriptionData: CreateTriggerSubscriptionData = {
      userId,
      triggerId,
      triggerType: input.triggerType,
      toolkit,
      config: input.config,
      autoStart: input.autoStart,
    };

    const subscription = await this.triggerSubRepo.create(subscriptionData);
    log.info('Trigger subscription created', { 
      subscriptionId: subscription.id,
      triggerType: input.triggerType,
    });

    return subscription;
  }

  /**
   * List all trigger subscriptions for a user
   */
  async listTriggerSubscriptions(userId: string): Promise<TriggerSubscription[]> {
    return this.triggerSubRepo.findByUserId(userId);
  }

  /**
   * Update a trigger subscription
   */
  async updateTriggerSubscription(
    id: string,
    userId: string,
    updates: TriggerConfigUpdate
  ): Promise<TriggerSubscription> {
    // Verify ownership
    const subscription = await this.triggerSubRepo.findById(id);
    if (!subscription) {
      throw new Error('Subscription not found');
    }
    if (subscription.userId !== userId) {
      throw new Error('Not authorized to update this subscription');
    }

    const updated = await this.triggerSubRepo.update(id, updates);
    if (!updated) {
      throw new Error('Failed to update subscription');
    }

    this.log.info('Trigger subscription updated', { subscriptionId: id, updates });
    return updated;
  }

  /**
   * Delete a trigger subscription
   */
  async deleteTriggerSubscription(id: string, userId: string): Promise<void> {
    // Verify ownership
    const subscription = await this.triggerSubRepo.findById(id);
    if (!subscription) {
      throw new Error('Subscription not found');
    }
    if (subscription.userId !== userId) {
      throw new Error('Not authorized to delete this subscription');
    }

    // Delete from Composio
    if (this.composioService) {
      // TODO: Implement Composio trigger deletion
      // await this.composioService.triggers.delete(subscription.triggerId);
    }

    await this.triggerSubRepo.delete(id);
    this.log.info('Trigger subscription deleted', { subscriptionId: id });
  }

  /**
   * Get list of available trigger types
   */
  getAvailableTriggerTypes(): AvailableTriggerInfo[] {
    return Object.entries(TRIGGER_METADATA).map(([type, metadata]) => ({
      type: type as TriggerType,
      ...metadata,
    }));
  }

  /**
   * Set up default GitHub triggers for a user
   * Called when user connects their GitHub account
   */
  async setupDefaultGitHubTriggers(userId: string): Promise<TriggerSubscription[]> {
    const log = this.log.child({ method: 'setupDefaultGitHubTriggers', userId });
    const subscriptions: TriggerSubscription[] = [];

    for (const triggerType of ALL_GITHUB_TRIGGER_TYPES) {
      try {
        // Check if already exists
        const existing = await this.triggerSubRepo.findByUserAndType(userId, triggerType);
        if (existing) {
          subscriptions.push(existing);
          continue;
        }

        const subscription = await this.createTriggerSubscription(userId, {
          triggerType,
          autoStart: true, // GitHub triggers auto-start by default
          config: {},
        });
        subscriptions.push(subscription);
      } catch (error) {
        log.error('Failed to create default trigger', error, { triggerType });
      }
    }

    log.info('Default GitHub triggers set up', { 
      count: subscriptions.length,
      total: ALL_GITHUB_TRIGGER_TYPES.length,
    });

    return subscriptions;
  }

  // ===========================================================================
  // Priority Contact Management
  // ===========================================================================

  /**
   * Add a priority contact
   */
  async addPriorityContact(
    userId: string,
    input: PriorityContactInput
  ): Promise<SlackPriorityContact> {
    // Check if already exists
    const existing = await this.priorityContactRepo.findByUserAndSlackUserId(
      userId,
      input.slackUserId
    );
    if (existing) {
      throw new Error('Priority contact already exists');
    }

    const contact = await this.priorityContactRepo.create({
      userId,
      slackUserId: input.slackUserId,
      slackUserName: input.slackUserName,
      priority: input.priority,
      autoStart: input.autoStart,
    });

    this.log.info('Priority contact added', { 
      userId, 
      slackUserId: input.slackUserId,
      priority: input.priority,
    });

    return contact;
  }

  /**
   * List priority contacts for a user
   */
  async listPriorityContacts(userId: string): Promise<SlackPriorityContact[]> {
    return this.priorityContactRepo.findByUserId(userId);
  }

  /**
   * Remove a priority contact
   */
  async removePriorityContact(id: string, userId: string): Promise<void> {
    const contact = await this.priorityContactRepo.findByIdAndUserId(id, userId);
    if (!contact) {
      throw new Error('Priority contact not found');
    }

    await this.priorityContactRepo.delete(id);
    this.log.info('Priority contact removed', { contactId: id });
  }

  // ===========================================================================
  // Event Management
  // ===========================================================================

  /**
   * Approve a pending event and start processing
   */
  async approveEvent(
    eventId: string,
    userId: string
  ): Promise<{ orchestratorRunId: string }> {
    const log = this.log.child({ method: 'approveEvent', eventId, userId });

    // Get event and verify ownership
    const event = await this.eventRepo.findByIdAndUserId(eventId, userId);
    if (!event) {
      throw new Error('Event not found');
    }

    if (event.status !== 'pending') {
      throw new Error(`Cannot approve event with status: ${event.status}`);
    }

    // Update status
    await this.eventRepo.updateStatus(eventId, 'approved');

    // Start orchestrator run
    const orchestratorRunId = await this.startOrchestratorRun(
      userId,
      event,
      event.parsedContext
    );

    // Update event with run ID
    await this.eventRepo.update(eventId, {
      orchestratorRunId,
      status: 'in_progress',
      approvedAt: new Date(),
    });

    // Send reply to source
    const replyContent = await this.replyService.generateReply({
      triggerType: event.triggerType,
      toolkit: event.toolkit,
      parsedContext: event.parsedContext,
      action: 'starting',
    });
    await this.replyToSource(userId, event, replyContent);

    // Notify via WebSocket
    const statusEvent: MonitoringEventStatusChange = {
      type: 'monitoring.event_status',
      eventId,
      status: 'in_progress',
      orchestratorRunId,
    };
    this.socketServer.emitToUser(userId, statusEvent);

    log.info('Event approved and processing started', { orchestratorRunId });
    return { orchestratorRunId };
  }

  /**
   * Reject a pending event
   */
  async rejectEvent(eventId: string, userId: string): Promise<void> {
    const log = this.log.child({ method: 'rejectEvent', eventId, userId });

    // Get event and verify ownership
    const event = await this.eventRepo.findByIdAndUserId(eventId, userId);
    if (!event) {
      throw new Error('Event not found');
    }

    if (event.status !== 'pending') {
      throw new Error(`Cannot reject event with status: ${event.status}`);
    }

    // Update status
    await this.eventRepo.updateStatus(eventId, 'rejected');

    // Notify via WebSocket
    const statusEvent: MonitoringEventStatusChange = {
      type: 'monitoring.event_status',
      eventId,
      status: 'rejected',
      orchestratorRunId: null,
    };
    this.socketServer.emitToUser(userId, statusEvent);

    log.info('Event rejected');
  }

  /**
   * Get event history for a user
   */
  async getEventHistory(
    userId: string,
    options: EventHistoryOptions = {}
  ): Promise<MonitoredEvent[]> {
    return this.eventRepo.findByUserId(userId, options);
  }

  /**
   * Mark an event as completed
   * Called by orchestrator when run completes
   */
  async markEventCompleted(orchestratorRunId: string): Promise<void> {
    const event = await this.eventRepo.findByOrchestratorRunId(orchestratorRunId);
    if (!event) {
      return;
    }

    await this.eventRepo.updateStatus(event.id, 'completed');

    // Send completion reply to source
    const replyContent = await this.replyService.generateReply({
      triggerType: event.triggerType,
      toolkit: event.toolkit,
      parsedContext: event.parsedContext,
      action: 'completed',
    });
    await this.replyToSource(event.userId, event, replyContent);

    // Notify user
    await this.pushService.sendToUser(
      event.userId,
      MonitoringNotificationTemplates.taskCompleted({
        title: event.parsedContext.title,
        eventId: event.id,
      })
    );

    // WebSocket notification
    const statusEvent: MonitoringEventStatusChange = {
      type: 'monitoring.event_status',
      eventId: event.id,
      status: 'completed',
      orchestratorRunId,
    };
    this.socketServer.emitToUser(event.userId, statusEvent);
  }

  /**
   * Mark an event as failed
   * Called by orchestrator when run fails
   */
  async markEventFailed(orchestratorRunId: string, error: string): Promise<void> {
    const event = await this.eventRepo.findByOrchestratorRunId(orchestratorRunId);
    if (!event) {
      return;
    }

    await this.eventRepo.updateStatus(event.id, 'failed');

    // Send failure reply to source
    const replyContent = await this.replyService.generateReply({
      triggerType: event.triggerType,
      toolkit: event.toolkit,
      parsedContext: event.parsedContext,
      action: 'failed',
      errorMessage: error,
    });
    await this.replyToSource(event.userId, event, replyContent);

    // Notify user
    await this.pushService.sendToUser(
      event.userId,
      MonitoringNotificationTemplates.taskFailed({
        title: event.parsedContext.title,
        eventId: event.id,
        error,
      })
    );

    // WebSocket notification
    const statusEvent: MonitoringEventStatusChange = {
      type: 'monitoring.event_status',
      eventId: event.id,
      status: 'failed',
      orchestratorRunId,
    };
    this.socketServer.emitToUser(event.userId, statusEvent);
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  /**
   * Parse a trigger payload into a ParsedTriggerContext
   */
  private async parsePayload(
    toolkit: MonitoringToolkit,
    triggerType: TriggerType,
    data: Record<string, unknown>
  ): Promise<ParsedTriggerContext> {
    if (toolkit === 'GITHUB') {
      return this.parseGitHubPayload(triggerType as GitHubTriggerType, data);
    } else {
      return this.parseSlackPayload(triggerType as SlackTriggerType, data);
    }
  }

  /**
   * Parse a GitHub trigger payload
   */
  private parseGitHubPayload(
    triggerType: GitHubTriggerType,
    data: Record<string, unknown>
  ): ParsedTriggerContext {
    // Extract common fields - these vary by trigger type
    const sender = (data.sender as Record<string, unknown>)?.login as string || 'unknown';
    const repository = (data.repository as Record<string, unknown>)?.full_name as string || null;
    
    let title = '';
    let summary = '';
    let actionableContent = '';
    let issueNumber: number | null = null;
    let prNumber: number | null = null;
    let sourceUrl: string | null = null;

    switch (triggerType) {
      case 'GITHUB_ISSUE_ASSIGNED_EVENT': {
        const issue = data.issue as Record<string, unknown>;
        title = `Issue Assigned: ${issue?.title || 'Unknown'}`;
        summary = issue?.body as string || 'No description provided';
        actionableContent = `Fix the issue: ${issue?.title}\n\n${summary}`;
        issueNumber = issue?.number as number;
        sourceUrl = issue?.html_url as string || null;
        break;
      }
      case 'GITHUB_PULL_REQUEST_REVIEW_REQUESTED_EVENT': {
        const pr = data.pull_request as Record<string, unknown>;
        title = `Review Requested: ${pr?.title || 'Unknown'}`;
        summary = pr?.body as string || 'No description provided';
        actionableContent = `Review the pull request: ${pr?.title}`;
        prNumber = pr?.number as number;
        sourceUrl = pr?.html_url as string || null;
        break;
      }
      case 'GITHUB_PULL_REQUEST_COMMENT_EVENT':
      case 'GITHUB_ISSUE_COMMENT_EVENT': {
        const comment = data.comment as Record<string, unknown>;
        const issue = data.issue as Record<string, unknown>;
        const pr = data.pull_request as Record<string, unknown>;
        title = `Comment: ${(issue?.title || pr?.title) || 'Unknown'}`;
        summary = comment?.body as string || 'No comment body';
        actionableContent = summary;
        issueNumber = issue?.number as number || null;
        prNumber = pr?.number as number || null;
        sourceUrl = comment?.html_url as string || null;
        break;
      }
      case 'GITHUB_MENTION_EVENT': {
        const issue = data.issue as Record<string, unknown>;
        const pr = data.pull_request as Record<string, unknown>;
        const comment = data.comment as Record<string, unknown>;
        title = `Mentioned in: ${(issue?.title || pr?.title) || 'Unknown'}`;
        summary = comment?.body as string || issue?.body as string || 'No content';
        actionableContent = summary;
        issueNumber = issue?.number as number || null;
        prNumber = pr?.number as number || null;
        sourceUrl = (comment?.html_url || issue?.html_url || pr?.html_url) as string || null;
        break;
      }
    }

    return {
      title,
      summary: summary.substring(0, 500), // Truncate long summaries
      sender,
      senderDisplayName: null,
      sourceUrl,
      actionableContent: actionableContent.substring(0, 2000),
      repository,
      issueNumber,
      prNumber,
      channelId: null,
      channelName: null,
      messageTs: null,
    };
  }

  /**
   * Parse a Slack trigger payload
   */
  private parseSlackPayload(
    triggerType: SlackTriggerType,
    data: Record<string, unknown>
  ): ParsedTriggerContext {
    const sender = data.user as string || 'unknown';
    const text = data.text as string || '';
    const channel = data.channel as string || null;
    const channelName = data.channel_name as string || null;
    const messageTs = data.ts as string || null;

    return {
      title: `Message from ${sender}`,
      summary: text.substring(0, 200),
      sender,
      senderDisplayName: data.user_name as string || null,
      sourceUrl: null,
      actionableContent: text,
      repository: null,
      issueNumber: null,
      prNumber: null,
      channelId: channel,
      channelName,
      messageTs,
    };
  }

  /**
   * Evaluate a trigger to determine if it should auto-start
   */
  private async evaluateTrigger(
    userId: string,
    subscription: TriggerSubscription,
    context: ParsedTriggerContext
  ): Promise<TriggerEvaluation> {
    // GitHub triggers auto-start by default based on subscription setting
    if (subscription.toolkit === 'GITHUB') {
      return {
        shouldAutoStart: subscription.autoStart,
        requiresApproval: !subscription.autoStart,
        reason: subscription.autoStart 
          ? 'GitHub trigger configured for auto-start' 
          : 'GitHub trigger requires approval',
      };
    }

    // Slack triggers check priority contacts
    const priorityInfo = await this.priorityContactRepo.getPriorityInfo(
      userId,
      context.sender
    );

    if (!priorityInfo.isPriority) {
      return {
        shouldAutoStart: false,
        requiresApproval: true,
        reason: 'Sender is not a priority contact',
      };
    }

    // Priority contact - check if auto-start is enabled
    const shouldAutoStart = priorityInfo.autoStart || 
      (priorityInfo.priority === 'high' && subscription.autoStart);

    return {
      shouldAutoStart,
      requiresApproval: !shouldAutoStart,
      reason: shouldAutoStart
        ? `Priority contact (${priorityInfo.priority}) with auto-start`
        : `Priority contact (${priorityInfo.priority}) requires approval`,
    };
  }

  /**
   * Start an orchestrator run for the event
   */
  private async startOrchestratorRun(
    userId: string,
    event: MonitoredEvent,
    context: ParsedTriggerContext
  ): Promise<string> {
    const runId = uuidv4();
    const log = this.log.child({ method: 'startOrchestratorRun', runId, eventId: event.id });

    // Build the input for the orchestrator
    const input = this.buildOrchestratorInput(event, context);

    // Create orchestrator instance for this run
    // Events are forwarded to user via WebSocket
    const orchestrator = this.createOrchestratorService((streamEvent) => {
      this.socketServer.emitToUser(userId, streamEvent);
    });

    // Start the run asynchronously
    // The orchestrator will emit events via socket
    log.info('Starting orchestrator run');
    orchestrator.executeRun(userId, runId, input)
      .then(async (result: OrchestratorRunResult) => {
        if (result.success) {
          await this.markEventCompleted(runId);
        } else {
          await this.markEventFailed(runId, result.error || 'Unknown error');
        }
      })
      .catch(async (error: Error) => {
        log.error('Orchestrator run failed', error);
        await this.markEventFailed(runId, error.message);
      });

    return runId;
  }

  /**
   * Build the input string for the orchestrator
   */
  private buildOrchestratorInput(
    event: MonitoredEvent,
    context: ParsedTriggerContext
  ): string {
    let input = '';

    if (event.toolkit === 'GITHUB') {
      input = `[Automated Task from GitHub]\n\n`;
      input += `**Source:** ${TRIGGER_METADATA[event.triggerType].name}\n`;
      if (context.repository) {
        input += `**Repository:** ${context.repository}\n`;
      }
      if (context.issueNumber) {
        input += `**Issue #${context.issueNumber}:** ${context.title}\n`;
      }
      if (context.prNumber) {
        input += `**PR #${context.prNumber}:** ${context.title}\n`;
      }
      if (context.sourceUrl) {
        input += `**URL:** ${context.sourceUrl}\n`;
      }
      input += `\n**Task:**\n${context.actionableContent}\n\n`;
      input += `Please complete this task. Commit and push your changes when done.`;
    } else {
      input = `[Task from Slack]\n\n`;
      input += `**From:** ${context.senderDisplayName || context.sender}\n`;
      if (context.channelName) {
        input += `**Channel:** #${context.channelName}\n`;
      }
      input += `\n**Request:**\n${context.actionableContent}\n\n`;
      input += `Please complete this task. Commit and push your changes when done.`;
    }

    return input;
  }

  /**
   * Reply to the source platform (GitHub or Slack)
   */
  private async replyToSource(
    userId: string,
    event: MonitoredEvent,
    message: string
  ): Promise<string | null> {
    const log = this.log.child({ method: 'replyToSource', eventId: event.id });

    try {
      if (event.toolkit === 'GITHUB') {
        return await this.replyToGitHub(userId, event, message);
      } else {
        return await this.replyToSlack(userId, event, message);
      }
    } catch (error) {
      log.error('Failed to reply to source', error);
      return null;
    }
  }

  /**
   * Reply to GitHub (post a comment)
   */
  private async replyToGitHub(
    userId: string,
    event: MonitoredEvent,
    message: string
  ): Promise<string | null> {
    if (!this.composioService) {
      this.log.warn('Composio service not available, cannot reply to GitHub');
      return null;
    }

    const context = event.parsedContext;
    
    // Determine which tool to use based on issue/PR
    let toolSlug: string;
    let args: Record<string, unknown>;

    if (context.prNumber && context.repository) {
      // Reply to PR
      const [owner, repo] = context.repository.split('/');
      toolSlug = 'GITHUB_CREATE_ISSUE_COMMENT'; // Works for PR comments too
      args = {
        owner,
        repo,
        issue_number: context.prNumber,
        body: message,
      };
    } else if (context.issueNumber && context.repository) {
      // Reply to issue
      const [owner, repo] = context.repository.split('/');
      toolSlug = 'GITHUB_CREATE_ISSUE_COMMENT';
      args = {
        owner,
        repo,
        issue_number: context.issueNumber,
        body: message,
      };
    } else {
      this.log.warn('Cannot reply to GitHub: no issue or PR number');
      return null;
    }

    try {
      const result = await this.composioService.executeTool(userId, toolSlug, args);
      if (result.error) {
        throw new Error(result.error);
      }
      const commentId = (result.data as Record<string, unknown>)?.id?.toString() || null;
      return commentId;
    } catch (error) {
      this.log.error('Failed to post GitHub comment', error);
      return null;
    }
  }

  /**
   * Reply to Slack (post a message)
   */
  private async replyToSlack(
    userId: string,
    event: MonitoredEvent,
    message: string
  ): Promise<string | null> {
    if (!this.composioService) {
      this.log.warn('Composio service not available, cannot reply to Slack');
      return null;
    }

    const context = event.parsedContext;
    
    if (!context.channelId) {
      this.log.warn('Cannot reply to Slack: no channel ID');
      return null;
    }

    const args: Record<string, unknown> = {
      channel: context.channelId,
      text: message,
    };

    // Thread the reply if we have a message timestamp
    if (context.messageTs) {
      args.thread_ts = context.messageTs;
    }

    try {
      const result = await this.composioService.executeTool(
        userId,
        'SLACK_CHAT_POST_MESSAGE',
        args
      );
      if (result.error) {
        throw new Error(result.error);
      }
      const messageTs = (result.data as Record<string, unknown>)?.ts?.toString() || null;
      return messageTs;
    } catch (error) {
      this.log.error('Failed to post Slack message', error);
      return null;
    }
  }

  /**
   * Notify user via WebSocket and push notification
   */
  private async notifyUser(
    userId: string,
    event: MonitoredEvent,
    autoStarted: boolean,
    orchestratorRunId: string | null
  ): Promise<void> {
    // WebSocket notification
    const wsEvent: MonitoringEventReceived = {
      type: 'monitoring.event_received',
      eventId: event.id,
      triggerType: event.triggerType,
      toolkit: event.toolkit,
      title: event.parsedContext.title,
      summary: event.parsedContext.summary,
      requiresApproval: event.requiresApproval,
      autoStarted,
      sourceUrl: event.parsedContext.sourceUrl,
      orchestratorRunId,
    };
    this.socketServer.emitToUser(userId, wsEvent);

    // Push notification
    if (autoStarted) {
      await this.pushService.sendToUser(
        userId,
        MonitoringNotificationTemplates.eventAutoStarted({
          toolkit: event.toolkit,
          title: event.parsedContext.title,
          eventId: event.id,
          runId: orchestratorRunId!,
        })
      );
    } else {
      await this.pushService.sendToUser(
        userId,
        MonitoringNotificationTemplates.eventReceivedPendingApproval({
          toolkit: event.toolkit,
          title: event.parsedContext.title,
          summary: event.parsedContext.summary,
          eventId: event.id,
        })
      );
    }
  }

  /**
   * Insert a system message into the conversation
   */
  private async insertConversationMessage(
    userId: string,
    event: MonitoredEvent,
    orchestratorRunId: string | null
  ): Promise<void> {
    // TODO: Implement conversation message insertion
    // This would use the MessageRepository to insert a system message
    // that appears in the user's conversation thread
    
    // For now, this is handled by the WebSocket event
    this.log.debug('Conversation message insertion not yet implemented', {
      userId,
      eventId: event.id,
    });
  }
}
