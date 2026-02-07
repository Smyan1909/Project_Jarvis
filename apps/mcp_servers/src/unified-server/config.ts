// =============================================================================
// Unified Server Configuration
// =============================================================================
// Configuration handling for the unified MCP server

import { config as dotenvConfig } from 'dotenv';
import { join } from 'node:path';

// Load environment variables
dotenvConfig();

/**
 * Server configuration
 */
export interface ServerConfig {
  port: number;
  host: string;
}

/**
 * Claude CLI configuration
 */
export interface ClaudeConfig {
  cliName: string;
  debug: boolean;
}

/**
 * Playwright configuration
 */
export interface PlaywrightConfig {
  browser: 'chromium' | 'firefox' | 'webkit' | 'msedge';
  headless: boolean;
  userDataDir: string;
  viewportSize: string;
  timeoutAction: number;
  timeoutNavigation: number;
  extensionEnabled: boolean;
  cdpEndpoint: string | undefined;
}

/**
 * Developer tools configuration
 */
export interface DeveloperConfig {
  terminalTimeout: number; // Timeout for terminal commands in milliseconds
  maxOutputSize: number;   // Max output size in bytes before truncation
}

/**
 * Full configuration
 */
export interface UnifiedServerConfig {
  server: ServerConfig;
  claudeCliName: string;
  claudeDebug: boolean;
  playwright: PlaywrightConfig;
  developer: DeveloperConfig;
  logLevel: string;
}

// Singleton config instance
let configInstance: UnifiedServerConfig | null = null;

/**
 * Parse boolean from environment variable
 */
function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) return defaultValue;
  return value.toLowerCase() === 'true' || value === '1';
}

/**
 * Parse integer from environment variable
 */
function parseIntValue(value: string | undefined, defaultValue: number): number {
  if (value === undefined) return defaultValue;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Load configuration from environment variables
 */
function loadConfig(): UnifiedServerConfig {
  return {
    server: {
      port: parseIntValue(process.env.MCP_SERVER_PORT, 8932),
      host: process.env.MCP_SERVER_HOST ?? 'localhost',
    },
    claudeCliName: process.env.CLAUDE_CLI_NAME ?? 'claude',
    claudeDebug: parseBoolean(process.env.MCP_CLAUDE_DEBUG, false),
    playwright: {
      browser: (process.env.PLAYWRIGHT_BROWSER ?? 'chromium') as PlaywrightConfig['browser'],
      headless: parseBoolean(process.env.PLAYWRIGHT_HEADLESS, false),
      userDataDir: process.env.PLAYWRIGHT_USER_DATA_DIR ?? join(process.cwd(), 'browser-profile'),
      viewportSize: process.env.PLAYWRIGHT_VIEWPORT_SIZE ?? '1280x720',
      timeoutAction: parseIntValue(process.env.PLAYWRIGHT_TIMEOUT_ACTION, 5000),
      timeoutNavigation: parseIntValue(process.env.PLAYWRIGHT_TIMEOUT_NAVIGATION, 60000),
      extensionEnabled: parseBoolean(process.env.PLAYWRIGHT_EXTENSION_ENABLED, true),
      cdpEndpoint: process.env.PLAYWRIGHT_CDP_ENDPOINT || undefined,
    },
    developer: {
      terminalTimeout: parseIntValue(process.env.TERMINAL_TIMEOUT, 5 * 60 * 1000), // 5 minutes default
      maxOutputSize: parseIntValue(process.env.TERMINAL_MAX_OUTPUT, 1024 * 1024),  // 1MB default
    },
    logLevel: process.env.LOG_LEVEL ?? 'info',
  };
}

/**
 * Get configuration (singleton)
 */
export function getConfig(): UnifiedServerConfig {
  if (!configInstance) {
    configInstance = loadConfig();
  }
  return configInstance;
}

/**
 * Reset configuration (for testing)
 */
export function resetConfig(): void {
  configInstance = null;
}
