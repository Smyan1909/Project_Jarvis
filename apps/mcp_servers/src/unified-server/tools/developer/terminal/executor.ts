// =============================================================================
// Terminal Command Executor
// =============================================================================
// Executes shell commands with safety checks and timeout handling

import { spawn } from 'node:child_process';
import { log } from '../../../utils/logger.js';
import { checkBlocklist } from './blocklist.js';
import { getConfig } from '../../../config.js';

/**
 * Result of command execution
 */
export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
  blocked?: boolean;
  blockReason?: string;
}

/**
 * Options for command execution
 */
export interface ExecuteOptions {
  /** Working directory for the command */
  cwd?: string;
  /** Timeout in milliseconds (default: 5 minutes) */
  timeoutMs?: number;
  /** Environment variables to add/override */
  env?: Record<string, string>;
  /** Shell to use (default: /bin/bash) */
  shell?: string;
}

/**
 * Maximum output size in bytes (1MB)
 * Output will be truncated if it exceeds this
 */
const MAX_OUTPUT_SIZE = 1024 * 1024;

/**
 * Execute a shell command
 */
export async function executeCommand(
  command: string,
  options: ExecuteOptions = {}
): Promise<CommandResult> {
  const config = getConfig();
  const timeoutMs = options.timeoutMs ?? config.developer.terminalTimeout;
  const shell = options.shell ?? '/bin/bash';
  const cwd = options.cwd ?? process.cwd();

  // Check blocklist first
  const blockCheck = checkBlocklist(command);
  if (blockCheck.blocked) {
    log.warn('Command blocked by blocklist', {
      command: command.substring(0, 100),
      reason: blockCheck.reason,
    });
    
    return {
      stdout: '',
      stderr: `Command blocked: ${blockCheck.reason}`,
      exitCode: 1,
      timedOut: false,
      blocked: true,
      blockReason: blockCheck.reason,
    };
  }

  log.info('Executing command', {
    command: command.substring(0, 100) + (command.length > 100 ? '...' : ''),
    cwd,
    timeoutMs,
  });

  return new Promise((resolve) => {
    const proc = spawn(shell, ['-c', command], {
      cwd,
      env: {
        ...process.env,
        ...options.env,
        // Disable interactive prompts
        DEBIAN_FRONTEND: 'noninteractive',
        CI: 'true',
        TERM: 'dumb',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Close stdin immediately
    proc.stdin?.end();

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let stdoutTruncated = false;
    let stderrTruncated = false;

    // Set timeout
    const timeoutId = setTimeout(() => {
      timedOut = true;
      log.warn('Command timed out', { command: command.substring(0, 50), timeoutMs });
      proc.kill('SIGTERM');
      
      // Force kill after 5 seconds if SIGTERM didn't work
      setTimeout(() => {
        if (!proc.killed) {
          proc.kill('SIGKILL');
        }
      }, 5000);
    }, timeoutMs);

    proc.stdout.on('data', (data: Buffer) => {
      if (!stdoutTruncated) {
        stdout += data.toString();
        if (stdout.length > MAX_OUTPUT_SIZE) {
          stdout = stdout.substring(0, MAX_OUTPUT_SIZE) + '\n... [output truncated]';
          stdoutTruncated = true;
        }
      }
    });

    proc.stderr.on('data', (data: Buffer) => {
      if (!stderrTruncated) {
        stderr += data.toString();
        if (stderr.length > MAX_OUTPUT_SIZE) {
          stderr = stderr.substring(0, MAX_OUTPUT_SIZE) + '\n... [output truncated]';
          stderrTruncated = true;
        }
      }
    });

    proc.on('error', (error) => {
      clearTimeout(timeoutId);
      log.error('Command execution error', { error: error.message });
      resolve({
        stdout,
        stderr: stderr + `\nExecution error: ${error.message}`,
        exitCode: 1,
        timedOut: false,
      });
    });

    proc.on('close', (code) => {
      clearTimeout(timeoutId);
      
      const exitCode = code ?? (timedOut ? 124 : 1); // 124 is the standard timeout exit code
      
      log.info('Command completed', {
        exitCode,
        timedOut,
        stdoutLength: stdout.length,
        stderrLength: stderr.length,
      });

      resolve({
        stdout,
        stderr,
        exitCode,
        timedOut,
      });
    });
  });
}

/**
 * Get the current working directory
 */
export function getCurrentDirectory(): string {
  return process.cwd();
}
