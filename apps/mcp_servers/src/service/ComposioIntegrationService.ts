// =============================================================================
// Composio Integration Service
// =============================================================================
// Core business logic for Composio Tool Router integration.
// Handles session management, OAuth connections, and account management.

import type { Composio } from '@composio/core';
import {
  SUPPORTED_TOOLKITS,
  ENABLED_TOOLKIT_SLUGS,
  MANAGED_AUTH_TOOLKIT_SLUGS,
  getToolkitInfo,
  isToolkitSupported,
} from '../config.js';
import type {
  SessionInfo,
  AppWithStatus,
  ConnectionRequest,
  ConnectionStatus,
  ConnectedAccountInfo,
  ToolkitStatus,
  CreateSessionOptions,
} from '../types.js';

// =============================================================================
// Service Class
// =============================================================================

export class ComposioIntegrationService {
  private readonly client: Composio;
  private readonly defaultCallbackUrl: string;

  constructor(client: Composio, defaultCallbackUrl: string) {
    this.client = client;
    this.defaultCallbackUrl = defaultCallbackUrl;
  }

  // ===========================================================================
  // Session Management
  // ===========================================================================

  /**
   * Create a new Tool Router session for a user.
   * Returns session info including MCP server URL and available meta tools.
   * 
   * By default, no toolkit restrictions are applied - the agent can discover
   * and use any toolkit via COMPOSIO_SEARCH_TOOLS. If you want to restrict
   * to specific toolkits, pass them in options.toolkits.enabled.
   */
  async createSession(
    userId: string,
    options?: CreateSessionOptions
  ): Promise<SessionInfo> {
    // Build toolkits config based on options
    // Default to the supported toolkit list to avoid exposing unsupported tools
    const toolkitsConfig = options?.toolkits?.enabled
      ? { enable: options.toolkits.enabled }
      : options?.toolkits?.disabled
        ? { disable: options.toolkits.disabled }
        : { enable: ENABLED_TOOLKIT_SLUGS };


    const session = await this.client.create(userId, {
      toolkits: toolkitsConfig,
      manageConnections: {
        enable: options?.manageConnections?.enable ?? false,
        callbackUrl:
          options?.manageConnections?.callbackUrl ?? this.defaultCallbackUrl,
        waitForConnections:
          options?.manageConnections?.enableWaitForConnections ?? false,
      },
      experimental: options?.userTimezone
        ? {
            assistivePrompt: {
              userTimezone: options.userTimezone,
            },
          }
        : undefined,
    });

    // Get meta tools list from session - cast to access internal properties
    const sessionAny = session as unknown as Record<string, unknown>;
    const metaTools = (sessionAny.toolRouterTools as string[] | undefined) ?? [
      'COMPOSIO_SEARCH_TOOLS',
      'COMPOSIO_MULTI_EXECUTE_TOOL',
      'COMPOSIO_REMOTE_WORKBENCH',
      'COMPOSIO_REMOTE_BASH_TOOL',
    ];


    return {
      sessionId: session.sessionId,
      mcp: {
        type: 'http',
        url: session.mcp.url,
        headers: session.mcp.headers ?? {},
      },
      metaTools,
      assistivePrompt: (sessionAny.experimental as Record<string, unknown> | undefined)?.assistivePrompt as string | undefined,
    };
  }

  /**
   * Get an existing session by ID.
   */
  async getSession(sessionId: string): Promise<SessionInfo> {
    const session = await this.client.use(sessionId);
    const sessionAny = session as unknown as Record<string, unknown>;

    return {
      sessionId: session.sessionId,
      mcp: {
        type: 'http',
        url: session.mcp.url,
        headers: session.mcp.headers ?? {},
      },
      metaTools: (sessionAny.toolRouterTools as string[] | undefined) ?? [
        'COMPOSIO_SEARCH_TOOLS',
        'COMPOSIO_MULTI_EXECUTE_TOOL',
        'COMPOSIO_REMOTE_WORKBENCH',
        'COMPOSIO_REMOTE_BASH_TOOL',
      ],

    };
  }

  // ===========================================================================
  // Connection Management
  // ===========================================================================

  /**
   * Get all supported apps with connection status for a user.
   */
  async getSupportedApps(userId: string): Promise<AppWithStatus[]> {
    // Get user's connected accounts
    const accounts = await this.client.connectedAccounts.list({
      userIds: [userId],
    });

    // Build a map of toolkit slug -> connected account
    // Only include ACTIVE accounts, normalize slug to uppercase for matching
    const connectedMap = new Map<string, string>();
    for (const account of accounts.items ?? []) {
      const slug = account.toolkit?.slug;
      const normalizedSlug = slug?.toUpperCase();
      
      // Only count ACTIVE accounts as connected
      if (normalizedSlug && account.status === 'ACTIVE' && !connectedMap.has(normalizedSlug)) {
        connectedMap.set(normalizedSlug, account.id);
      }
    }

    // Map supported toolkits to status
    const apps: AppWithStatus[] = Object.entries(SUPPORTED_TOOLKITS).map(
      ([key, toolkit]) => {
        const normalizedSlug = toolkit.slug.toUpperCase();
        const isConnected = connectedMap.has(normalizedSlug);
        const connectedAccountId = connectedMap.get(normalizedSlug);
        
        return {
          key,
          slug: toolkit.slug,
          name: toolkit.name,
          description: toolkit.description,
          isConnected,
          connectedAccountId,
        };
      }
    );

    return apps;
  }

  /**
   * Initiate an OAuth connection for a toolkit.
   * Returns a redirect URL for the mobile app to open in a browser.
   */
  async initiateConnection(
    userId: string,
    appKeyOrSlug: string,
    callbackUrl?: string
  ): Promise<ConnectionRequest> {
    // Resolve toolkit slug
    const toolkitInfo = getToolkitInfo(appKeyOrSlug);
    if (!toolkitInfo) {
      throw new Error(
        `Unsupported app: ${appKeyOrSlug}. Supported apps: ${Object.keys(SUPPORTED_TOOLKITS).join(', ')}`
      );
    }

    // Use the toolkits.authorize method which handles auth config creation
    const connectionRequest = await this.client.toolkits.authorize(
      userId,
      toolkitInfo.slug
    );

    // Cast to access properties that may exist
    const requestAny = connectionRequest as unknown as Record<string, unknown>;

    return {
      connectionId: (requestAny.connectedAccountId as string) ?? (requestAny.id as string) ?? '',
      redirectUrl: connectionRequest.redirectUrl ?? '',
      expiresAt: requestAny.expiresAt as string | undefined,
    };
  }

  /**
   * Get the status of a connection (for mobile polling).
   */
  async getConnectionStatus(connectionId: string): Promise<ConnectionStatus> {
    try {
      const account = await this.client.connectedAccounts.get(connectionId);

      // Map Composio status to our status
      let status: ConnectionStatus['status'] = 'initiated';
      const accountStatus = account.status as string;
      
      if (accountStatus === 'ACTIVE') {
        status = 'active';
      } else if (accountStatus === 'FAILED' || accountStatus === 'REVOKED') {
        status = 'failed';
      } else if (accountStatus === 'EXPIRED') {
        status = 'expired';
      }

      // Cast toolkit to access all properties
      const toolkit = account.toolkit as Record<string, unknown> | undefined;

      return {
        connectionId,
        status,
        connectedAccount:
          status === 'active'
            ? {
                id: account.id,
                toolkit: {
                  slug: toolkit?.slug as string ?? '',
                  name: toolkit?.name as string ?? '',
                  logo: toolkit?.logo as string | undefined,
                },
                status: account.status,
                createdAt: account.createdAt,
                isDisabled: account.isDisabled,
              }
            : undefined,
      };
    } catch (error) {
      // If account not found or other error, return failed status
      return {
        connectionId,
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Wait for a connection to complete (blocking).
   * Useful for server-side flows.
   */
  async waitForConnection(
    connectionId: string,
    timeoutMs: number = 60000
  ): Promise<ConnectedAccountInfo> {
    const account = await this.client.connectedAccounts.waitForConnection(
      connectionId,
      timeoutMs
    );

    const toolkit = account.toolkit as Record<string, unknown> | undefined;

    return {
      id: account.id,
      toolkit: {
        slug: toolkit?.slug as string ?? '',
        name: toolkit?.name as string ?? '',
        logo: toolkit?.logo as string | undefined,
      },
      status: account.status,
      createdAt: account.createdAt,
      isDisabled: account.isDisabled,
    };
  }

  // ===========================================================================
  // Account Management
  // ===========================================================================

  /**
   * List all connected accounts for a user.
   */
  async listUserAccounts(userId: string): Promise<ConnectedAccountInfo[]> {
    const accounts = await this.client.connectedAccounts.list({
      userIds: [userId],
    });

    return (accounts.items ?? [])
      .filter((account) => isToolkitSupported(account.toolkit?.slug ?? ''))
      .map((account) => {
        const toolkit = account.toolkit as Record<string, unknown> | undefined;
        return {
          id: account.id,
          toolkit: {
            slug: toolkit?.slug as string ?? '',
            name: toolkit?.name as string ?? '',
            logo: toolkit?.logo as string | undefined,
          },
          status: account.status,
          createdAt: account.createdAt,
          isDisabled: account.isDisabled,
        };
      });
  }

  /**
   * Disconnect/revoke a connected account.
   */
  async disconnectAccount(accountId: string): Promise<void> {
    await this.client.connectedAccounts.delete(accountId);
  }

  /**
   * Refresh OAuth tokens for a connected account.
   */
  async refreshAccount(accountId: string): Promise<ConnectedAccountInfo> {
    await this.client.connectedAccounts.refresh(accountId);

    // Get updated account info
    const account = await this.client.connectedAccounts.get(accountId);
    const toolkit = account.toolkit as Record<string, unknown> | undefined;

    return {
      id: account.id,
      toolkit: {
        slug: toolkit?.slug as string ?? '',
        name: toolkit?.name as string ?? '',
        logo: toolkit?.logo as string | undefined,
      },
      status: account.status,
      createdAt: account.createdAt,
      isDisabled: account.isDisabled,
    };
  }

  /**
   * Enable a previously disabled account.
   */
  async enableAccount(accountId: string): Promise<ConnectedAccountInfo> {
    await this.client.connectedAccounts.enable(accountId);
    const account = await this.client.connectedAccounts.get(accountId);
    const toolkit = account.toolkit as Record<string, unknown> | undefined;

    return {
      id: account.id,
      toolkit: {
        slug: toolkit?.slug as string ?? '',
        name: toolkit?.name as string ?? '',
        logo: toolkit?.logo as string | undefined,
      },
      status: account.status,
      createdAt: account.createdAt,
      isDisabled: account.isDisabled,
    };
  }

  /**
   * Disable a connected account.
   */
  async disableAccount(accountId: string): Promise<ConnectedAccountInfo> {
    await this.client.connectedAccounts.disable(accountId);
    const account = await this.client.connectedAccounts.get(accountId);
    const toolkit = account.toolkit as Record<string, unknown> | undefined;

    return {
      id: account.id,
      toolkit: {
        slug: toolkit?.slug as string ?? '',
        name: toolkit?.name as string ?? '',
        logo: toolkit?.logo as string | undefined,
      },
      status: account.status,
      createdAt: account.createdAt,
      isDisabled: account.isDisabled,
    };
  }

  // ===========================================================================
  // Toolkit Info
  // ===========================================================================

  /**
   * Get toolkit connection status for a user's session.
   * Only checks toolkits that have Composio-managed auth.
   */
  async getToolkitStatus(userId: string): Promise<ToolkitStatus[]> {
    // Create a temporary session to check toolkit status
    // Only include toolkits with managed auth to avoid errors
    const session = await this.client.create(userId, {
      toolkits: { enable: MANAGED_AUTH_TOOLKIT_SLUGS },
      manageConnections: { enable: false },
    });

    const toolkits = await session.toolkits();

    return (toolkits.items ?? [])
      .filter((t) => isToolkitSupported(t.slug))
      .map((toolkit) => {
        const connection = toolkit.connection as Record<string, unknown> | undefined;
        const connectedAccount = connection?.connectedAccount as Record<string, unknown> | undefined;
        return {
          slug: toolkit.slug,
          name: toolkit.name,
          isConnected: !!connectedAccount,
          connectedAccountId: connectedAccount?.id as string | undefined,
        };
      });
  }

  /**
   * Get list of supported toolkit slugs.
   */
  getSupportedToolkitSlugs(): string[] {
    return ENABLED_TOOLKIT_SLUGS;
  }

  /**
   * Get toolkit info by key or slug.
   */
  getToolkitInfo(keyOrSlug: string) {
    return getToolkitInfo(keyOrSlug);
  }

  /**
   * List active connection slugs for a user.
   * Useful for scoping sessions to authenticated toolkits.
   */
  async listActiveConnections(userId: string): Promise<string[]> {
    const accounts = await this.client.connectedAccounts.list({
      userIds: [userId],
    });

    return (accounts.items ?? [])
      .filter((account) => account.status === 'ACTIVE')
      .map((account) => account.toolkit?.slug ?? '')
      .filter((slug) => slug !== '');
  }

  // ===========================================================================
  // Tool Execution
  // ===========================================================================

  /**
   * Execute a tool for a user.
   * Creates a session and executes the tool using the user's connected accounts.
   */
  async executeTool(
    userId: string,
    toolSlug: string,
    args: Record<string, unknown> = {}
  ): Promise<{ data: unknown; error: string | null; logId?: string }> {
    // Use the tools.execute method which handles auth automatically
    // We use dangerouslySkipVersionCheck to allow execution without specifying a version
    const result = await this.client.tools.execute(toolSlug, {
      userId,
      arguments: args,
      dangerouslySkipVersionCheck: true,
    });

    return {
      data: result.data,
      error: result.error ?? null,
      logId: result.logId,
    };
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a new ComposioIntegrationService instance.
 */
export function createComposioIntegrationService(
  client: Composio,
  defaultCallbackUrl: string
): ComposioIntegrationService {
  return new ComposioIntegrationService(client, defaultCallbackUrl);
}
