// =============================================================================
// Trigger Reply Service
// =============================================================================
// Generates LLM-powered contextual replies for GitHub and Slack when
// the monitoring agent receives trigger events.

import { generateText } from 'ai';
import { getLanguageModel } from '../../infrastructure/ai/registry.js';
import { logger } from '../../infrastructure/logging/logger.js';
import type {
  ParsedTriggerContext,
  GitHubTriggerType,
  SlackTriggerType,
  MonitoringToolkit,
} from '@project-jarvis/shared-types';

// =============================================================================
// Types
// =============================================================================

/**
 * Action types for reply generation
 */
export type ReplyAction = 
  | 'auto_starting'      // Agent is automatically starting work
  | 'awaiting_approval'  // Agent needs user approval before starting
  | 'starting'           // User approved, agent is starting
  | 'completed'          // Task completed successfully
  | 'failed';            // Task failed

/**
 * Context for generating a reply
 */
export interface ReplyContext {
  triggerType: GitHubTriggerType | SlackTriggerType;
  toolkit: MonitoringToolkit;
  parsedContext: ParsedTriggerContext;
  action: ReplyAction;
  additionalContext?: string;
  errorMessage?: string; // For failed actions
}

/**
 * Configuration for the TriggerReplyService
 */
export interface TriggerReplyServiceConfig {
  /**
   * Model ID to use for generating replies
   * @default 'openai:gpt-4o-mini'
   */
  modelId?: string;
  
  /**
   * Maximum tokens for the response
   * @default 150
   */
  maxTokens?: number;
  
  /**
   * Temperature for the response
   * @default 0.7
   */
  temperature?: number;
}

// =============================================================================
// System Prompts
// =============================================================================

const GITHUB_REPLY_SYSTEM_PROMPT = `You are Jarvis, an AI coding assistant responding on behalf of a developer on GitHub.
Generate a brief, professional reply for the given situation.

Guidelines:
- Keep it concise (1-3 sentences)
- Be helpful and clear about what's happening
- Use professional but friendly tone
- Do not use excessive punctuation or emojis
- Reference specific details from the context when relevant
- For code-related issues, acknowledge the technical context`;

const SLACK_REPLY_SYSTEM_PROMPT = `You are Jarvis, an AI assistant responding on behalf of a developer on Slack.
Generate a brief, professional reply for the given situation.

Guidelines:
- Keep it concise (1-3 sentences)
- Be helpful and clear about what's happening
- Use a friendly, conversational tone appropriate for Slack
- Do not use excessive punctuation or emojis
- Acknowledge the sender's request
- Be clear about next steps or status`;

// =============================================================================
// Service
// =============================================================================

/**
 * Service for generating contextual replies to GitHub and Slack triggers
 */
export class TriggerReplyService {
  private modelId: string;
  private maxTokens: number;
  private temperature: number;

  constructor(config: TriggerReplyServiceConfig = {}) {
    // Use a cheaper model for reply generation
    this.modelId = config.modelId ?? 'openai:gpt-4o-mini';
    this.maxTokens = config.maxTokens ?? 150;
    this.temperature = config.temperature ?? 0.7;
  }

  // ===========================================================================
  // Public Methods
  // ===========================================================================

  /**
   * Generate a reply for a trigger event
   */
  async generateReply(context: ReplyContext): Promise<string> {
    const log = logger.child({ service: 'TriggerReplyService', action: context.action });
    
    try {
      if (context.toolkit === 'GITHUB') {
        return await this.generateGitHubReply(context);
      } else {
        return await this.generateSlackReply(context);
      }
    } catch (error) {
      log.error('Failed to generate reply', error);
      // Return a fallback message
      return this.getFallbackReply(context);
    }
  }

  /**
   * Generate a reply for a GitHub event
   */
  async generateGitHubReply(context: ReplyContext): Promise<string> {
    const prompt = this.buildGitHubPrompt(context);
    
    const model = getLanguageModel(this.modelId);
    const result = await generateText({
      model,
      system: GITHUB_REPLY_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
      maxTokens: this.maxTokens,
      temperature: this.temperature,
    });

    return result.text.trim();
  }

  /**
   * Generate a reply for a Slack message
   */
  async generateSlackReply(context: ReplyContext): Promise<string> {
    const prompt = this.buildSlackPrompt(context);
    
    const model = getLanguageModel(this.modelId);
    const result = await generateText({
      model,
      system: SLACK_REPLY_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
      maxTokens: this.maxTokens,
      temperature: this.temperature,
    });

    return result.text.trim();
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  /**
   * Build a prompt for GitHub reply generation
   */
  private buildGitHubPrompt(context: ReplyContext): string {
    const { triggerType, parsedContext, action, additionalContext, errorMessage } = context;

    const triggerDescription = this.getGitHubTriggerDescription(triggerType as GitHubTriggerType);
    const actionDescription = this.getActionDescription(action);

    let prompt = `Generate a reply for the following GitHub ${triggerDescription}:

**Title:** ${parsedContext.title}
**Summary:** ${parsedContext.summary}
**From:** ${parsedContext.senderDisplayName || parsedContext.sender}`;

    if (parsedContext.repository) {
      prompt += `\n**Repository:** ${parsedContext.repository}`;
    }

    if (parsedContext.issueNumber) {
      prompt += `\n**Issue #:** ${parsedContext.issueNumber}`;
    }

    if (parsedContext.prNumber) {
      prompt += `\n**PR #:** ${parsedContext.prNumber}`;
    }

    prompt += `\n\n**Action:** ${actionDescription}`;

    if (additionalContext) {
      prompt += `\n**Additional Context:** ${additionalContext}`;
    }

    if (errorMessage && action === 'failed') {
      prompt += `\n**Error:** ${errorMessage}`;
    }

    return prompt;
  }

  /**
   * Build a prompt for Slack reply generation
   */
  private buildSlackPrompt(context: ReplyContext): string {
    const { parsedContext, action, additionalContext, errorMessage } = context;

    const actionDescription = this.getActionDescription(action);

    let prompt = `Generate a Slack reply for the following message:

**From:** ${parsedContext.senderDisplayName || parsedContext.sender}
**Message Summary:** ${parsedContext.summary}
**Request:** ${parsedContext.actionableContent}

**Action:** ${actionDescription}`;

    if (parsedContext.channelName) {
      prompt += `\n**Channel:** #${parsedContext.channelName}`;
    }

    if (additionalContext) {
      prompt += `\n**Additional Context:** ${additionalContext}`;
    }

    if (errorMessage && action === 'failed') {
      prompt += `\n**Error:** ${errorMessage}`;
    }

    return prompt;
  }

  /**
   * Get a human-readable description of the GitHub trigger type
   */
  private getGitHubTriggerDescription(triggerType: GitHubTriggerType): string {
    const descriptions: Record<GitHubTriggerType, string> = {
      GITHUB_ISSUE_ASSIGNED_EVENT: 'issue assignment',
      GITHUB_PULL_REQUEST_REVIEW_REQUESTED_EVENT: 'PR review request',
      GITHUB_PULL_REQUEST_COMMENT_EVENT: 'PR comment',
      GITHUB_ISSUE_COMMENT_EVENT: 'issue comment',
      GITHUB_MENTION_EVENT: 'mention',
    };

    return descriptions[triggerType] || 'event';
  }

  /**
   * Get a human-readable description of the action
   */
  private getActionDescription(action: ReplyAction): string {
    const descriptions: Record<ReplyAction, string> = {
      auto_starting: "I'm automatically starting work on this task now",
      awaiting_approval: "I've received this and am waiting for approval from the developer before starting",
      starting: "The developer has approved, and I'm starting work on this now",
      completed: "I've completed this task successfully",
      failed: "I encountered an issue while working on this task",
    };

    return descriptions[action];
  }

  /**
   * Get a fallback reply when LLM generation fails
   */
  private getFallbackReply(context: ReplyContext): string {
    const { toolkit, action } = context;
    
    const fallbacks: Record<ReplyAction, Record<MonitoringToolkit, string>> = {
      auto_starting: {
        GITHUB: "I'm Jarvis, an AI assistant. I'm automatically starting work on this now. I'll update you on my progress.",
        SLACK: "Hi! I'm Jarvis. I'm starting work on this request now and will keep you updated.",
      },
      awaiting_approval: {
        GITHUB: "I'm Jarvis, an AI assistant. I've received this and will begin working once the developer approves.",
        SLACK: "Hi! I'm Jarvis. I've received your message and will start once the developer approves.",
      },
      starting: {
        GITHUB: "I'm Jarvis. The developer has approved this request, and I'm starting work now.",
        SLACK: "The developer has approved your request. I'm starting work on this now.",
      },
      completed: {
        GITHUB: "I've completed this task. Please review the changes.",
        SLACK: "I've completed the task you requested.",
      },
      failed: {
        GITHUB: "I encountered an issue while working on this task. The developer has been notified.",
        SLACK: "I ran into an issue with this request. The developer has been notified and will follow up.",
      },
    };

    return fallbacks[action][toolkit];
  }
}
