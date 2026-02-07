// =============================================================================
// Inspection Tools
// =============================================================================
// Browser inspection tools: snapshot, screenshot, console, network

import { z } from 'zod';
import { toolRouter, type ToolResult } from '../../../router/index.js';
import { browserManager } from '../browser-manager.js';
import { takeSnapshot, formatSnapshot } from '../snapshot.js';
import { log } from '../../../utils/logger.js';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

// Store console messages per page
const consoleMessages: Array<{
  level: string;
  text: string;
  timestamp: Date;
}> = [];

// Store network requests per page
const networkRequests: Array<{
  url: string;
  method: string;
  status?: number;
  type: string;
  timestamp: Date;
}> = [];

// =============================================================================
// browser.snapshot
// =============================================================================

async function handleSnapshot(): Promise<ToolResult> {
  try {
    const page = await browserManager.getCurrentPage();
    
    log.info('Taking accessibility snapshot');
    
    const { snapshot } = await takeSnapshot(page);
    const formatted = formatSnapshot(snapshot);

    return {
      content: [{ type: 'text', text: formatted }],
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error('Snapshot failed', { error: errorMessage });
    
    return {
      content: [{ type: 'text', text: `Snapshot failed: ${errorMessage}` }],
      isError: true,
    };
  }
}

// =============================================================================
// browser.screenshot
// =============================================================================

const screenshotSchema = z.object({
  fullPage: z.boolean().optional().default(false).describe('Capture full scrollable page'),
  selector: z.string().optional().describe('CSS selector of element to screenshot'),
  path: z.string().optional().describe('Path to save screenshot (optional)'),
  type: z.enum(['png', 'jpeg']).optional().default('png'),
  quality: z.number().min(0).max(100).optional().describe('Quality for JPEG (0-100)'),
});

async function handleScreenshot(args: unknown): Promise<ToolResult> {
  const parsed = screenshotSchema.safeParse(args);
  if (!parsed.success) {
    return {
      content: [{ type: 'text', text: `Invalid arguments: ${parsed.error.message}` }],
      isError: true,
    };
  }

  const { fullPage, selector, path: savePath, type, quality } = parsed.data;

  try {
    const page = await browserManager.getCurrentPage();
    
    log.info('Taking screenshot', { fullPage, selector, savePath });

    let screenshotBuffer: Buffer;

    if (selector) {
      const element = await page.$(selector);
      if (!element) {
        return {
          content: [{ type: 'text', text: `Element not found: ${selector}` }],
          isError: true,
        };
      }
      screenshotBuffer = await element.screenshot({
        type,
        quality: type === 'jpeg' ? quality : undefined,
      });
    } else {
      screenshotBuffer = await page.screenshot({
        fullPage,
        type,
        quality: type === 'jpeg' ? quality : undefined,
      });
    }

    // Save to file if path provided
    if (savePath) {
      await mkdir(dirname(savePath), { recursive: true });
      await writeFile(savePath, screenshotBuffer);
      
      return {
        content: [{
          type: 'text',
          text: `Screenshot saved to: ${savePath}`,
        }],
      };
    }

    // Return as base64 image
    const base64 = screenshotBuffer.toString('base64');
    const mimeType = type === 'jpeg' ? 'image/jpeg' : 'image/png';

    return {
      content: [{
        type: 'image',
        data: base64,
        mimeType,
      }],
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error('Screenshot failed', { error: errorMessage });
    
    return {
      content: [{ type: 'text', text: `Screenshot failed: ${errorMessage}` }],
      isError: true,
    };
  }
}

// =============================================================================
// browser.console
// =============================================================================

const consoleSchema = z.object({
  level: z.enum(['error', 'warning', 'info', 'debug']).optional().default('info'),
  clear: z.boolean().optional().default(false).describe('Clear console messages after returning'),
});

async function handleConsole(args: unknown): Promise<ToolResult> {
  const parsed = consoleSchema.safeParse(args);
  if (!parsed.success) {
    return {
      content: [{ type: 'text', text: `Invalid arguments: ${parsed.error.message}` }],
      isError: true,
    };
  }

  const { level, clear } = parsed.data;

  // Filter messages by level
  const levelOrder = ['error', 'warning', 'info', 'debug'];
  const maxLevel = levelOrder.indexOf(level);
  
  const filtered = consoleMessages.filter(msg => {
    const msgLevel = levelOrder.indexOf(msg.level);
    return msgLevel <= maxLevel;
  });

  let output = `# Console Messages (${filtered.length})\n\n`;

  if (filtered.length === 0) {
    output += 'No console messages captured.\n';
  } else {
    for (const msg of filtered) {
      const levelIcon = {
        error: '[ERROR]',
        warning: '[WARN]',
        info: '[INFO]',
        debug: '[DEBUG]',
      }[msg.level] ?? '[LOG]';
      
      output += `${levelIcon} ${msg.text}\n`;
    }
  }

  if (clear) {
    consoleMessages.length = 0;
    output += '\n(Console cleared)';
  }

  return {
    content: [{ type: 'text', text: output }],
  };
}

// =============================================================================
// browser.network
// =============================================================================

const networkSchema = z.object({
  includeStatic: z.boolean().optional().default(false).describe('Include static resources'),
  clear: z.boolean().optional().default(false).describe('Clear network log after returning'),
});

async function handleNetwork(args: unknown): Promise<ToolResult> {
  const parsed = networkSchema.safeParse(args);
  if (!parsed.success) {
    return {
      content: [{ type: 'text', text: `Invalid arguments: ${parsed.error.message}` }],
      isError: true,
    };
  }

  const { includeStatic, clear } = parsed.data;

  // Filter out static resources if not requested
  const staticTypes = ['image', 'stylesheet', 'font', 'media'];
  const filtered = includeStatic 
    ? networkRequests 
    : networkRequests.filter(req => !staticTypes.includes(req.type));

  let output = `# Network Requests (${filtered.length})\n\n`;

  if (filtered.length === 0) {
    output += 'No network requests captured.\n';
  } else {
    for (const req of filtered) {
      const statusIcon = req.status 
        ? (req.status >= 400 ? '[FAIL]' : '[OK]')
        : '[PENDING]';
      
      output += `${statusIcon} ${req.method} ${req.url}`;
      if (req.status) {
        output += ` (${req.status})`;
      }
      output += '\n';
    }
  }

  if (clear) {
    networkRequests.length = 0;
    output += '\n(Network log cleared)';
  }

  return {
    content: [{ type: 'text', text: output }],
  };
}

// =============================================================================
// browser.evaluate
// =============================================================================

const evaluateSchema = z.object({
  code: z.string().describe('JavaScript code to evaluate'),
  selector: z.string().optional().describe('Element to pass to the function'),
});

async function handleEvaluate(args: unknown): Promise<ToolResult> {
  const parsed = evaluateSchema.safeParse(args);
  if (!parsed.success) {
    return {
      content: [{ type: 'text', text: `Invalid arguments: ${parsed.error.message}` }],
      isError: true,
    };
  }

  const { code, selector } = parsed.data;

  try {
    const page = await browserManager.getCurrentPage();
    
    log.info('Evaluating JavaScript', { codeLength: code.length, selector });

    let result: unknown;

    if (selector) {
      const element = await page.$(selector);
      if (!element) {
        return {
          content: [{ type: 'text', text: `Element not found: ${selector}` }],
          isError: true,
        };
      }
      // Evaluate with element using evaluateHandle for element passing
      result = await element.evaluate((el, jsCode) => {
        // eslint-disable-next-line no-eval
        const fn = eval(`(${jsCode})`);
        return fn(el);
      }, code);
    } else {
      // Evaluate in page context
      result = await page.evaluate((jsCode) => {
        // eslint-disable-next-line no-eval
        const fn = eval(`(${jsCode})`);
        return typeof fn === 'function' ? fn() : fn;
      }, code);
    }

    const output = typeof result === 'undefined' 
      ? 'undefined'
      : JSON.stringify(result, null, 2);

    return {
      content: [{ type: 'text', text: `Result:\n${output}` }],
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error('Evaluate failed', { error: errorMessage });
    
    return {
      content: [{ type: 'text', text: `Evaluate failed: ${errorMessage}` }],
      isError: true,
    };
  }
}

// =============================================================================
// browser.html
// =============================================================================

const htmlSchema = z.object({
  selector: z.string().optional().describe('CSS selector (default: body)'),
  outer: z.boolean().optional().default(false).describe('Include outer HTML'),
});

async function handleHtml(args: unknown): Promise<ToolResult> {
  const parsed = htmlSchema.safeParse(args);
  if (!parsed.success) {
    return {
      content: [{ type: 'text', text: `Invalid arguments: ${parsed.error.message}` }],
      isError: true,
    };
  }

  const { selector = 'body', outer } = parsed.data;

  try {
    const page = await browserManager.getCurrentPage();
    
    log.info('Getting HTML', { selector, outer });

    const element = await page.$(selector);
    if (!element) {
      return {
        content: [{ type: 'text', text: `Element not found: ${selector}` }],
        isError: true,
      };
    }

    const html = outer 
      ? await element.evaluate(el => el.outerHTML)
      : await element.evaluate(el => el.innerHTML);

    // Truncate if too long
    const maxLength = 50000;
    const truncated = html.length > maxLength 
      ? html.substring(0, maxLength) + '\n... (truncated)'
      : html;

    return {
      content: [{ type: 'text', text: truncated }],
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error('Get HTML failed', { error: errorMessage });
    
    return {
      content: [{ type: 'text', text: `Get HTML failed: ${errorMessage}` }],
      isError: true,
    };
  }
}

// =============================================================================
// browser.url
// =============================================================================

async function handleUrl(): Promise<ToolResult> {
  try {
    const page = await browserManager.getCurrentPage();
    const url = page.url();
    const title = await page.title();

    return {
      content: [{
        type: 'text',
        text: `URL: ${url}\nTitle: ${title}`,
      }],
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    return {
      content: [{ type: 'text', text: `Get URL failed: ${errorMessage}` }],
      isError: true,
    };
  }
}

// =============================================================================
// Register Tools
// =============================================================================

export function registerInspectionTools(): void {
  toolRouter.registerTool({
    id: 'browser.snapshot',
    category: 'browser',
    name: 'Page Snapshot',
    description: 'Get accessibility snapshot of the page (better than screenshot for understanding page structure)',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    handler: handleSnapshot,
    keywords: ['snapshot', 'accessibility', 'tree', 'structure', 'elements', 'page'],
  });

  toolRouter.registerTool({
    id: 'browser.screenshot',
    category: 'browser',
    name: 'Screenshot',
    description: 'Take a screenshot of the page or element',
    inputSchema: {
      type: 'object',
      properties: {
        fullPage: { type: 'boolean', description: 'Capture full scrollable page' },
        selector: { type: 'string', description: 'CSS selector of element to screenshot' },
        path: { type: 'string', description: 'Path to save screenshot (returns base64 if not provided)' },
        type: { type: 'string', enum: ['png', 'jpeg'], description: 'Image format' },
        quality: { type: 'number', description: 'JPEG quality (0-100)' },
      },
    },
    handler: handleScreenshot,
    keywords: ['screenshot', 'capture', 'image', 'photo', 'picture', 'save'],
  });

  toolRouter.registerTool({
    id: 'browser.console',
    category: 'browser',
    name: 'Console Messages',
    description: 'Get browser console messages (errors, warnings, logs)',
    inputSchema: {
      type: 'object',
      properties: {
        level: { type: 'string', enum: ['error', 'warning', 'info', 'debug'], description: 'Minimum level to return' },
        clear: { type: 'boolean', description: 'Clear console after returning' },
      },
    },
    handler: handleConsole,
    keywords: ['console', 'log', 'error', 'warning', 'debug', 'messages'],
  });

  toolRouter.registerTool({
    id: 'browser.network',
    category: 'browser',
    name: 'Network Requests',
    description: 'Get network requests made by the page',
    inputSchema: {
      type: 'object',
      properties: {
        includeStatic: { type: 'boolean', description: 'Include static resources (images, CSS, fonts)' },
        clear: { type: 'boolean', description: 'Clear network log after returning' },
      },
    },
    handler: handleNetwork,
    keywords: ['network', 'requests', 'api', 'fetch', 'xhr', 'http'],
  });

  toolRouter.registerTool({
    id: 'browser.evaluate',
    category: 'browser',
    name: 'Evaluate JavaScript',
    description: 'Execute JavaScript code in the page context',
    inputSchema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'JavaScript code to evaluate (can be a function expression)' },
        selector: { type: 'string', description: 'Element to pass to the function' },
      },
      required: ['code'],
    },
    handler: handleEvaluate,
    keywords: ['evaluate', 'javascript', 'js', 'execute', 'run', 'script'],
  });

  toolRouter.registerTool({
    id: 'browser.html',
    category: 'browser',
    name: 'Get HTML',
    description: 'Get HTML content of an element',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector (default: body)' },
        outer: { type: 'boolean', description: 'Include outer HTML' },
      },
    },
    handler: handleHtml,
    keywords: ['html', 'content', 'source', 'dom', 'element'],
  });

  toolRouter.registerTool({
    id: 'browser.url',
    category: 'browser',
    name: 'Get Current URL',
    description: 'Get the current page URL and title',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    handler: handleUrl,
    keywords: ['url', 'address', 'location', 'title', 'current'],
  });

  log.debug('Inspection tools registered');
}

// =============================================================================
// Setup Console/Network Capture
// =============================================================================

export async function setupPageCapture(): Promise<void> {
  try {
    const page = await browserManager.getCurrentPage();

    // Capture console messages
    page.on('console', (msg) => {
      consoleMessages.push({
        level: msg.type(),
        text: msg.text(),
        timestamp: new Date(),
      });
      // Keep only last 1000 messages
      if (consoleMessages.length > 1000) {
        consoleMessages.shift();
      }
    });

    // Capture network requests
    page.on('request', (request) => {
      networkRequests.push({
        url: request.url(),
        method: request.method(),
        type: request.resourceType(),
        timestamp: new Date(),
      });
      // Keep only last 500 requests
      if (networkRequests.length > 500) {
        networkRequests.shift();
      }
    });

    page.on('response', (response) => {
      const req = networkRequests.find(r => r.url === response.url() && !r.status);
      if (req) {
        req.status = response.status();
      }
    });

    log.debug('Page capture setup complete');
  } catch (error) {
    log.warn('Failed to setup page capture', { error });
  }
}
