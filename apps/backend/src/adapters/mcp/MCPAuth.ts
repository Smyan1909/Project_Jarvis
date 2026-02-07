// =============================================================================
// MCP Authentication
// =============================================================================
// Authentication helpers for MCP server connections
// Supports OAuth 2.0 and API key authentication

import type { MCPAuthConfig, MCPOAuthConfig, MCPApiKeyConfig } from '@project-jarvis/shared-types';
import { logger } from '../../infrastructure/logging/logger.js';

const log = logger.child({ module: 'MCPAuth' });

/**
 * Result of getting authentication headers
 */
export interface AuthHeaders {
  [key: string]: string;
}

/**
 * Token refresh result
 */
export interface TokenRefreshResult {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number; // Unix timestamp
}

/**
 * Get authentication headers for an MCP server request
 *
 * @param authConfig - Authentication configuration
 * @returns Headers to include in requests
 */
export async function getAuthHeaders(authConfig: MCPAuthConfig | undefined): Promise<AuthHeaders> {
  if (!authConfig || authConfig.type === 'none') {
    return {};
  }

  switch (authConfig.type) {
    case 'api-key':
      return getApiKeyHeaders(authConfig.apiKey);

    case 'oauth':
      return await getOAuthHeaders(authConfig.oauth);

    default:
      return {};
  }
}

/**
 * Get API key authentication headers
 */
function getApiKeyHeaders(config: MCPApiKeyConfig): AuthHeaders {
  const headerName = config.headerName || 'Authorization';
  const prefix = config.headerPrefix || 'Bearer';

  const value = prefix ? `${prefix} ${config.apiKey}` : config.apiKey;

  return {
    [headerName]: value,
  };
}

/**
 * Get OAuth authentication headers
 *
 * Checks token expiration and refreshes if necessary
 */
async function getOAuthHeaders(config: MCPOAuthConfig): Promise<AuthHeaders> {
  let accessToken = config.accessToken;

  // Check if token needs refresh (with 5 minute buffer)
  const now = Math.floor(Date.now() / 1000);
  const bufferSeconds = 300; // 5 minutes

  if (!accessToken || (config.expiresAt && config.expiresAt - bufferSeconds < now)) {
    if (config.refreshToken) {
      try {
        const refreshed = await refreshOAuthToken(config);
        accessToken = refreshed.accessToken;
        // Note: Caller should persist the new tokens
      } catch (error) {
        log.error('Failed to refresh OAuth token', error);
        throw new Error('OAuth token refresh failed');
      }
    } else {
      // No refresh token - try client credentials flow
      try {
        const tokens = await performClientCredentialsFlow(config);
        accessToken = tokens.accessToken;
      } catch (error) {
        log.error('Failed to perform client credentials flow', error);
        throw new Error('OAuth client credentials flow failed');
      }
    }
  }

  if (!accessToken) {
    throw new Error('No valid OAuth access token available');
  }

  return {
    Authorization: `Bearer ${accessToken}`,
  };
}

/**
 * Refresh an OAuth access token using a refresh token
 */
export async function refreshOAuthToken(config: MCPOAuthConfig): Promise<TokenRefreshResult> {
  if (!config.refreshToken) {
    throw new Error('No refresh token available');
  }

  log.debug('Refreshing OAuth token', { tokenUrl: config.tokenUrl });

  const response = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: config.refreshToken,
      client_id: config.clientId,
      client_secret: config.clientSecret,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    log.error('OAuth token refresh failed', { status: response.status, error: errorText });
    throw new Error(`OAuth token refresh failed: ${response.status}`);
  }

  const data = (await response.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  };

  const expiresAt = data.expires_in
    ? Math.floor(Date.now() / 1000) + data.expires_in
    : Math.floor(Date.now() / 1000) + 3600; // Default 1 hour

  log.debug('OAuth token refreshed successfully', { expiresAt });

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || config.refreshToken,
    expiresAt,
  };
}

/**
 * Perform OAuth client credentials flow
 */
export async function performClientCredentialsFlow(
  config: MCPOAuthConfig
): Promise<TokenRefreshResult> {
  log.debug('Performing client credentials flow', { tokenUrl: config.tokenUrl });

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: config.clientId,
    client_secret: config.clientSecret,
  });

  if (config.scopes && config.scopes.length > 0) {
    body.set('scope', config.scopes.join(' '));
  }

  const response = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  if (!response.ok) {
    const errorText = await response.text();
    log.error('Client credentials flow failed', { status: response.status, error: errorText });
    throw new Error(`Client credentials flow failed: ${response.status}`);
  }

  const data = (await response.json()) as {
    access_token: string;
    expires_in?: number;
  };

  const expiresAt = data.expires_in
    ? Math.floor(Date.now() / 1000) + data.expires_in
    : Math.floor(Date.now() / 1000) + 3600;

  log.debug('Client credentials flow successful', { expiresAt });

  return {
    accessToken: data.access_token,
    expiresAt,
  };
}

/**
 * Create a custom fetch function with authentication
 *
 * Returns a fetch-compatible function that automatically adds auth headers
 */
export function createAuthenticatedFetch(
  authConfig: MCPAuthConfig | undefined
): typeof fetch {
  return async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]): Promise<Response> => {
    const authHeaders = await getAuthHeaders(authConfig);

    const headers = new Headers(init?.headers);
    for (const [key, value] of Object.entries(authHeaders)) {
      headers.set(key, value);
    }

    return fetch(input, {
      ...init,
      headers,
    });
  };
}
