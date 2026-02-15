// =============================================================================
// Example Prompt Types
// =============================================================================
// TypeScript definitions for example prompt feature

import type { AgentType } from '@project-jarvis/shared-types';

// =============================================================================
// Example Prompt Registry
// =============================================================================

/**
 * Registry mapping codewords to example prompt filenames
 * Format: { "exmprompt1": "coding-setup.json", ... }
 */
export interface ExamplePromptRegistry {
  [codeword: string]: string;
}

// =============================================================================
// Task Definition
// =============================================================================

/**
 * Individual task in an example prompt plan
 */
export interface ExampleTask {
  tempId: string;
  description: string;
  agentType: AgentType;
  dependencies: string[];
}

// =============================================================================
// Plan Definition
// =============================================================================

/**
 * Execution plan for an example prompt
 */
export interface ExamplePlan {
  reasoning: string;
  tasks: ExampleTask[];
}

// =============================================================================
// Visibility Configuration
// =============================================================================

/**
 * Visibility settings for example prompt execution
 */
export interface VisibilityConfig {
  showBanner: boolean;
  bannerMessage: string;
}

// =============================================================================
// Execution Configuration
// =============================================================================

/**
 * Execution settings for an example prompt
 */
export interface ExecutionConfig {
  hideContextHistory: boolean;
  plan: ExamplePlan;
  /**
   * Working directory for all file operations and terminal commands.
   * This directory will be cleaned before and after execution.
   */
  workingDirectory: string;
}

// =============================================================================
// Example Prompt Definition
// =============================================================================

/**
 * Complete example prompt definition loaded from JSON
 */
export interface ExamplePrompt {
  id: string;
  displayName: string;
  description: string;
  visibility: VisibilityConfig;
  execution: ExecutionConfig;
}

// =============================================================================
// Detection Result
// =============================================================================

/**
 * Result of attempting to detect an example prompt from user input
 */
export interface ExamplePromptMatch {
  codeword: string;
  prompt: ExamplePrompt;
}

// =============================================================================
// Loader Options
// =============================================================================

/**
 * Options for the example prompt loader
 */
export interface ExamplePromptLoaderOptions {
  enabled: boolean;
  basePath: string;
}

// =============================================================================
// Event Types
// =============================================================================

/**
 * Event emitted when example prompt starts
 */
export interface ExamplePromptStartEvent {
  type: 'example_prompt_start';
  codeword: string;
  displayName: string;
  bannerMessage: string;
}
