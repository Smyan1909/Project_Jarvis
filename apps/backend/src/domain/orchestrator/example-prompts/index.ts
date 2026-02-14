// =============================================================================
// Example Prompt Loader
// =============================================================================
// Loads and detects example prompts from JSON files

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../../../infrastructure/logging/logger.js';
import type {
  ExamplePromptRegistry,
  ExamplePrompt,
  ExamplePromptMatch,
  ExamplePromptLoaderOptions,
  ExamplePromptStartEvent,
} from './types.js';

const log = logger.child({ service: 'ExamplePromptLoader' });

// =============================================================================
// Default Configuration
// =============================================================================

const DEFAULT_BASE_PATH = join(
  fileURLToPath(import.meta.url),
  '..'
);

// =============================================================================
// Registry Loading
// =============================================================================

let cachedRegistry: ExamplePromptRegistry | null = null;
let cachedRegistryPath: string | null = null;

/**
 * Load the example prompt registry from registry.json
 * Uses caching to avoid repeated file reads
 */
function loadRegistry(basePath: string): ExamplePromptRegistry {
  const registryPath = join(basePath, 'registry.json');
  
  // Return cached registry if path hasn't changed
  if (cachedRegistry && cachedRegistryPath === registryPath) {
    return cachedRegistry;
  }
  
  // Check if registry file exists
  if (!existsSync(registryPath)) {
    log.warn('Example prompt registry not found', { registryPath });
    return {};
  }
  
  try {
    const content = readFileSync(registryPath, 'utf-8');
    const registry = JSON.parse(content) as ExamplePromptRegistry;
    
    cachedRegistry = registry;
    cachedRegistryPath = registryPath;
    
    log.info('Loaded example prompt registry', {
      path: registryPath,
      count: Object.keys(registry).length,
    });
    
    return registry;
  } catch (error) {
    log.error('Failed to load example prompt registry', {
      error,
      path: registryPath,
    });
    return {};
  }
}

// =============================================================================
// Prompt Loading
// =============================================================================

const promptCache = new Map<string, ExamplePrompt>();

/**
 * Load a specific example prompt from its JSON file
 * Uses caching to avoid repeated file reads
 */
function loadPrompt(filename: string, basePath: string): ExamplePrompt | null {
  // Check cache first
  if (promptCache.has(filename)) {
    return promptCache.get(filename)!;
  }
  
  const filePath = join(basePath, filename);
  
  if (!existsSync(filePath)) {
    log.error('Example prompt file not found', {
      filename,
      path: filePath,
    });
    return null;
  }
  
  try {
    const content = readFileSync(filePath, 'utf-8');
    const prompt = JSON.parse(content) as ExamplePrompt;
    
    // Validate required fields
    if (!prompt.id || !prompt.displayName || !prompt.execution?.plan) {
      log.error('Invalid example prompt format', {
        filename,
        missingFields: [
          !prompt.id && 'id',
          !prompt.displayName && 'displayName',
          !prompt.execution?.plan && 'execution.plan',
        ].filter(Boolean),
      });
      return null;
    }
    
    promptCache.set(filename, prompt);
    
    log.debug('Loaded example prompt', {
      filename,
      id: prompt.id,
      displayName: prompt.displayName,
    });
    
    return prompt;
  } catch (error) {
    log.error('Failed to load example prompt', {
      error,
      filename,
      path: filePath,
    });
    return null;
  }
}

// =============================================================================
// Detection
// =============================================================================

/**
 * Check if user input matches an example prompt codeword
 * Returns the matched prompt or null if no match or feature disabled
 */
export function detectExamplePrompt(
  input: string,
  options: ExamplePromptLoaderOptions
): ExamplePromptMatch | null {
  // Feature disabled - return null immediately
  if (!options.enabled) {
    return null;
  }
  
  // Normalize input: trim whitespace and lowercase
  const trimmed = input.trim().toLowerCase();
  
  // Load registry
  const registry = loadRegistry(options.basePath);
  
  // Check if trimmed input is a valid codeword
  const filename = registry[trimmed];
  if (!filename) {
    return null;
  }
  
  // Load the example prompt
  const prompt = loadPrompt(filename, options.basePath);
  if (!prompt) {
    log.warn('Failed to load example prompt for codeword', {
      codeword: trimmed,
      filename,
    });
    return null;
  }
  
  log.info('Detected example prompt', {
    codeword: trimmed,
    promptId: prompt.id,
    displayName: prompt.displayName,
  });
  
  return {
    codeword: trimmed,
    prompt,
  };
}

// =============================================================================
// Event Creation
// =============================================================================

/**
 * Create an example prompt start event for streaming to the client
 */
export function createExamplePromptStartEvent(
  match: ExamplePromptMatch
): ExamplePromptStartEvent {
  return {
    type: 'example_prompt_start',
    codeword: match.codeword,
    displayName: match.prompt.displayName,
    bannerMessage: match.prompt.visibility.bannerMessage,
  };
}

// =============================================================================
// Cache Management
// =============================================================================

/**
 * Clear the example prompt cache
 * Useful for development or hot-reloading scenarios
 */
export function clearExamplePromptCache(): void {
  cachedRegistry = null;
  cachedRegistryPath = null;
  promptCache.clear();
  log.info('Cleared example prompt cache');
}

/**
 * Get cache statistics for monitoring
 */
export function getCacheStats(): {
  registryCached: boolean;
  promptsCached: number;
} {
  return {
    registryCached: cachedRegistry !== null,
    promptsCached: promptCache.size,
  };
}

// =============================================================================
// Workspace Management
// =============================================================================

import { mkdirSync, rmSync, readdirSync, statSync } from 'fs';

/**
 * Ensure the workspace directory exists
 * Creates it recursively if it doesn't exist
 */
export function ensureWorkspace(directory: string): void {
  try {
    mkdirSync(directory, { recursive: true });
    log.info('Workspace ensured', { directory });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error('Failed to create workspace directory', { directory, error: errorMessage });
    throw new Error(`Failed to create workspace directory: ${errorMessage}`);
  }
}

/**
 * Clean the workspace by removing all contents
 * This ensures a fresh start for each example prompt execution
 */
export function cleanWorkspace(directory: string): void {
  try {
    if (!existsSync(directory)) {
      log.warn('Workspace directory does not exist, skipping cleanup', { directory });
      return;
    }

    const entries = readdirSync(directory);
    let deletedCount = 0;

    for (const entry of entries) {
      const entryPath = join(directory, entry);
      try {
        const stats = statSync(entryPath);
        if (stats.isDirectory()) {
          rmSync(entryPath, { recursive: true, force: true });
        } else {
          rmSync(entryPath, { force: true });
        }
        deletedCount++;
      } catch (entryError) {
        const errorMessage = entryError instanceof Error ? entryError.message : String(entryError);
        log.error('Failed to delete workspace entry', { path: entryPath, error: errorMessage });
        throw new Error(`Failed to clean workspace entry ${entryPath}: ${errorMessage}`);
      }
    }

    log.info('Workspace cleaned', { directory, deletedCount });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Failed to clean workspace entry')) {
      throw error;
    }
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error('Failed to clean workspace', { directory, error: errorMessage });
    throw new Error(`Failed to clean workspace: ${errorMessage}`);
  }
}

/**
 * Clean the workspace after example prompt completion
 * Throws an error if cleanup fails (as requested)
 */
export function postRunCleanup(directory: string): void {
  try {
    cleanWorkspace(directory);
    log.info('Post-run workspace cleanup completed', { directory });
  } catch (error) {
    // Re-throw the error as requested - example prompts should fail if cleanup fails
    throw error;
  }
}
