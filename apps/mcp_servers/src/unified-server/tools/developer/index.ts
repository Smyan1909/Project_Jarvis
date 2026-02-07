// =============================================================================
// Developer Tools Hub
// =============================================================================
// Registers all developer-focused tools (terminal, filesystem)

import { registerTerminalTools } from './terminal/index.js';
import { registerFilesystemTools } from './filesystem/index.js';
import { log } from '../../utils/logger.js';

/**
 * Register all developer tools with the tool router
 */
export function registerDeveloperTools(): void {
  log.info('Registering Developer tools');

  // Register terminal tools (execute, get_cwd, list_blocked)
  registerTerminalTools();

  // Register filesystem tools (read, write, delete, list, mkdir, etc.)
  registerFilesystemTools();

  log.info('Developer tools registration complete');
}

// Re-export for convenience
export { registerTerminalTools } from './terminal/index.js';
export { registerFilesystemTools } from './filesystem/index.js';
