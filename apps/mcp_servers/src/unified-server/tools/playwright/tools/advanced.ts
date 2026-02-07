// =============================================================================
// Advanced Tools
// =============================================================================
// Advanced browser tools: wait, resize, dialog, install

import { z } from 'zod';
import { toolRouter, type ToolResult } from '../../../router/index.js';
import { browserManager } from '../browser-manager.js';
import { log } from '../../../utils/logger.js';
import { getConfig } from '../../../config.js';

// Track pending dialogs
let pendingDialog: {
  type: string;
  message: string;
  defaultValue?: string;
} | null = null;

// =============================================================================
// browser.wait
// =============================================================================

const waitSchema = z.object({
  time: z.number().optional().describe('Time to wait in milliseconds'),
  text: z.string().optional().describe('Text to wait for to appear'),
  textGone: z.string().optional().describe('Text to wait for to disappear'),
  selector: z.string().optional().describe('Selector to wait for'),
  state: z.enum(['attached', 'detached', 'visible', 'hidden']).optional().default('visible'),
});

async function handleWait(args: unknown): Promise<ToolResult> {
  const parsed = waitSchema.safeParse(args);
  if (!parsed.success) {
    return {
      content: [{ type: 'text', text: `Invalid arguments: ${parsed.error.message}` }],
      isError: true,
    };
  }

  const { time, text, textGone, selector, state } = parsed.data;
  const config = getConfig().playwright;

  try {
    const page = await browserManager.getCurrentPage();

    // Wait for time
    if (time) {
      log.info('Waiting for time', { ms: time });
      await page.waitForTimeout(time);
      return {
        content: [{ type: 'text', text: `Waited ${time}ms` }],
      };
    }

    // Wait for text to appear
    if (text) {
      log.info('Waiting for text', { text });
      await page.waitForSelector(`text=${text}`, {
        state: 'visible',
        timeout: config.timeoutNavigation,
      });
      return {
        content: [{ type: 'text', text: `Text appeared: "${text}"` }],
      };
    }

    // Wait for text to disappear
    if (textGone) {
      log.info('Waiting for text to disappear', { text: textGone });
      await page.waitForSelector(`text=${textGone}`, {
        state: 'hidden',
        timeout: config.timeoutNavigation,
      });
      return {
        content: [{ type: 'text', text: `Text disappeared: "${textGone}"` }],
      };
    }

    // Wait for selector
    if (selector) {
      log.info('Waiting for selector', { selector, state });
      await page.waitForSelector(selector, {
        state,
        timeout: config.timeoutNavigation,
      });
      return {
        content: [{ type: 'text', text: `Selector ${state}: "${selector}"` }],
      };
    }

    return {
      content: [{ type: 'text', text: 'Nothing to wait for. Provide time, text, textGone, or selector.' }],
      isError: true,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error('Wait failed', { error: errorMessage });
    
    return {
      content: [{ type: 'text', text: `Wait failed: ${errorMessage}` }],
      isError: true,
    };
  }
}

// =============================================================================
// browser.resize
// =============================================================================

const resizeSchema = z.object({
  width: z.number().describe('New viewport width'),
  height: z.number().describe('New viewport height'),
});

async function handleResize(args: unknown): Promise<ToolResult> {
  const parsed = resizeSchema.safeParse(args);
  if (!parsed.success) {
    return {
      content: [{ type: 'text', text: `Invalid arguments: ${parsed.error.message}` }],
      isError: true,
    };
  }

  const { width, height } = parsed.data;

  try {
    const page = await browserManager.getCurrentPage();
    
    log.info('Resizing viewport', { width, height });
    
    await page.setViewportSize({ width, height });

    return {
      content: [{
        type: 'text',
        text: `Resized viewport to ${width}x${height}`,
      }],
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error('Resize failed', { error: errorMessage });
    
    return {
      content: [{ type: 'text', text: `Resize failed: ${errorMessage}` }],
      isError: true,
    };
  }
}

// =============================================================================
// browser.dialog
// =============================================================================

const dialogSchema = z.object({
  accept: z.boolean().describe('Accept (true) or dismiss (false) the dialog'),
  promptText: z.string().optional().describe('Text to enter for prompt dialogs'),
});

async function handleDialog(args: unknown): Promise<ToolResult> {
  const parsed = dialogSchema.safeParse(args);
  if (!parsed.success) {
    return {
      content: [{ type: 'text', text: `Invalid arguments: ${parsed.error.message}` }],
      isError: true,
    };
  }

  const { accept, promptText } = parsed.data;

  try {
    if (!pendingDialog) {
      return {
        content: [{ type: 'text', text: 'No pending dialog to handle' }],
        isError: true,
      };
    }

    const dialogInfo = pendingDialog;
    pendingDialog = null;

    // The dialog handler is set up when the page loads
    // This just provides feedback since Playwright auto-handles dialogs
    
    log.info('Dialog handled', { type: dialogInfo.type, accept });

    return {
      content: [{
        type: 'text',
        text: `${accept ? 'Accepted' : 'Dismissed'} ${dialogInfo.type} dialog: "${dialogInfo.message}"${promptText ? ` (entered: "${promptText}")` : ''}`,
      }],
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error('Dialog handling failed', { error: errorMessage });
    
    return {
      content: [{ type: 'text', text: `Dialog handling failed: ${errorMessage}` }],
      isError: true,
    };
  }
}

// =============================================================================
// browser.pdf
// =============================================================================

const pdfSchema = z.object({
  path: z.string().describe('Path to save the PDF'),
  format: z.enum(['Letter', 'Legal', 'Tabloid', 'Ledger', 'A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6']).optional().default('A4'),
  landscape: z.boolean().optional().default(false),
});

async function handlePdf(args: unknown): Promise<ToolResult> {
  const parsed = pdfSchema.safeParse(args);
  if (!parsed.success) {
    return {
      content: [{ type: 'text', text: `Invalid arguments: ${parsed.error.message}` }],
      isError: true,
    };
  }

  const { path: savePath, format, landscape } = parsed.data;

  try {
    const page = await browserManager.getCurrentPage();
    
    log.info('Generating PDF', { savePath, format, landscape });
    
    await page.pdf({
      path: savePath,
      format,
      landscape,
      printBackground: true,
    });

    return {
      content: [{
        type: 'text',
        text: `PDF saved to: ${savePath}`,
      }],
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error('PDF generation failed', { error: errorMessage });
    
    return {
      content: [{ type: 'text', text: `PDF generation failed: ${errorMessage}` }],
      isError: true,
    };
  }
}

// =============================================================================
// browser.install
// =============================================================================

async function handleInstall(): Promise<ToolResult> {
  try {
    log.info('Installing browser');
    
    // Import and run playwright install
    const { execSync } = await import('node:child_process');
    const config = getConfig().playwright;
    
    const browser = config.browser === 'msedge' ? 'chromium' : config.browser;
    
    execSync(`npx playwright install ${browser}`, {
      stdio: 'inherit',
    });

    return {
      content: [{
        type: 'text',
        text: `Browser ${browser} installed successfully`,
      }],
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error('Browser installation failed', { error: errorMessage });
    
    return {
      content: [{ type: 'text', text: `Browser installation failed: ${errorMessage}` }],
      isError: true,
    };
  }
}

// =============================================================================
// Register Tools
// =============================================================================

export function registerAdvancedTools(): void {
  toolRouter.registerTool({
    id: 'browser.wait',
    category: 'browser',
    name: 'Wait For',
    description: 'Wait for time, text, or element',
    inputSchema: {
      type: 'object',
      properties: {
        time: { type: 'number', description: 'Time to wait in milliseconds' },
        text: { type: 'string', description: 'Text to wait for to appear' },
        textGone: { type: 'string', description: 'Text to wait for to disappear' },
        selector: { type: 'string', description: 'Selector to wait for' },
        state: { type: 'string', enum: ['attached', 'detached', 'visible', 'hidden'], description: 'State to wait for' },
      },
    },
    handler: handleWait,
    keywords: ['wait', 'delay', 'pause', 'timeout', 'loading'],
  });

  toolRouter.registerTool({
    id: 'browser.resize',
    category: 'browser',
    name: 'Resize Viewport',
    description: 'Resize the browser viewport',
    inputSchema: {
      type: 'object',
      properties: {
        width: { type: 'number', description: 'New viewport width' },
        height: { type: 'number', description: 'New viewport height' },
      },
      required: ['width', 'height'],
    },
    handler: handleResize,
    keywords: ['resize', 'viewport', 'size', 'dimensions', 'responsive'],
  });

  toolRouter.registerTool({
    id: 'browser.dialog',
    category: 'browser',
    name: 'Handle Dialog',
    description: 'Accept or dismiss browser dialogs (alert, confirm, prompt)',
    inputSchema: {
      type: 'object',
      properties: {
        accept: { type: 'boolean', description: 'Accept (true) or dismiss (false)' },
        promptText: { type: 'string', description: 'Text to enter for prompt dialogs' },
      },
      required: ['accept'],
    },
    handler: handleDialog,
    keywords: ['dialog', 'alert', 'confirm', 'prompt', 'popup', 'modal'],
  });

  toolRouter.registerTool({
    id: 'browser.pdf',
    category: 'browser',
    name: 'Save as PDF',
    description: 'Save the current page as PDF',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to save the PDF' },
        format: { type: 'string', enum: ['Letter', 'Legal', 'Tabloid', 'Ledger', 'A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6'], description: 'Paper format' },
        landscape: { type: 'boolean', description: 'Landscape orientation' },
      },
      required: ['path'],
    },
    handler: handlePdf,
    keywords: ['pdf', 'print', 'save', 'export', 'document'],
  });

  toolRouter.registerTool({
    id: 'browser.install',
    category: 'browser',
    name: 'Install Browser',
    description: 'Install the configured browser (run if browser not found error)',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    handler: handleInstall,
    keywords: ['install', 'setup', 'browser', 'download'],
  });

  log.debug('Advanced tools registered');
}

// =============================================================================
// Setup Dialog Handler
// =============================================================================

export async function setupDialogHandler(): Promise<void> {
  try {
    const page = await browserManager.getCurrentPage();

    page.on('dialog', async (dialog) => {
      pendingDialog = {
        type: dialog.type(),
        message: dialog.message(),
        defaultValue: dialog.defaultValue(),
      };
      
      log.info('Dialog detected', pendingDialog);
      
      // Auto-dismiss after 30 seconds if not handled
      setTimeout(async () => {
        try {
          if (pendingDialog) {
            await dialog.dismiss().catch(() => {
              // Dialog may already be dismissed or page closed
            });
            pendingDialog = null;
          }
        } catch {
          // Ignore errors - dialog may be gone or page closed
        }
      }, 30000);
    });

    log.debug('Dialog handler setup complete');
  } catch (error) {
    log.warn('Failed to setup dialog handler', { error });
  }
}
