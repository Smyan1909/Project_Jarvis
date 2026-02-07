// =============================================================================
// Composio SDK Client
// =============================================================================
// Singleton client instance for Composio API interactions

import { Composio } from '@composio/core';
import { loadEnvConfig, type ComposioEnvConfig } from './config.js';

// =============================================================================
// Client Singleton
// =============================================================================

let composioClient: Composio | null = null;
let envConfig: ComposioEnvConfig | null = null;

/**
 * Get the Composio SDK client instance.
 * Creates a new instance on first call, returns cached instance thereafter.
 *
 * @throws Error if COMPOSIO_API_KEY environment variable is not set
 */
export function getComposioClient(): Composio {
  if (!composioClient) {
    const config = getEnvConfig();
    composioClient = new Composio({
      apiKey: config.apiKey,
    });
  }
  return composioClient;
}

/**
 * Get the environment configuration.
 * Loads and caches on first call.
 *
 * @throws Error if required environment variables are missing
 */
export function getEnvConfig(): ComposioEnvConfig {
  if (!envConfig) {
    envConfig = loadEnvConfig();
  }
  return envConfig;
}

/**
 * Reset the client singleton (useful for testing)
 */
export function resetClient(): void {
  composioClient = null;
  envConfig = null;
}

/**
 * Create a new Composio client with custom configuration.
 * Does not affect the singleton.
 */
export function createComposioClient(apiKey: string): Composio {
  return new Composio({ apiKey });
}
