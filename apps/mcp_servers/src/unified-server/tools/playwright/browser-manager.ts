// =============================================================================
// Browser Manager
// =============================================================================
// Manages browser lifecycle and provides access to browser, context, and page

import {
  chromium,
  firefox,
  webkit,
  type Browser,
  type BrowserContext,
  type Page,
  type BrowserType,
} from 'playwright';
import { getConfig, type PlaywrightConfig } from '../../config.js';
import { log } from '../../utils/logger.js';

/**
 * Browser launch options
 */
export interface BrowserLaunchOptions {
  /** CDP endpoint to connect to existing browser */
  cdpEndpoint?: string;
  /** Override headless setting */
  headless?: boolean;
  /** Override browser type */
  browser?: 'chromium' | 'firefox' | 'webkit' | 'msedge';
}

/**
 * Browser Manager Singleton
 *
 * Manages the browser instance, context, and current page.
 * Supports:
 * - Launching new browser instances
 * - Connecting to existing browsers via CDP
 * - Persistent user data directories
 * - Tab management
 */
class BrowserManager {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private pages: Page[] = [];
  private currentPageIndex: number = 0;
  private isConnectedViaCDP: boolean = false;

  /**
   * Get the current page, launching browser if needed
   */
  async getCurrentPage(): Promise<Page> {
    await this.ensureBrowser();
    return this.pages[this.currentPageIndex];
  }

  /**
   * Get all open pages
   */
  async getPages(): Promise<Page[]> {
    await this.ensureBrowser();
    return this.pages;
  }

  /**
   * Get current page index
   */
  getCurrentPageIndex(): number {
    return this.currentPageIndex;
  }

  /**
   * Check if browser is running
   */
  isRunning(): boolean {
    return this.browser !== null && this.browser.isConnected();
  }

  /**
   * Ensure browser is running, launch if not
   */
  async ensureBrowser(options?: BrowserLaunchOptions): Promise<void> {
    if (this.isRunning()) {
      return;
    }

    await this.launch(options);
  }

  /**
   * Launch a new browser instance
   */
  async launch(options?: BrowserLaunchOptions): Promise<void> {
    const config = getConfig().playwright;
    const mergedOptions = { ...config, ...options };

    log.info('Launching browser', {
      browser: mergedOptions.browser,
      headless: mergedOptions.headless,
      cdpEndpoint: mergedOptions.cdpEndpoint,
    });

    // Connect to existing browser via CDP if endpoint provided
    if (mergedOptions.cdpEndpoint) {
      await this.connectViaCDP(mergedOptions.cdpEndpoint);
      return;
    }

    // Get browser type
    const browserType = this.getBrowserType(mergedOptions.browser);

    // Parse viewport
    const [width, height] = this.parseViewport(mergedOptions.viewportSize);

    // Launch with persistent context for session persistence
    if (mergedOptions.userDataDir) {
      this.context = await browserType.launchPersistentContext(mergedOptions.userDataDir, {
        headless: mergedOptions.headless,
        viewport: { width, height },
        args: this.getBrowserArgs(mergedOptions),
      });

      // Get browser from context
      this.browser = this.context.browser();
    } else {
      // Launch regular browser
      this.browser = await browserType.launch({
        headless: mergedOptions.headless,
        args: this.getBrowserArgs(mergedOptions),
      });

      this.context = await this.browser.newContext({
        viewport: { width, height },
      });
    }

    // Create initial page
    const page = await this.context.newPage();
    this.pages = [page];
    this.currentPageIndex = 0;

    // Setup page event handlers
    this.setupPageHandlers(page);

    log.info('Browser launched successfully', {
      pages: this.pages.length,
    });
  }

  /**
   * Connect to existing browser via CDP
   */
  async connectViaCDP(endpoint: string): Promise<void> {
    log.info('Connecting to browser via CDP', { endpoint });

    this.browser = await chromium.connectOverCDP(endpoint);
    this.isConnectedViaCDP = true;

    // Get existing contexts
    const contexts = this.browser.contexts();
    if (contexts.length > 0) {
      this.context = contexts[0];
      this.pages = this.context.pages();
      this.currentPageIndex = this.pages.length - 1;
    } else {
      // Create new context if none exists
      this.context = await this.browser.newContext();
      const page = await this.context.newPage();
      this.pages = [page];
      this.currentPageIndex = 0;
    }

    log.info('Connected to browser via CDP', {
      contexts: contexts.length,
      pages: this.pages.length,
    });
  }

  /**
   * Close the browser
   */
  async close(): Promise<void> {
    if (!this.browser) {
      return;
    }

    log.info('Closing browser');

    try {
      if (this.isConnectedViaCDP) {
        // For CDP connections, disconnect without closing the browser process
        // The browser was started externally, so we shouldn't terminate it
        log.info('Disconnecting from CDP browser (not closing)');
        // Note: browser.close() on a CDP connection just disconnects
      } else {
        await this.browser.close();
      }
    } catch (error) {
      log.warn('Error closing browser', { error });
    }

    this.browser = null;
    this.context = null;
    this.pages = [];
    this.currentPageIndex = 0;
    this.isConnectedViaCDP = false;
  }

  /**
   * Create a new tab
   */
  async createTab(url?: string): Promise<Page> {
    await this.ensureBrowser();

    const page = await this.context!.newPage();
    this.setupPageHandlers(page);
    this.pages.push(page);
    this.currentPageIndex = this.pages.length - 1;

    if (url) {
      await page.goto(url);
    }

    log.info('Created new tab', {
      index: this.currentPageIndex,
      url: url || 'about:blank',
    });

    return page;
  }

  /**
   * Close a tab by index
   */
  async closeTab(index?: number): Promise<void> {
    await this.ensureBrowser();

    const targetIndex = index ?? this.currentPageIndex;

    if (targetIndex < 0 || targetIndex >= this.pages.length) {
      throw new Error(`Invalid tab index: ${targetIndex}`);
    }

    const page = this.pages[targetIndex];
    await page.close();
    this.pages.splice(targetIndex, 1);

    // Adjust current index if needed
    if (this.pages.length === 0) {
      // Create a new page if all closed
      const newPage = await this.context!.newPage();
      this.setupPageHandlers(newPage);
      this.pages = [newPage];
      this.currentPageIndex = 0;
    } else if (this.currentPageIndex >= this.pages.length) {
      this.currentPageIndex = this.pages.length - 1;
    }

    log.info('Closed tab', {
      closedIndex: targetIndex,
      remainingTabs: this.pages.length,
      currentIndex: this.currentPageIndex,
    });
  }

  /**
   * Select a tab by index
   */
  async selectTab(index: number): Promise<Page> {
    await this.ensureBrowser();

    if (index < 0 || index >= this.pages.length) {
      throw new Error(`Invalid tab index: ${index}. Available: 0-${this.pages.length - 1}`);
    }

    this.currentPageIndex = index;
    const page = this.pages[index];

    // Bring to front
    await page.bringToFront();

    log.info('Selected tab', { index });

    return page;
  }

  /**
   * Get tab information
   */
  async getTabInfo(): Promise<Array<{ index: number; url: string; title: string; active: boolean }>> {
    await this.ensureBrowser();

    const info = await Promise.all(
      this.pages.map(async (page, index) => ({
        index,
        url: page.url(),
        title: await page.title(),
        active: index === this.currentPageIndex,
      }))
    );

    return info;
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  private getBrowserType(browser: string): BrowserType {
    switch (browser) {
      case 'firefox':
        return firefox;
      case 'webkit':
        return webkit;
      case 'msedge':
        return chromium; // Edge uses Chromium
      case 'chromium':
      default:
        return chromium;
    }
  }

  private parseViewport(size: string): [number, number] {
    const [w, h] = size.split('x').map(Number);
    return [w || 1280, h || 720];
  }

  private getBrowserArgs(config: PlaywrightConfig): string[] {
    const args: string[] = [];

    if (config.browser === 'msedge') {
      args.push('--channel=msedge');
    }

    // Add any additional args here

    return args;
  }

  private setupPageHandlers(page: Page): void {
    page.on('close', () => {
      const index = this.pages.indexOf(page);
      if (index !== -1) {
        this.pages.splice(index, 1);
        if (this.currentPageIndex >= this.pages.length) {
          this.currentPageIndex = Math.max(0, this.pages.length - 1);
        }
      }
    });

    page.on('crash', () => {
      log.error('Page crashed', { url: page.url() });
    });
  }
}

// Export singleton instance
export const browserManager = new BrowserManager();
