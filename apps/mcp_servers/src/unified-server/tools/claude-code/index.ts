// =============================================================================
// Claude Code Tool Provider
// =============================================================================
// Registers the claude_code tool with the tool router

import { z } from 'zod';
import { toolRouter, type ToolResult } from '../../router/index.js';
import { executeClaudeCli } from './cli-executor.js';
import { log } from '../../utils/logger.js';

/**
 * Input schema for claude_code tool
 */
const claudeCodeInputSchema = {
  type: 'object' as const,
  properties: {
    prompt: {
      type: 'string',
      description: 'The task/prompt to execute. Be specific about what you want to accomplish.',
    },
    workFolder: {
      type: 'string',
      description: 'Working directory for file operations (absolute path). Defaults to current directory.',
    },
  },
  required: ['prompt'],
};

/**
 * Zod schema for validation
 */
const claudeCodeArgsSchema = z.object({
  prompt: z.string().min(1, 'Prompt cannot be empty'),
  workFolder: z.string().optional(),
});

/**
 * Handler for claude_code tool
 */
async function handleClaudeCode(args: unknown): Promise<ToolResult> {
  const parsed = claudeCodeArgsSchema.safeParse(args);

  if (!parsed.success) {
    return {
      content: [{ type: 'text', text: `Invalid arguments: ${parsed.error.message}` }],
      isError: true,
    };
  }

  const { prompt, workFolder } = parsed.data;

  try {
    log.info('Executing claude_code', {
      promptPreview: prompt.substring(0, 100) + (prompt.length > 100 ? '...' : ''),
      workFolder,
    });

    const result = await executeClaudeCli(prompt, workFolder);

    // Combine stdout and stderr for output
    let output = '';

    if (result.stdout) {
      output += result.stdout;
    }

    if (result.stderr) {
      if (output) output += '\n\n--- stderr ---\n';
      output += result.stderr;
    }

    if (!output) {
      output = `Claude CLI completed with exit code ${result.exitCode} (no output)`;
    }

    const isError = result.exitCode !== 0;

    if (isError) {
      log.warn('claude_code completed with error', { exitCode: result.exitCode });
    } else {
      log.info('claude_code completed successfully');
    }

    return {
      content: [{ type: 'text', text: output }],
      isError,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error('claude_code failed', { error: errorMessage });

    return {
      content: [{ type: 'text', text: `Error executing Claude CLI: ${errorMessage}` }],
      isError: true,
    };
  }
}

/**
 * Register the claude_code tool
 *
 * Note: This is registered with the router for consistency, but it's also
 * exposed as a first-class MCP tool (not just through execute_tool)
 */
export function registerClaudeCodeTools(): void {
  toolRouter.registerTool({
    id: 'claude_code',
    category: 'code',
    name: 'Claude Code',
    description: 'Execute complex coding tasks using Claude CLI as a sub-agent with full system access',
    inputSchema: claudeCodeInputSchema,
    handler: handleClaudeCode,
    keywords: [
      'code', 'coding', 'programming', 'file', 'edit', 'create', 'delete',
      'git', 'commit', 'push', 'branch', 'merge', 'terminal', 'command',
      'shell', 'script', 'refactor', 'generate', 'write', 'build', 'run',
    ],
  });

  log.info('Claude Code tools registered');
}

// Export for direct use (as first-class MCP tool)
export { handleClaudeCode };
