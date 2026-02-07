// =============================================================================
// Tool Registration
// =============================================================================
// Registers all tool providers with the tool router

import { registerClaudeCodeTools } from './claude-code/index.js';
import { registerPlaywrightTools, initializePlaywright, cleanupPlaywright } from './playwright/index.js';
import { registerDeveloperTools } from './developer/index.js';
import { toolRouter } from '../router/index.js';
import { log } from '../utils/logger.js';

/**
 * Register all tools with the tool router
 */
export function registerAllTools(): void {
  log.info('Registering all tools');

  // Register Claude Code tools
  registerClaudeCodeTools();

  // Register Playwright tools
  registerPlaywrightTools();

  // Register Developer tools (terminal, filesystem)
  registerDeveloperTools();

  log.info(`All tools registered. Total: ${toolRouter.getToolCount()}`);
}

/**
 * Initialize all tool providers that require setup
 */
export async function initializeTools(): Promise<void> {
  log.info('Initializing tools');

  // Initialize Playwright (deferred until first browser tool use)
  // We don't initialize here to avoid launching browser on server start
  // Instead, browserManager.ensureBrowser() is called lazily

  log.info('Tools initialized');
}

/**
 * Cleanup all tool providers
 */
export async function cleanupTools(): Promise<void> {
  log.info('Cleaning up tools');

  await cleanupPlaywright();

  log.info('Tools cleanup complete');
}

// Re-export for convenience
export { initializePlaywright, cleanupPlaywright } from './playwright/index.js';
