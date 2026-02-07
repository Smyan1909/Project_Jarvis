// =============================================================================
// Claude CLI Executor
// =============================================================================
// Handles finding and executing the Claude CLI binary

import { spawn } from 'node:child_process';
import { access, constants } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { getConfig } from '../../config.js';
import { log } from '../../utils/logger.js';

/**
 * Result of CLI execution
 */
export interface CLIExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Find the Claude CLI binary
 *
 * Search order:
 * 1. CLAUDE_CLI_NAME env var (if absolute path)
 * 2. ~/.claude/local/claude (local installation)
 * 3. claude in PATH
 */
export async function findClaudeCli(): Promise<string> {
  const config = getConfig();
  const cliName = config.claudeCliName;

  // If it's an absolute path, use it directly
  if (cliName.startsWith('/')) {
    if (await isExecutable(cliName)) {
      log.debug('Using Claude CLI from absolute path', { path: cliName });
      return cliName;
    }
    throw new Error(`Claude CLI not found at specified path: ${cliName}`);
  }

  // Reject relative paths
  if (cliName.includes('/') || cliName.includes('\\')) {
    throw new Error('Relative paths are not allowed for CLAUDE_CLI_NAME. Use absolute path or just the binary name.');
  }

  // Check local installation first (only for default 'claude' name)
  if (cliName === 'claude') {
    const localPath = join(homedir(), '.claude', 'local', 'claude');
    if (await isExecutable(localPath)) {
      log.debug('Using Claude CLI from local installation', { path: localPath });
      return localPath;
    }
  }

  // Check if available in PATH and get the full path
  const pathResult = await findInPath(cliName);
  if (pathResult) {
    log.debug('Using Claude CLI from PATH', { name: cliName, path: pathResult });
    return pathResult; // Return the full path, not just the name
  }

  throw new Error(
    `Claude CLI not found. Please install it with: npm install -g @anthropic-ai/claude-code\n` +
    `Then run: claude --dangerously-skip-permissions (to accept terms once)`
  );
}

/**
 * Check if a file exists and is executable
 */
async function isExecutable(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Find a command in PATH and return its full path
 * Returns null if not found
 */
async function findInPath(command: string): Promise<string | null> {
  return new Promise((resolve) => {
    let output = '';
    const proc = spawn('which', [command], { stdio: ['pipe', 'pipe', 'pipe'] });
    
    proc.stdout.on('data', (data) => {
      output += data.toString();
    });
    
    proc.on('close', (code) => {
      if (code === 0 && output.trim()) {
        resolve(output.trim());
      } else {
        resolve(null);
      }
    });
    proc.on('error', () => {
      resolve(null);
    });
  });
}

/**
 * Execute Claude CLI with the given prompt
 */
export async function executeClaudeCli(
  prompt: string,
  workFolder?: string,
  timeoutMs: number = 30 * 60 * 1000 // 30 minutes default
): Promise<CLIExecutionResult> {
  const cliPath = await findClaudeCli();
  const config = getConfig();

  const args = ['--dangerously-skip-permissions', '-p', prompt];

  log.info('Executing Claude CLI', {
    cliPath,
    workFolder,
    promptLength: prompt.length,
    timeoutMs,
  });

  if (config.claudeDebug) {
    log.debug('Claude CLI prompt', { prompt });
  }

  return new Promise((resolve, reject) => {
    log.debug('Spawning Claude CLI process', { cliPath, args, cwd: workFolder ?? process.cwd() });
    
    const proc = spawn(cliPath, args, {
      cwd: workFolder ?? process.cwd(),
      env: {
        ...process.env,
        // Ensure proper terminal behavior
        TERM: process.env.TERM || 'xterm-256color',
        // Disable interactive mode hints
        CI: 'true',
        FORCE_COLOR: '0',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
      // Detach from controlling terminal
      detached: false,
    });

    // Close stdin immediately to signal no more input
    // This is crucial for non-interactive mode
    proc.stdin?.end();

    log.debug('Claude CLI process spawned', { pid: proc.pid });

    let stdout = '';
    let stderr = '';
    let killed = false;

    // Set timeout
    const timeoutId = setTimeout(() => {
      killed = true;
      proc.kill('SIGTERM');
      reject(new Error(`Claude CLI timed out after ${timeoutMs / 1000} seconds`));
    }, timeoutMs);

    proc.stdout.on('data', (data) => {
      const chunk = data.toString();
      stdout += chunk;
      log.debug('Claude CLI stdout chunk', { length: chunk.length, totalLength: stdout.length });
    });

    proc.stderr.on('data', (data) => {
      const chunk = data.toString();
      stderr += chunk;
      log.debug('Claude CLI stderr chunk', { length: chunk.length, content: chunk.substring(0, 200) });
    });

    proc.on('error', (error) => {
      clearTimeout(timeoutId);
      reject(error);
    });

    proc.on('close', (code) => {
      clearTimeout(timeoutId);

      if (killed) {
        return; // Already rejected via timeout
      }

      const exitCode = code ?? 1;

      if (config.claudeDebug) {
        log.debug('Claude CLI completed', {
          exitCode,
          stdoutLength: stdout.length,
          stderrLength: stderr.length,
        });
      }

      resolve({
        stdout,
        stderr,
        exitCode,
      });
    });
  });
}
