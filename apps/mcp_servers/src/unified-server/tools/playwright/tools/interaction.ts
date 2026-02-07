// =============================================================================
// Interaction Tools
// =============================================================================
// Browser interaction tools: click, type, hover, drag, select, press key, etc.

import { z } from 'zod';
import { toolRouter, type ToolResult } from '../../../router/index.js';
import { browserManager } from '../browser-manager.js';
import { log } from '../../../utils/logger.js';
import { getConfig } from '../../../config.js';

// =============================================================================
// browser.click
// =============================================================================

const clickSchema = z.object({
  selector: z.string().describe('CSS selector or text selector for the element'),
  button: z.enum(['left', 'right', 'middle']).optional().default('left'),
  doubleClick: z.boolean().optional().default(false),
  modifiers: z.array(z.enum(['Alt', 'Control', 'Meta', 'Shift'])).optional(),
});

async function handleClick(args: unknown): Promise<ToolResult> {
  const parsed = clickSchema.safeParse(args);
  if (!parsed.success) {
    return {
      content: [{ type: 'text', text: `Invalid arguments: ${parsed.error.message}` }],
      isError: true,
    };
  }

  const { selector, button, doubleClick, modifiers } = parsed.data;
  const config = getConfig().playwright;

  try {
    const page = await browserManager.getCurrentPage();
    
    log.info('Clicking element', { selector, button, doubleClick });

    const clickCount = doubleClick ? 2 : 1;
    
    await page.click(selector, {
      button,
      clickCount,
      modifiers,
      timeout: config.timeoutAction,
    });

    return {
      content: [{
        type: 'text',
        text: `Clicked ${doubleClick ? '(double)' : ''} on: ${selector}`,
      }],
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error('Click failed', { selector, error: errorMessage });
    
    return {
      content: [{ type: 'text', text: `Click failed: ${errorMessage}` }],
      isError: true,
    };
  }
}

// =============================================================================
// browser.type
// =============================================================================

const typeSchema = z.object({
  selector: z.string().describe('CSS selector for the input element'),
  text: z.string().describe('Text to type'),
  clear: z.boolean().optional().default(true).describe('Clear existing content before typing'),
  submit: z.boolean().optional().default(false).describe('Press Enter after typing'),
  slowly: z.boolean().optional().default(false).describe('Type character by character'),
});

async function handleType(args: unknown): Promise<ToolResult> {
  const parsed = typeSchema.safeParse(args);
  if (!parsed.success) {
    return {
      content: [{ type: 'text', text: `Invalid arguments: ${parsed.error.message}` }],
      isError: true,
    };
  }

  const { selector, text, clear, submit, slowly } = parsed.data;
  const config = getConfig().playwright;

  try {
    const page = await browserManager.getCurrentPage();
    
    log.info('Typing into element', { selector, textLength: text.length });

    if (clear) {
      await page.fill(selector, '', { timeout: config.timeoutAction });
    }

    if (slowly) {
      await page.type(selector, text, { delay: 50, timeout: config.timeoutAction });
    } else {
      await page.fill(selector, text, { timeout: config.timeoutAction });
    }

    if (submit) {
      await page.press(selector, 'Enter', { timeout: config.timeoutAction });
    }

    return {
      content: [{
        type: 'text',
        text: `Typed "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}" into: ${selector}${submit ? ' (submitted)' : ''}`,
      }],
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error('Type failed', { selector, error: errorMessage });
    
    return {
      content: [{ type: 'text', text: `Type failed: ${errorMessage}` }],
      isError: true,
    };
  }
}

// =============================================================================
// browser.hover
// =============================================================================

const hoverSchema = z.object({
  selector: z.string().describe('CSS selector for the element'),
});

async function handleHover(args: unknown): Promise<ToolResult> {
  const parsed = hoverSchema.safeParse(args);
  if (!parsed.success) {
    return {
      content: [{ type: 'text', text: `Invalid arguments: ${parsed.error.message}` }],
      isError: true,
    };
  }

  const { selector } = parsed.data;
  const config = getConfig().playwright;

  try {
    const page = await browserManager.getCurrentPage();
    
    log.info('Hovering over element', { selector });
    
    await page.hover(selector, { timeout: config.timeoutAction });

    return {
      content: [{ type: 'text', text: `Hovered over: ${selector}` }],
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error('Hover failed', { selector, error: errorMessage });
    
    return {
      content: [{ type: 'text', text: `Hover failed: ${errorMessage}` }],
      isError: true,
    };
  }
}

// =============================================================================
// browser.select
// =============================================================================

const selectSchema = z.object({
  selector: z.string().describe('CSS selector for the select element'),
  values: z.array(z.string()).describe('Values to select'),
});

async function handleSelect(args: unknown): Promise<ToolResult> {
  const parsed = selectSchema.safeParse(args);
  if (!parsed.success) {
    return {
      content: [{ type: 'text', text: `Invalid arguments: ${parsed.error.message}` }],
      isError: true,
    };
  }

  const { selector, values } = parsed.data;
  const config = getConfig().playwright;

  try {
    const page = await browserManager.getCurrentPage();
    
    log.info('Selecting options', { selector, values });
    
    const selected = await page.selectOption(selector, values, { timeout: config.timeoutAction });

    return {
      content: [{
        type: 'text',
        text: `Selected ${selected.length} option(s) in: ${selector}`,
      }],
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error('Select failed', { selector, error: errorMessage });
    
    return {
      content: [{ type: 'text', text: `Select failed: ${errorMessage}` }],
      isError: true,
    };
  }
}

// =============================================================================
// browser.key
// =============================================================================

const keySchema = z.object({
  key: z.string().describe('Key to press (e.g., "Enter", "Tab", "ArrowDown", "a")'),
  selector: z.string().optional().describe('Optional: element to focus before pressing'),
});

async function handleKey(args: unknown): Promise<ToolResult> {
  const parsed = keySchema.safeParse(args);
  if (!parsed.success) {
    return {
      content: [{ type: 'text', text: `Invalid arguments: ${parsed.error.message}` }],
      isError: true,
    };
  }

  const { key, selector } = parsed.data;
  const config = getConfig().playwright;

  try {
    const page = await browserManager.getCurrentPage();
    
    log.info('Pressing key', { key, selector });

    if (selector) {
      await page.press(selector, key, { timeout: config.timeoutAction });
    } else {
      await page.keyboard.press(key);
    }

    return {
      content: [{ type: 'text', text: `Pressed key: ${key}` }],
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error('Key press failed', { key, error: errorMessage });
    
    return {
      content: [{ type: 'text', text: `Key press failed: ${errorMessage}` }],
      isError: true,
    };
  }
}

// =============================================================================
// browser.drag
// =============================================================================

const dragSchema = z.object({
  sourceSelector: z.string().describe('CSS selector for source element'),
  targetSelector: z.string().describe('CSS selector for target element'),
});

async function handleDrag(args: unknown): Promise<ToolResult> {
  const parsed = dragSchema.safeParse(args);
  if (!parsed.success) {
    return {
      content: [{ type: 'text', text: `Invalid arguments: ${parsed.error.message}` }],
      isError: true,
    };
  }

  const { sourceSelector, targetSelector } = parsed.data;
  const config = getConfig().playwright;

  try {
    const page = await browserManager.getCurrentPage();
    
    log.info('Dragging element', { sourceSelector, targetSelector });
    
    await page.dragAndDrop(sourceSelector, targetSelector, {
      timeout: config.timeoutAction,
    });

    return {
      content: [{
        type: 'text',
        text: `Dragged from "${sourceSelector}" to "${targetSelector}"`,
      }],
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error('Drag failed', { sourceSelector, targetSelector, error: errorMessage });
    
    return {
      content: [{ type: 'text', text: `Drag failed: ${errorMessage}` }],
      isError: true,
    };
  }
}

// =============================================================================
// browser.upload
// =============================================================================

const uploadSchema = z.object({
  selector: z.string().describe('CSS selector for the file input'),
  paths: z.array(z.string()).describe('Absolute paths to files to upload'),
});

async function handleUpload(args: unknown): Promise<ToolResult> {
  const parsed = uploadSchema.safeParse(args);
  if (!parsed.success) {
    return {
      content: [{ type: 'text', text: `Invalid arguments: ${parsed.error.message}` }],
      isError: true,
    };
  }

  const { selector, paths } = parsed.data;
  const config = getConfig().playwright;

  try {
    const page = await browserManager.getCurrentPage();
    
    log.info('Uploading files', { selector, fileCount: paths.length });
    
    await page.setInputFiles(selector, paths, { timeout: config.timeoutAction });

    return {
      content: [{
        type: 'text',
        text: `Uploaded ${paths.length} file(s) to: ${selector}`,
      }],
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error('Upload failed', { selector, error: errorMessage });
    
    return {
      content: [{ type: 'text', text: `Upload failed: ${errorMessage}` }],
      isError: true,
    };
  }
}

// =============================================================================
// browser.fill_form
// =============================================================================

const fillFormSchema = z.object({
  fields: z.array(z.object({
    selector: z.string().describe('CSS selector for the field'),
    value: z.string().describe('Value to fill'),
    type: z.enum(['text', 'select', 'checkbox', 'radio']).optional().default('text'),
  })).describe('Array of fields to fill'),
  submit: z.boolean().optional().default(false).describe('Submit the form after filling'),
  submitSelector: z.string().optional().describe('CSS selector for submit button'),
});

async function handleFillForm(args: unknown): Promise<ToolResult> {
  const parsed = fillFormSchema.safeParse(args);
  if (!parsed.success) {
    return {
      content: [{ type: 'text', text: `Invalid arguments: ${parsed.error.message}` }],
      isError: true,
    };
  }

  const { fields, submit, submitSelector } = parsed.data;
  const config = getConfig().playwright;

  try {
    const page = await browserManager.getCurrentPage();
    
    log.info('Filling form', { fieldCount: fields.length, submit });

    const results: string[] = [];

    for (const field of fields) {
      switch (field.type) {
        case 'select':
          await page.selectOption(field.selector, field.value, { timeout: config.timeoutAction });
          results.push(`Selected "${field.value}" in ${field.selector}`);
          break;
        
        case 'checkbox':
        case 'radio':
          if (field.value === 'true' || field.value === '1') {
            await page.check(field.selector, { timeout: config.timeoutAction });
            results.push(`Checked ${field.selector}`);
          } else {
            await page.uncheck(field.selector, { timeout: config.timeoutAction });
            results.push(`Unchecked ${field.selector}`);
          }
          break;
        
        default:
          await page.fill(field.selector, field.value, { timeout: config.timeoutAction });
          results.push(`Filled ${field.selector}`);
      }
    }

    if (submit) {
      if (submitSelector) {
        await page.click(submitSelector, { timeout: config.timeoutAction });
        results.push(`Clicked submit button: ${submitSelector}`);
      } else {
        // Try to find and click a submit button
        await page.keyboard.press('Enter');
        results.push('Pressed Enter to submit');
      }
    }

    return {
      content: [{
        type: 'text',
        text: `Form filled successfully:\n${results.map(r => `- ${r}`).join('\n')}`,
      }],
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error('Fill form failed', { error: errorMessage });
    
    return {
      content: [{ type: 'text', text: `Fill form failed: ${errorMessage}` }],
      isError: true,
    };
  }
}

// =============================================================================
// browser.scroll
// =============================================================================

const scrollSchema = z.object({
  direction: z.enum(['up', 'down', 'left', 'right']).optional().default('down'),
  amount: z.number().optional().default(300).describe('Pixels to scroll'),
  selector: z.string().optional().describe('Element to scroll (default: page)'),
});

async function handleScroll(args: unknown): Promise<ToolResult> {
  const parsed = scrollSchema.safeParse(args);
  if (!parsed.success) {
    return {
      content: [{ type: 'text', text: `Invalid arguments: ${parsed.error.message}` }],
      isError: true,
    };
  }

  const { direction, amount, selector } = parsed.data;

  try {
    const page = await browserManager.getCurrentPage();
    
    log.info('Scrolling', { direction, amount, selector });

    let deltaX = 0;
    let deltaY = 0;

    switch (direction) {
      case 'up': deltaY = -amount; break;
      case 'down': deltaY = amount; break;
      case 'left': deltaX = -amount; break;
      case 'right': deltaX = amount; break;
    }

    if (selector) {
      const element = await page.$(selector);
      if (element) {
        await element.evaluate((el, { dx, dy }) => {
          el.scrollBy(dx, dy);
        }, { dx: deltaX, dy: deltaY });
      }
    } else {
      await page.mouse.wheel(deltaX, deltaY);
    }

    return {
      content: [{
        type: 'text',
        text: `Scrolled ${direction} by ${amount}px`,
      }],
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error('Scroll failed', { error: errorMessage });
    
    return {
      content: [{ type: 'text', text: `Scroll failed: ${errorMessage}` }],
      isError: true,
    };
  }
}

// =============================================================================
// Register Tools
// =============================================================================

export function registerInteractionTools(): void {
  toolRouter.registerTool({
    id: 'browser.click',
    category: 'browser',
    name: 'Click',
    description: 'Click an element on the page',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector or text selector for the element' },
        button: { type: 'string', enum: ['left', 'right', 'middle'], description: 'Mouse button to use' },
        doubleClick: { type: 'boolean', description: 'Perform double-click instead of single' },
        modifiers: { type: 'array', items: { type: 'string' }, description: 'Modifier keys (Alt, Control, Meta, Shift)' },
      },
      required: ['selector'],
    },
    handler: handleClick,
    keywords: ['click', 'press', 'tap', 'button', 'link', 'element'],
  });

  toolRouter.registerTool({
    id: 'browser.type',
    category: 'browser',
    name: 'Type Text',
    description: 'Type text into an input field',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector for the input element' },
        text: { type: 'string', description: 'Text to type' },
        clear: { type: 'boolean', description: 'Clear existing content before typing (default: true)' },
        submit: { type: 'boolean', description: 'Press Enter after typing (default: false)' },
        slowly: { type: 'boolean', description: 'Type character by character for key handlers' },
      },
      required: ['selector', 'text'],
    },
    handler: handleType,
    keywords: ['type', 'input', 'text', 'enter', 'write', 'fill', 'field'],
  });

  toolRouter.registerTool({
    id: 'browser.hover',
    category: 'browser',
    name: 'Hover',
    description: 'Hover over an element',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector for the element' },
      },
      required: ['selector'],
    },
    handler: handleHover,
    keywords: ['hover', 'mouse', 'over', 'tooltip'],
  });

  toolRouter.registerTool({
    id: 'browser.select',
    category: 'browser',
    name: 'Select Option',
    description: 'Select option(s) in a dropdown/select element',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector for the select element' },
        values: { type: 'array', items: { type: 'string' }, description: 'Values to select' },
      },
      required: ['selector', 'values'],
    },
    handler: handleSelect,
    keywords: ['select', 'dropdown', 'option', 'choose', 'pick'],
  });

  toolRouter.registerTool({
    id: 'browser.key',
    category: 'browser',
    name: 'Press Key',
    description: 'Press a keyboard key',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Key to press (e.g., "Enter", "Tab", "ArrowDown")' },
        selector: { type: 'string', description: 'Optional: element to focus before pressing' },
      },
      required: ['key'],
    },
    handler: handleKey,
    keywords: ['key', 'keyboard', 'press', 'enter', 'tab', 'escape', 'arrow'],
  });

  toolRouter.registerTool({
    id: 'browser.drag',
    category: 'browser',
    name: 'Drag and Drop',
    description: 'Drag an element to another element',
    inputSchema: {
      type: 'object',
      properties: {
        sourceSelector: { type: 'string', description: 'CSS selector for source element' },
        targetSelector: { type: 'string', description: 'CSS selector for target element' },
      },
      required: ['sourceSelector', 'targetSelector'],
    },
    handler: handleDrag,
    keywords: ['drag', 'drop', 'move', 'reorder'],
  });

  toolRouter.registerTool({
    id: 'browser.upload',
    category: 'browser',
    name: 'Upload Files',
    description: 'Upload file(s) to a file input',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector for the file input' },
        paths: { type: 'array', items: { type: 'string' }, description: 'Absolute paths to files' },
      },
      required: ['selector', 'paths'],
    },
    handler: handleUpload,
    keywords: ['upload', 'file', 'attach', 'browse'],
  });

  toolRouter.registerTool({
    id: 'browser.fill_form',
    category: 'browser',
    name: 'Fill Form',
    description: 'Fill multiple form fields at once',
    inputSchema: {
      type: 'object',
      properties: {
        fields: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              selector: { type: 'string', description: 'CSS selector for the field' },
              value: { type: 'string', description: 'Value to fill' },
              type: { type: 'string', enum: ['text', 'select', 'checkbox', 'radio'], description: 'Field type' },
            },
            required: ['selector', 'value'],
          },
          description: 'Array of fields to fill',
        },
        submit: { type: 'boolean', description: 'Submit form after filling' },
        submitSelector: { type: 'string', description: 'CSS selector for submit button' },
      },
      required: ['fields'],
    },
    handler: handleFillForm,
    keywords: ['form', 'fill', 'input', 'submit', 'login', 'register', 'signup'],
  });

  toolRouter.registerTool({
    id: 'browser.scroll',
    category: 'browser',
    name: 'Scroll',
    description: 'Scroll the page or an element',
    inputSchema: {
      type: 'object',
      properties: {
        direction: { type: 'string', enum: ['up', 'down', 'left', 'right'], description: 'Scroll direction' },
        amount: { type: 'number', description: 'Pixels to scroll (default: 300)' },
        selector: { type: 'string', description: 'Element to scroll (default: page)' },
      },
    },
    handler: handleScroll,
    keywords: ['scroll', 'page', 'down', 'up'],
  });

  log.debug('Interaction tools registered');
}
