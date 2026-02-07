// =============================================================================
// Monitoring Agent Domain Types
// =============================================================================
// Types for the monitoring agent that listens for GitHub/Slack triggers
// and initiates autonomous coding tasks.

import { z } from 'zod';

// =============================================================================
// Toolkit & Trigger Types
// =============================================================================

/**
 * Supported toolkits for monitoring triggers
 */
export const MonitoringToolkitSchema = z.enum(['GITHUB', 'SLACK']);
export type MonitoringToolkit = z.infer<typeof MonitoringToolkitSchema>;

/**
 * GitHub trigger types - all auto-start by default
 */
export const GitHubTriggerTypeSchema = z.enum([
  'GITHUB_ISSUE_ASSIGNED_EVENT',
  'GITHUB_PULL_REQUEST_REVIEW_REQUESTED_EVENT',
  'GITHUB_PULL_REQUEST_COMMENT_EVENT',
  'GITHUB_ISSUE_COMMENT_EVENT',
  'GITHUB_MENTION_EVENT',
]);
export type GitHubTriggerType = z.infer<typeof GitHubTriggerTypeSchema>;

/**
 * Slack trigger types - require priority contact configuration
 */
export const SlackTriggerTypeSchema = z.enum([
  'SLACK_RECEIVE_MESSAGE',
  'SLACK_RECEIVE_DIRECT_MESSAGE',
]);
export type SlackTriggerType = z.infer<typeof SlackTriggerTypeSchema>;

/**
 * All supported trigger types
 */
export const TriggerTypeSchema = z.union([GitHubTriggerTypeSchema, SlackTriggerTypeSchema]);
export type TriggerType = z.infer<typeof TriggerTypeSchema>;

/**
 * List of all GitHub trigger types for auto-sync
 */
export const ALL_GITHUB_TRIGGER_TYPES: GitHubTriggerType[] = [
  'GITHUB_ISSUE_ASSIGNED_EVENT',
  'GITHUB_PULL_REQUEST_REVIEW_REQUESTED_EVENT',
  'GITHUB_PULL_REQUEST_COMMENT_EVENT',
  'GITHUB_ISSUE_COMMENT_EVENT',
  'GITHUB_MENTION_EVENT',
];

// =============================================================================
// Event Status
// =============================================================================

/**
 * Status of a monitored event
 */
export const MonitoredEventStatusSchema = z.enum([
  'pending',      // Awaiting user approval
  'approved',     // User approved, starting run
  'rejected',     // User rejected the event
  'auto_started', // Automatically started (GitHub or high-priority Slack)
  'in_progress',  // Orchestrator run is active
  'completed',    // Task completed successfully
  'failed',       // Task failed
]);
export type MonitoredEventStatus = z.infer<typeof MonitoredEventStatusSchema>;

// =============================================================================
// Priority Levels
// =============================================================================

/**
 * Priority levels for Slack contacts
 */
export const PriorityLevelSchema = z.enum(['high', 'normal']);
export type PriorityLevel = z.infer<typeof PriorityLevelSchema>;

// =============================================================================
// Trigger Subscription
// =============================================================================

/**
 * A trigger subscription maps a Composio trigger to a user
 */
export const TriggerSubscriptionSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  triggerId: z.string(), // Composio trigger ID
  triggerType: TriggerTypeSchema,
  toolkit: MonitoringToolkitSchema,
  config: z.record(z.unknown()), // Trigger-specific config
  autoStart: z.boolean(),
  enabled: z.boolean(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type TriggerSubscription = z.infer<typeof TriggerSubscriptionSchema>;

// =============================================================================
// Slack Priority Contact
// =============================================================================

/**
 * A Slack user whose messages should be prioritized
 */
export const SlackPriorityContactSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  slackUserId: z.string(),
  slackUserName: z.string().nullable(),
  priority: PriorityLevelSchema,
  autoStart: z.boolean(),
  createdAt: z.date(),
});
export type SlackPriorityContact = z.infer<typeof SlackPriorityContactSchema>;

// =============================================================================
// Parsed Trigger Context
// =============================================================================

/**
 * Extracted context from a trigger payload
 * This is what the LLM uses to generate replies and start tasks
 */
export const ParsedTriggerContextSchema = z.object({
  // Common fields
  title: z.string(),
  summary: z.string(),
  sender: z.string(), // Username/ID of the person who triggered
  senderDisplayName: z.string().nullable(),
  sourceUrl: z.string().url().nullable(),
  actionableContent: z.string(), // The actual task/request to perform

  // GitHub-specific
  repository: z.string().nullable(), // owner/repo format
  issueNumber: z.number().nullable(),
  prNumber: z.number().nullable(),

  // Slack-specific
  channelId: z.string().nullable(),
  channelName: z.string().nullable(),
  messageTs: z.string().nullable(), // Slack message timestamp for replies
});
export type ParsedTriggerContext = z.infer<typeof ParsedTriggerContextSchema>;

// =============================================================================
// Monitored Event
// =============================================================================

/**
 * A monitored event - a trigger that was received and processed
 */
export const MonitoredEventSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  subscriptionId: z.string().uuid().nullable(),
  triggerType: TriggerTypeSchema,
  toolkit: MonitoringToolkitSchema,
  status: MonitoredEventStatusSchema,
  payload: z.record(z.unknown()), // Raw Composio payload
  parsedContext: ParsedTriggerContextSchema,
  orchestratorRunId: z.string().uuid().nullable(),
  sourceReplyId: z.string().nullable(), // ID of reply in GitHub/Slack
  sourceReplyContent: z.string().nullable(),
  requiresApproval: z.boolean(),
  receivedAt: z.date(),
  processedAt: z.date().nullable(),
  approvedAt: z.date().nullable(),
});
export type MonitoredEvent = z.infer<typeof MonitoredEventSchema>;

// =============================================================================
// API Input Types
// =============================================================================

/**
 * Input for creating a trigger subscription
 */
export const TriggerConfigInputSchema = z.object({
  triggerType: TriggerTypeSchema,
  autoStart: z.boolean().default(false),
  config: z.record(z.unknown()).default({}),
});
export type TriggerConfigInput = z.infer<typeof TriggerConfigInputSchema>;

/**
 * Input for updating a trigger subscription
 */
export const TriggerConfigUpdateSchema = z.object({
  autoStart: z.boolean().optional(),
  enabled: z.boolean().optional(),
  config: z.record(z.unknown()).optional(),
});
export type TriggerConfigUpdate = z.infer<typeof TriggerConfigUpdateSchema>;

/**
 * Input for adding a priority contact
 */
export const PriorityContactInputSchema = z.object({
  slackUserId: z.string(),
  slackUserName: z.string().optional(),
  priority: PriorityLevelSchema.default('normal'),
  autoStart: z.boolean().default(false),
});
export type PriorityContactInput = z.infer<typeof PriorityContactInputSchema>;

/**
 * Input for registering a push token
 */
export const PushTokenInputSchema = z.object({
  token: z.string(),
  platform: z.enum(['ios', 'android']),
});
export type PushTokenInput = z.infer<typeof PushTokenInputSchema>;

// =============================================================================
// Composio Webhook Payload
// =============================================================================

/**
 * Structure of a Composio webhook payload
 */
export const ComposioTriggerPayloadSchema = z.object({
  type: z.string(), // Trigger type (e.g., 'GITHUB_ISSUE_ASSIGNED_EVENT')
  data: z.record(z.unknown()), // Trigger-specific data
  timestamp: z.string(),
  log_id: z.string(),
  trigger_id: z.string().optional(), // May be present
});
export type ComposioTriggerPayload = z.infer<typeof ComposioTriggerPayloadSchema>;

// =============================================================================
// Available Trigger Info
// =============================================================================

/**
 * Information about an available trigger type
 */
export const AvailableTriggerInfoSchema = z.object({
  type: TriggerTypeSchema,
  toolkit: MonitoringToolkitSchema,
  name: z.string(),
  description: z.string(),
  defaultAutoStart: z.boolean(),
  configSchema: z.record(z.unknown()).optional(),
});
export type AvailableTriggerInfo = z.infer<typeof AvailableTriggerInfoSchema>;

/**
 * Mapping of trigger types to their metadata
 */
export const TRIGGER_METADATA: Record<TriggerType, Omit<AvailableTriggerInfo, 'type'>> = {
  // GitHub triggers - auto-start by default
  GITHUB_ISSUE_ASSIGNED_EVENT: {
    toolkit: 'GITHUB',
    name: 'Issue Assigned',
    description: 'Triggered when a GitHub issue is assigned to you',
    defaultAutoStart: true,
  },
  GITHUB_PULL_REQUEST_REVIEW_REQUESTED_EVENT: {
    toolkit: 'GITHUB',
    name: 'PR Review Requested',
    description: 'Triggered when a pull request review is requested from you',
    defaultAutoStart: true,
  },
  GITHUB_PULL_REQUEST_COMMENT_EVENT: {
    toolkit: 'GITHUB',
    name: 'PR Comment',
    description: 'Triggered when someone comments on your pull request',
    defaultAutoStart: true,
  },
  GITHUB_ISSUE_COMMENT_EVENT: {
    toolkit: 'GITHUB',
    name: 'Issue Comment',
    description: 'Triggered when someone comments on an issue assigned to you',
    defaultAutoStart: true,
  },
  GITHUB_MENTION_EVENT: {
    toolkit: 'GITHUB',
    name: 'Mention',
    description: 'Triggered when you are mentioned in an issue or pull request',
    defaultAutoStart: true,
  },
  // Slack triggers - require approval by default
  SLACK_RECEIVE_MESSAGE: {
    toolkit: 'SLACK',
    name: 'Channel Message',
    description: 'Triggered when a message is received in a Slack channel',
    defaultAutoStart: false,
  },
  SLACK_RECEIVE_DIRECT_MESSAGE: {
    toolkit: 'SLACK',
    name: 'Direct Message',
    description: 'Triggered when a direct message is received',
    defaultAutoStart: false,
  },
};
