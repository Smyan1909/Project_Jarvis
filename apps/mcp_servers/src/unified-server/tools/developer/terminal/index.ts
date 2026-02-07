// =============================================================================
// Terminal Tools Registration
// =============================================================================
// Registers terminal command execution tools with the tool router

import { z } from 'zod';
import { toolRouter, type ToolResult } from '../../../router/index.js';
import { executeCommand, getCurrentDirectory } from './executor.js';
import { getBlockedPatterns } from './blocklist.js';
import { log } from '../../../utils/logger.js';

// =============================================================================
// Schemas
// =============================================================================

const executeSchema = z.object({
  command: z.string().min(1, 'Command cannot be empty'),
  cwd: z.string().optional(),
  timeoutMs: z.number().positive().optional(),
});

// =============================================================================
// Handlers
// =============================================================================

/**
 * Execute a terminal command
 */
async function handleExecute(args: unknown): Promise<ToolResult> {
  const parsed = executeSchema.safeParse(args);
  if (!parsed.success) {
    return {
      content: [{ type: 'text', text: `Invalid arguments: ${parsed.error.message}` }],
      isError: true,
    };
  }

  const { command, cwd, timeoutMs } = parsed.data;

  try {
    const result = await executeCommand(command, { cwd, timeoutMs });

    if (result.blocked) {
      return {
        content: [{
          type: 'text',
          text: `Command blocked for safety: ${result.blockReason}\n\nThis command pattern is not allowed because it could cause system damage.`,
        }],
        isError: true,
      };
    }

    // Format output
    let output = '';
    
    if (result.timedOut) {
      output += `[TIMEOUT] Command did not complete within the time limit.\n\n`;
    }

    if (result.stdout) {
      output += `--- stdout ---\n${result.stdout}\n`;
    }

    if (result.stderr) {
      output += `\n--- stderr ---\n${result.stderr}\n`;
    }

    if (!result.stdout && !result.stderr) {
      output = `Command completed with exit code ${result.exitCode} (no output)`;
    } else {
      output += `\n--- exit code: ${result.exitCode} ---`;
    }

    return {
      content: [{ type: 'text', text: output }],
      isError: result.exitCode !== 0,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error('Terminal execute error', { error: errorMessage });
    return {
      content: [{ type: 'text', text: `Execution failed: ${errorMessage}` }],
      isError: true,
    };
  }
}

/**
 * Get the current working directory
 */
async function handleGetCwd(_args: unknown): Promise<ToolResult> {
  try {
    const cwd = getCurrentDirectory();
    return {
      content: [{ type: 'text', text: cwd }],
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text', text: `Failed to get cwd: ${errorMessage}` }],
      isError: true,
    };
  }
}

/**
 * List blocked command patterns (for transparency)
 */
async function handleListBlocked(_args: unknown): Promise<ToolResult> {
  const patterns = getBlockedPatterns();
  
  let output = '# Blocked Command Patterns\n\n';
  output += 'The following command patterns are blocked for safety:\n\n';
  
  for (const { pattern, reason } of patterns) {
    output += `- **${reason}**\n  Pattern: \`${pattern}\`\n\n`;
  }

  return {
    content: [{ type: 'text', text: output }],
  };
}

// =============================================================================
// Registration
// =============================================================================

export function registerTerminalTools(): void {
  log.info('Registering Terminal tools');

  toolRouter.registerTool({
    id: 'terminal.execute',
    category: 'terminal',
    name: 'Execute Command',
    description: `Execute a shell command in the terminal. Returns stdout, stderr, and exit code.

Some dangerous commands are blocked for safety (use terminal.list_blocked to see them).

The command runs in /bin/bash with a default timeout of 5 minutes.`,
    inputSchema: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'The shell command to execute (e.g., "ls -la", "npm install")',
        },
        cwd: {
          type: 'string',
          description: 'Working directory for the command (absolute path). Defaults to server\'s current directory.',
        },
        timeoutMs: {
          type: 'number',
          description: 'Timeout in milliseconds. Default is 5 minutes (300000).',
        },
      },
      required: ['command'],
    },
    handler: handleExecute,
    keywords: [
      'terminal', 'command', 'shell', 'bash', 'execute', 'run',
      'npm', 'yarn', 'pnpm', 'git', 'ls', 'cd', 'mkdir', 'pwd',
      'cat', 'grep', 'find', 'curl', 'wget', 'python', 'node',
    ],
  });

  toolRouter.registerTool({
    id: 'terminal.get_cwd',
    category: 'terminal',
    name: 'Get Current Directory',
    description: 'Get the current working directory of the MCP server process.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    handler: handleGetCwd,
    keywords: ['cwd', 'pwd', 'directory', 'current', 'working'],
  });

  toolRouter.registerTool({
    id: 'terminal.list_blocked',
    category: 'terminal',
    name: 'List Blocked Commands',
    description: 'List all command patterns that are blocked for safety reasons.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    handler: handleListBlocked,
    keywords: ['blocked', 'forbidden', 'restricted', 'safety'],
  });

  log.info('Terminal tools registered', { count: 3 });
}
