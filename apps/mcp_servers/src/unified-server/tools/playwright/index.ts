// =============================================================================
// Playwright Tool Provider
// =============================================================================
// Registers all Playwright browser tools with the tool router

import { registerNavigationTools } from './tools/navigation.js';
import { registerInteractionTools } from './tools/interaction.js';
import { registerInspectionTools, setupPageCapture } from './tools/inspection.js';
import { registerTabTools } from './tools/tabs.js';
import { registerAdvancedTools, setupDialogHandler } from './tools/advanced.js';
import { browserManager } from './browser-manager.js';
import { sessionManager } from './session-manager.js';
import { log } from '../../utils/logger.js';

/**
 * Register all Playwright tools with the tool router
 */
export function registerPlaywrightTools(): void {
  log.info('Registering Playwright tools');

  registerNavigationTools();
  registerInteractionTools();
  registerInspectionTools();
  registerTabTools();
  registerAdvancedTools();

  log.info('Playwright tools registered');
}

/**
 * Initialize the Playwright browser session
 *
 * This sets up:
 * - Browser instance (new or connected via CDP)
 * - Page event handlers (console, network capture)
 * - Dialog handlers
 */
export async function initializePlaywright(): Promise<void> {
  log.info('Initializing Playwright');

  try {
    // Initialize session (launches browser or connects to existing)
    await sessionManager.initializeSession();

    // Setup page capture (console, network)
    await setupPageCapture();

    // Setup dialog handler
    await setupDialogHandler();

    log.info('Playwright initialized successfully');
  } catch (error) {
    log.error('Failed to initialize Playwright', { error });
    throw error;
  }
}

/**
 * Cleanup Playwright resources
 */
export async function cleanupPlaywright(): Promise<void> {
  log.info('Cleaning up Playwright');

  try {
    await browserManager.close();
    log.info('Playwright cleanup complete');
  } catch (error) {
    log.error('Error during Playwright cleanup', { error });
  }
}

// Re-export managers for direct access if needed
export { browserManager } from './browser-manager.js';
export { sessionManager } from './session-manager.js';
