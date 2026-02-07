// =============================================================================
// Tab Management Tools
// =============================================================================
// Browser tab tools: list, create, close, select

import { z } from 'zod';
import { toolRouter, type ToolResult } from '../../../router/index.js';
import { browserManager } from '../browser-manager.js';
import { log } from '../../../utils/logger.js';

// =============================================================================
// browser.tabs.list
// =============================================================================

async function handleTabsList(): Promise<ToolResult> {
  try {
    const tabs = await browserManager.getTabInfo();

    let output = `# Open Tabs (${tabs.length})\n\n`;

    for (const tab of tabs) {
      const activeMarker = tab.active ? ' [ACTIVE]' : '';
      output += `[${tab.index}]${activeMarker} ${tab.title}\n`;
      output += `    ${tab.url}\n\n`;
    }

    output += '---\n';
    output += 'Use browser.tabs.select to switch tabs, browser.tabs.create to open new tab, browser.tabs.close to close a tab.';

    return {
      content: [{ type: 'text', text: output }],
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error('List tabs failed', { error: errorMessage });
    
    return {
      content: [{ type: 'text', text: `List tabs failed: ${errorMessage}` }],
      isError: true,
    };
  }
}

// =============================================================================
// browser.tabs.create
// =============================================================================

const createTabSchema = z.object({
  url: z.string().optional().describe('URL to open in new tab (default: about:blank)'),
});

async function handleTabsCreate(args: unknown): Promise<ToolResult> {
  const parsed = createTabSchema.safeParse(args);
  if (!parsed.success) {
    return {
      content: [{ type: 'text', text: `Invalid arguments: ${parsed.error.message}` }],
      isError: true,
    };
  }

  const { url } = parsed.data;

  try {
    log.info('Creating new tab', { url });
    
    const page = await browserManager.createTab(url);
    const index = browserManager.getCurrentPageIndex();
    const title = await page.title();

    return {
      content: [{
        type: 'text',
        text: `Created new tab [${index}]: ${url || 'about:blank'}\nTitle: ${title}`,
      }],
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error('Create tab failed', { error: errorMessage });
    
    return {
      content: [{ type: 'text', text: `Create tab failed: ${errorMessage}` }],
      isError: true,
    };
  }
}

// =============================================================================
// browser.tabs.close
// =============================================================================

const closeTabSchema = z.object({
  index: z.number().optional().describe('Tab index to close (default: current tab)'),
});

async function handleTabsClose(args: unknown): Promise<ToolResult> {
  const parsed = closeTabSchema.safeParse(args);
  if (!parsed.success) {
    return {
      content: [{ type: 'text', text: `Invalid arguments: ${parsed.error.message}` }],
      isError: true,
    };
  }

  const { index } = parsed.data;

  try {
    log.info('Closing tab', { index });
    
    await browserManager.closeTab(index);
    const remainingTabs = (await browserManager.getPages()).length;
    const currentIndex = browserManager.getCurrentPageIndex();

    return {
      content: [{
        type: 'text',
        text: `Closed tab${index !== undefined ? ` [${index}]` : ' (current)'}. ${remainingTabs} tab(s) remaining. Current tab: [${currentIndex}]`,
      }],
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error('Close tab failed', { error: errorMessage });
    
    return {
      content: [{ type: 'text', text: `Close tab failed: ${errorMessage}` }],
      isError: true,
    };
  }
}

// =============================================================================
// browser.tabs.select
// =============================================================================

const selectTabSchema = z.object({
  index: z.number().describe('Tab index to select'),
});

async function handleTabsSelect(args: unknown): Promise<ToolResult> {
  const parsed = selectTabSchema.safeParse(args);
  if (!parsed.success) {
    return {
      content: [{ type: 'text', text: `Invalid arguments: ${parsed.error.message}` }],
      isError: true,
    };
  }

  const { index } = parsed.data;

  try {
    log.info('Selecting tab', { index });
    
    const page = await browserManager.selectTab(index);
    const url = page.url();
    const title = await page.title();

    return {
      content: [{
        type: 'text',
        text: `Selected tab [${index}]: ${title}\nURL: ${url}`,
      }],
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error('Select tab failed', { error: errorMessage });
    
    return {
      content: [{ type: 'text', text: `Select tab failed: ${errorMessage}` }],
      isError: true,
    };
  }
}

// =============================================================================
// Register Tools
// =============================================================================

export function registerTabTools(): void {
  toolRouter.registerTool({
    id: 'browser.tabs.list',
    category: 'browser.tabs',
    name: 'List Tabs',
    description: 'List all open browser tabs',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    handler: handleTabsList,
    keywords: ['tabs', 'list', 'open', 'windows'],
  });

  toolRouter.registerTool({
    id: 'browser.tabs.create',
    category: 'browser.tabs',
    name: 'Create Tab',
    description: 'Open a new browser tab',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to open (default: about:blank)' },
      },
    },
    handler: handleTabsCreate,
    keywords: ['tab', 'new', 'open', 'create'],
  });

  toolRouter.registerTool({
    id: 'browser.tabs.close',
    category: 'browser.tabs',
    name: 'Close Tab',
    description: 'Close a browser tab',
    inputSchema: {
      type: 'object',
      properties: {
        index: { type: 'number', description: 'Tab index to close (default: current)' },
      },
    },
    handler: handleTabsClose,
    keywords: ['tab', 'close', 'remove', 'delete'],
  });

  toolRouter.registerTool({
    id: 'browser.tabs.select',
    category: 'browser.tabs',
    name: 'Select Tab',
    description: 'Switch to a different browser tab',
    inputSchema: {
      type: 'object',
      properties: {
        index: { type: 'number', description: 'Tab index to select' },
      },
      required: ['index'],
    },
    handler: handleTabsSelect,
    keywords: ['tab', 'switch', 'select', 'focus', 'activate'],
  });

  log.debug('Tab tools registered');
}
