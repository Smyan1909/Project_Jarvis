// =============================================================================
// Navigation Tools
// =============================================================================
// Browser navigation tools: navigate, back, close

import { z } from 'zod';
import { toolRouter, type ToolResult } from '../../../router/index.js';
import { browserManager } from '../browser-manager.js';
import { log } from '../../../utils/logger.js';
import { getConfig } from '../../../config.js';

// =============================================================================
// browser.navigate
// =============================================================================

const navigateSchema = z.object({
  url: z.string().url('Must be a valid URL'),
});

async function handleNavigate(args: unknown): Promise<ToolResult> {
  const parsed = navigateSchema.safeParse(args);
  if (!parsed.success) {
    return {
      content: [{ type: 'text', text: `Invalid arguments: ${parsed.error.message}` }],
      isError: true,
    };
  }

  const { url } = parsed.data;
  const config = getConfig().playwright;

  try {
    const page = await browserManager.getCurrentPage();
    
    log.info('Navigating to URL', { url });
    
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: config.timeoutNavigation,
    });

    const title = await page.title();
    const finalUrl = page.url();

    return {
      content: [{
        type: 'text',
        text: `Navigated to: ${finalUrl}\nTitle: ${title}`,
      }],
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error('Navigation failed', { url, error: errorMessage });
    
    return {
      content: [{ type: 'text', text: `Navigation failed: ${errorMessage}` }],
      isError: true,
    };
  }
}

// =============================================================================
// browser.back
// =============================================================================

async function handleNavigateBack(): Promise<ToolResult> {
  try {
    const page = await browserManager.getCurrentPage();
    
    log.info('Navigating back');
    
    await page.goBack({
      waitUntil: 'domcontentloaded',
    });

    const title = await page.title();
    const url = page.url();

    return {
      content: [{
        type: 'text',
        text: `Navigated back to: ${url}\nTitle: ${title}`,
      }],
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error('Navigate back failed', { error: errorMessage });
    
    return {
      content: [{ type: 'text', text: `Navigate back failed: ${errorMessage}` }],
      isError: true,
    };
  }
}

// =============================================================================
// browser.forward
// =============================================================================

async function handleNavigateForward(): Promise<ToolResult> {
  try {
    const page = await browserManager.getCurrentPage();
    
    log.info('Navigating forward');
    
    await page.goForward({
      waitUntil: 'domcontentloaded',
    });

    const title = await page.title();
    const url = page.url();

    return {
      content: [{
        type: 'text',
        text: `Navigated forward to: ${url}\nTitle: ${title}`,
      }],
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error('Navigate forward failed', { error: errorMessage });
    
    return {
      content: [{ type: 'text', text: `Navigate forward failed: ${errorMessage}` }],
      isError: true,
    };
  }
}

// =============================================================================
// browser.reload
// =============================================================================

async function handleReload(): Promise<ToolResult> {
  try {
    const page = await browserManager.getCurrentPage();
    
    log.info('Reloading page');
    
    await page.reload({
      waitUntil: 'domcontentloaded',
    });

    const title = await page.title();
    const url = page.url();

    return {
      content: [{
        type: 'text',
        text: `Reloaded: ${url}\nTitle: ${title}`,
      }],
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error('Reload failed', { error: errorMessage });
    
    return {
      content: [{ type: 'text', text: `Reload failed: ${errorMessage}` }],
      isError: true,
    };
  }
}

// =============================================================================
// browser.close
// =============================================================================

async function handleClose(): Promise<ToolResult> {
  try {
    log.info('Closing browser');
    
    await browserManager.close();

    return {
      content: [{ type: 'text', text: 'Browser closed successfully' }],
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error('Close browser failed', { error: errorMessage });
    
    return {
      content: [{ type: 'text', text: `Close failed: ${errorMessage}` }],
      isError: true,
    };
  }
}

// =============================================================================
// Register Tools
// =============================================================================

export function registerNavigationTools(): void {
  toolRouter.registerTool({
    id: 'browser.navigate',
    category: 'browser',
    name: 'Navigate',
    description: 'Navigate to a URL in the browser',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The URL to navigate to (must be a valid URL)',
        },
      },
      required: ['url'],
    },
    handler: handleNavigate,
    keywords: ['navigate', 'go', 'open', 'url', 'website', 'page', 'browse', 'visit'],
  });

  toolRouter.registerTool({
    id: 'browser.back',
    category: 'browser',
    name: 'Go Back',
    description: 'Navigate back to the previous page in history',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    handler: handleNavigateBack,
    keywords: ['back', 'previous', 'history'],
  });

  toolRouter.registerTool({
    id: 'browser.forward',
    category: 'browser',
    name: 'Go Forward',
    description: 'Navigate forward to the next page in history',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    handler: handleNavigateForward,
    keywords: ['forward', 'next', 'history'],
  });

  toolRouter.registerTool({
    id: 'browser.reload',
    category: 'browser',
    name: 'Reload',
    description: 'Reload the current page',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    handler: handleReload,
    keywords: ['reload', 'refresh', 'update'],
  });

  toolRouter.registerTool({
    id: 'browser.close',
    category: 'browser',
    name: 'Close Browser',
    description: 'Close the browser completely',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    handler: handleClose,
    keywords: ['close', 'quit', 'exit', 'shutdown'],
  });

  log.debug('Navigation tools registered');
}
