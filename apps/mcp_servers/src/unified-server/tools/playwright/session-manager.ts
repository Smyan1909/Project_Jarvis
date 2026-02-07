// =============================================================================
// Session Manager
// =============================================================================
// Manages browser session state, storage, and extension connections

import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { browserManager } from './browser-manager.js';
import { getConfig } from '../../config.js';
import { log } from '../../utils/logger.js';

/**
 * Storage state structure (cookies, localStorage, etc.)
 */
export interface StorageState {
  cookies: Array<{
    name: string;
    value: string;
    domain: string;
    path: string;
    expires: number;
    httpOnly: boolean;
    secure: boolean;
    sameSite: 'Strict' | 'Lax' | 'None';
  }>;
  origins: Array<{
    origin: string;
    localStorage: Array<{ name: string; value: string }>;
  }>;
}

/**
 * Session Manager
 *
 * Handles:
 * - Saving/restoring browser storage state
 * - Connecting to existing browser via extension
 * - Session persistence
 */
class SessionManager {
  private storageStatePath: string | null = null;

  /**
   * Save current session storage state to file
   */
  async saveStorageState(path?: string): Promise<string> {
    const page = await browserManager.getCurrentPage();
    const context = page.context();

    const savePath = path ?? this.getDefaultStoragePath();
    
    // Ensure directory exists
    await mkdir(dirname(savePath), { recursive: true });

    // Get storage state from context
    const state = await context.storageState();
    await writeFile(savePath, JSON.stringify(state, null, 2), 'utf-8');

    this.storageStatePath = savePath;

    log.info('Saved storage state', {
      path: savePath,
      cookies: state.cookies.length,
      origins: state.origins.length,
    });

    return savePath;
  }

  /**
   * Load storage state from file
   */
  async loadStorageState(path?: string): Promise<StorageState | null> {
    const loadPath = path ?? this.getDefaultStoragePath();

    try {
      await access(loadPath);
      const content = await readFile(loadPath, 'utf-8');
      const state = JSON.parse(content) as StorageState;

      log.info('Loaded storage state', {
        path: loadPath,
        cookies: state.cookies.length,
        origins: state.origins.length,
      });

      return state;
    } catch (error) {
      log.debug('No storage state file found', { path: loadPath });
      return null;
    }
  }

  /**
   * Initialize session with saved storage state if available
   */
  async initializeSession(): Promise<void> {
    const config = getConfig().playwright;

    // Check if we should connect to existing browser
    if (config.extensionEnabled && config.cdpEndpoint) {
      log.info('Connecting to existing browser via extension');
      await browserManager.ensureBrowser({
        cdpEndpoint: config.cdpEndpoint,
      });
      return;
    }

    // Otherwise, launch new browser
    await browserManager.ensureBrowser();
  }

  /**
   * Clear current session (cookies, storage, etc.)
   */
  async clearSession(): Promise<void> {
    const page = await browserManager.getCurrentPage();
    const context = page.context();

    await context.clearCookies();

    log.info('Cleared session cookies');
  }

  /**
   * Get current session info
   */
  async getSessionInfo(): Promise<{
    isConnected: boolean;
    isExtensionMode: boolean;
    tabCount: number;
    storageStatePath: string | null;
  }> {
    return {
      isConnected: browserManager.isRunning(),
      isExtensionMode: false, // TODO: track this properly
      tabCount: (await browserManager.getPages()).length,
      storageStatePath: this.storageStatePath,
    };
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  private getDefaultStoragePath(): string {
    const config = getConfig().playwright;
    return join(config.userDataDir, 'storage-state.json');
  }
}

// Export singleton instance
export const sessionManager = new SessionManager();
