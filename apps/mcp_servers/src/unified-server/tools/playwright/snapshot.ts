// =============================================================================
// Accessibility Snapshot
// =============================================================================
// Handles creating and formatting accessibility snapshots of pages

import type { Page } from 'playwright';
import { log } from '../../utils/logger.js';

/**
 * Accessibility node structure
 */
export interface AccessibilityNode {
  role: string;
  name: string;
  value?: string;
  description?: string;
  disabled?: boolean;
  expanded?: boolean;
  focused?: boolean;
  selected?: boolean;
  checked?: boolean | 'mixed';
  pressed?: boolean | 'mixed';
  level?: number;
  children?: AccessibilityNode[];
}

/**
 * Snapshot options
 */
export interface SnapshotOptions {
  /** Include only interesting nodes (default: true) */
  interestingOnly?: boolean;
}

/**
 * Element reference for interaction
 */
export interface ElementRef {
  /** Unique reference ID for this element */
  ref: string;
  /** Role of the element */
  role: string;
  /** Accessible name */
  name: string;
  /** Element description */
  description?: string;
}

/**
 * Take a snapshot of the page using aria-snapshot
 * 
 * This creates a structured view of the page that's useful for LLM understanding
 */
export async function takeSnapshot(
  page: Page,
  _options: SnapshotOptions = {}
): Promise<{ snapshot: AccessibilityNode | null; refs: Map<string, ElementRef> }> {
  try {
    // Use Playwright's ariaSnapshot for a structured view
    const ariaSnapshot = await page.locator('body').ariaSnapshot();
    
    // Parse the aria snapshot into our structure
    const snapshot = parseAriaSnapshot(ariaSnapshot);
    
    // Build ref map for element identification
    const refs = new Map<string, ElementRef>();
    if (snapshot) {
      buildRefMap(snapshot, refs);
    }

    log.debug('Took accessibility snapshot', {
      hasSnapshot: !!snapshot,
      refCount: refs.size,
    });

    return { snapshot, refs };
  } catch (error) {
    log.error('Failed to take accessibility snapshot', { error });
    return { snapshot: null, refs: new Map() };
  }
}

/**
 * Parse aria snapshot string into structured node
 */
function parseAriaSnapshot(ariaSnapshot: string): AccessibilityNode | null {
  if (!ariaSnapshot) {
    return null;
  }

  // The aria snapshot is a YAML-like structure
  // For now, we'll create a simple text representation
  const lines = ariaSnapshot.split('\n').filter(line => line.trim());
  
  if (lines.length === 0) {
    return null;
  }

  // Create a root node with the snapshot as content
  return {
    role: 'document',
    name: 'Page Content',
    children: lines.map((line, index) => ({
      role: 'item',
      name: line.trim(),
      value: `ref_${index + 1}`,
    })),
  };
}

/**
 * Format snapshot as readable text
 */
export function formatSnapshot(snapshot: AccessibilityNode | null): string {
  if (!snapshot) {
    return 'No accessibility snapshot available. The page may be empty or not fully loaded.';
  }

  const lines: string[] = [];
  lines.push('# Page Accessibility Snapshot\n');
  formatNode(snapshot, lines, 0);
  lines.push('\n---');
  lines.push('Use element selectors or text content to interact with elements via browser tools.');

  return lines.join('\n');
}

/**
 * Format a single node
 */
function formatNode(node: AccessibilityNode, lines: string[], depth: number, refCounter = { value: 1 }): void {
  const indent = '  '.repeat(depth);
  const ref = `ref_${refCounter.value++}`;

  // Build node description
  let line = `${indent}[${ref}] ${node.role}`;

  if (node.name) {
    line += `: "${truncate(node.name, 50)}"`;
  }

  if (node.value) {
    line += ` = "${truncate(node.value, 30)}"`;
  }

  // Add state indicators
  const states: string[] = [];
  if (node.disabled) states.push('disabled');
  if (node.focused) states.push('focused');
  if (node.selected) states.push('selected');
  if (node.checked === true) states.push('checked');
  if (node.checked === 'mixed') states.push('mixed');
  if (node.expanded === true) states.push('expanded');
  if (node.expanded === false) states.push('collapsed');

  if (states.length > 0) {
    line += ` (${states.join(', ')})`;
  }

  lines.push(line);

  // Recurse into children
  if (node.children) {
    for (const child of node.children) {
      formatNode(child, lines, depth + 1, refCounter);
    }
  }
}

/**
 * Build a map of element references for interaction
 */
function buildRefMap(
  node: AccessibilityNode,
  refs: Map<string, ElementRef>,
  counter = { value: 1 }
): void {
  const ref = `ref_${counter.value++}`;

  refs.set(ref, {
    ref,
    role: node.role,
    name: node.name || '',
    description: node.description,
  });

  if (node.children) {
    for (const child of node.children) {
      buildRefMap(child, refs, counter);
    }
  }
}

/**
 * Find element by ref in snapshot
 */
export function findElementByRef(
  snapshot: AccessibilityNode,
  targetRef: string,
  counter = { value: 1 }
): AccessibilityNode | null {
  const currentRef = `ref_${counter.value++}`;

  if (currentRef === targetRef) {
    return snapshot;
  }

  if (snapshot.children) {
    for (const child of snapshot.children) {
      const found = findElementByRef(child, targetRef, counter);
      if (found) {
        return found;
      }
    }
  }

  return null;
}

/**
 * Truncate string with ellipsis
 */
function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) {
    return str;
  }
  return str.substring(0, maxLength - 3) + '...';
}
