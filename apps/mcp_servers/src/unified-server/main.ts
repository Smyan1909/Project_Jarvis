// =============================================================================
// Unified MCP Server Entry Point
// =============================================================================
// Run this file directly to start the unified MCP server

import { startUnifiedServer, log } from './index.js';

// ASCII banner
const BANNER = `
╔═══════════════════════════════════════════════════════════════════╗
║                    Jarvis Unified MCP Server                       ║
║               Claude Code + Playwright Automation                  ║
╚═══════════════════════════════════════════════════════════════════╝
`;

async function main(): Promise<void> {
  console.log(BANNER);

  // Handle uncaught errors
  process.on('uncaughtException', (error) => {
    log.error('Uncaught exception', { error: error.message, stack: error.stack });
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    log.error('Unhandled rejection', { reason: String(reason) });
    process.exit(1);
  });

  try {
    await startUnifiedServer();

    log.info('Server is ready to accept connections');
    log.info('');
    log.info('Available meta-tools:');
    log.info('  - suggest_tools: Get AI-powered tool suggestions for your task');
    log.info('  - list_available_tools: Browse all available tools by category');
    log.info('  - get_tool_schema: Get full input schema for a specific tool');
    log.info('  - execute_tool: Execute a tool by its ID');
    log.info('  - claude_code: Execute complex coding tasks via Claude CLI');
    log.info('');
  } catch (error) {
    log.error('Failed to start server', { error: String(error) });
    process.exit(1);
  }
}

// Run main
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
