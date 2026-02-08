// =============================================================================
// Composio Integration REST API Routes
// =============================================================================
// Hono routes for Composio Tool Router integration.
// Handles session creation, OAuth flows, and account management.

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import type { ComposioIntegrationService } from '../service/ComposioIntegrationService.js';
import {
  CreateSessionRequestSchema,
  InitiateConnectionRequestSchema,
  AppParamSchema,
  SessionIdParamSchema,
  ConnectionIdParamSchema,
  AccountIdParamSchema,
  UserIdQuerySchema,
  ExecuteToolRequestSchema,
  createErrorResponse,
} from '../types.js';
import { SUPPORTED_TOOLKITS } from '../config.js';

// =============================================================================
// Route Dependencies
// =============================================================================

export interface ComposioRouteDependencies {
  composioService: ComposioIntegrationService;
}

// =============================================================================
// Route Factory
// =============================================================================

/**
 * Create Composio integration routes.
 *
 * Note: These routes expect userId to be provided in request body/query.
 * In production, userId should come from authenticated session middleware.
 */
export function createComposioRoutes(deps: ComposioRouteDependencies) {
  const { composioService } = deps;
  const app = new Hono();

  // ===========================================================================
  // Session Endpoints
  // ===========================================================================

  /**
   * POST /session
   * Create a new Tool Router session for a user.
   * Returns MCP server URL and available meta tools.
   */
  app.post(
    '/session',
    zValidator('json', CreateSessionRequestSchema),
    async (c) => {
      try {
        const { userId, manageConnections, callbackUrl } = c.req.valid('json');

        const session = await composioService.createSession(userId, {
          manageConnections: {
            enable: manageConnections,
            callbackUrl,
          },
        });

        return c.json(session, 201);
      } catch (error) {
        console.error('Failed to create session:', error);
        return c.json(
          createErrorResponse(
            'SESSION_CREATE_FAILED',
            error instanceof Error ? error.message : 'Failed to create session'
          ),
          500
        );
      }
    }
  );

  /**
   * GET /session/:sessionId
   * Get an existing session by ID.
   */
  app.get(
    '/session/:sessionId',
    zValidator('param', SessionIdParamSchema),
    async (c) => {
      try {
        const { sessionId } = c.req.valid('param');
        const session = await composioService.getSession(sessionId);
        return c.json(session);
      } catch (error) {
        console.error('Failed to get session:', error);
        return c.json(
          createErrorResponse(
            'SESSION_NOT_FOUND',
            error instanceof Error ? error.message : 'Session not found'
          ),
          404
        );
      }
    }
  );

  // ===========================================================================
  // App & Connection Endpoints
  // ===========================================================================

  /**
   * GET /apps
   * List all supported apps with connection status for a user.
   */
  app.get('/apps', zValidator('query', UserIdQuerySchema), async (c) => {
    try {
      const { userId } = c.req.valid('query');
      const apps = await composioService.getSupportedApps(userId);
      return c.json({ apps });
    } catch (error) {
      console.error('Failed to get apps:', error);
      return c.json(
        createErrorResponse(
          'APPS_FETCH_FAILED',
          error instanceof Error ? error.message : 'Failed to fetch apps'
        ),
        500
      );
    }
  });

  /**
   * GET /apps/supported
   * List all supported app keys and their info (no auth required).
   */
  app.get('/apps/supported', (c) => {
    const apps = Object.entries(SUPPORTED_TOOLKITS).map(([key, info]) => ({
      key,
      ...info,
    }));
    return c.json({ apps });
  });

  /**
   * POST /connect/:app
   * Initiate OAuth connection for a specific app.
   * Returns redirect URL for mobile to open in browser.
   */
  app.post(
    '/connect/:app',
    zValidator('param', AppParamSchema),
    zValidator('json', InitiateConnectionRequestSchema),
    async (c) => {
      try {
        const { app } = c.req.valid('param');
        const { userId, callbackUrl } = c.req.valid('json');

        const connection = await composioService.initiateConnection(
          userId,
          app,
          callbackUrl
        );

        return c.json(connection, 201);
      } catch (error) {
        console.error('Failed to initiate connection:', error);

        // Check if it's an unsupported app error
        if (
          error instanceof Error &&
          error.message.includes('Unsupported app')
        ) {
          return c.json(
            createErrorResponse('UNSUPPORTED_APP', error.message),
            400
          );
        }

        return c.json(
          createErrorResponse(
            'CONNECTION_INIT_FAILED',
            error instanceof Error
              ? error.message
              : 'Failed to initiate connection'
          ),
          500
        );
      }
    }
  );

  /**
   * GET /status/:connectionId
   * Poll connection status (for mobile to check OAuth completion).
   */
  app.get(
    '/status/:connectionId',
    zValidator('param', ConnectionIdParamSchema),
    async (c) => {
      try {
        const { connectionId } = c.req.valid('param');
        const status = await composioService.getConnectionStatus(connectionId);
        return c.json(status);
      } catch (error) {
        console.error('Failed to get connection status:', error);
        return c.json(
          createErrorResponse(
            'STATUS_FETCH_FAILED',
            error instanceof Error
              ? error.message
              : 'Failed to fetch connection status'
          ),
          500
        );
      }
    }
  );

  // ===========================================================================
  // Account Management Endpoints
  // ===========================================================================

  /**
   * GET /accounts
   * List all connected accounts for a user.
   */
  app.get('/accounts', zValidator('query', UserIdQuerySchema), async (c) => {
    try {
      const { userId } = c.req.valid('query');
      const accounts = await composioService.listUserAccounts(userId);
      return c.json({ accounts });
    } catch (error) {
      console.error('Failed to list accounts:', error);
      return c.json(
        createErrorResponse(
          'ACCOUNTS_FETCH_FAILED',
          error instanceof Error ? error.message : 'Failed to fetch accounts'
        ),
        500
      );
    }
  });

  /**
   * DELETE /accounts/:id
   * Disconnect/revoke a connected account.
   */
  app.delete(
    '/accounts/:id',
    zValidator('param', AccountIdParamSchema),
    async (c) => {
      try {
        const { id } = c.req.valid('param');
        await composioService.disconnectAccount(id);
        return c.json({ success: true, message: 'Account disconnected' });
      } catch (error) {
        console.error('Failed to disconnect account:', error);
        return c.json(
          createErrorResponse(
            'ACCOUNT_DISCONNECT_FAILED',
            error instanceof Error
              ? error.message
              : 'Failed to disconnect account'
          ),
          500
        );
      }
    }
  );

  /**
   * POST /accounts/:id/refresh
   * Refresh OAuth tokens for a connected account.
   */
  app.post(
    '/accounts/:id/refresh',
    zValidator('param', AccountIdParamSchema),
    async (c) => {
      try {
        const { id } = c.req.valid('param');
        const account = await composioService.refreshAccount(id);
        return c.json(account);
      } catch (error) {
        console.error('Failed to refresh account:', error);
        return c.json(
          createErrorResponse(
            'ACCOUNT_REFRESH_FAILED',
            error instanceof Error ? error.message : 'Failed to refresh account'
          ),
          500
        );
      }
    }
  );

  /**
   * POST /accounts/:id/enable
   * Enable a previously disabled account.
   */
  app.post(
    '/accounts/:id/enable',
    zValidator('param', AccountIdParamSchema),
    async (c) => {
      try {
        const { id } = c.req.valid('param');
        const account = await composioService.enableAccount(id);
        return c.json(account);
      } catch (error) {
        console.error('Failed to enable account:', error);
        return c.json(
          createErrorResponse(
            'ACCOUNT_ENABLE_FAILED',
            error instanceof Error ? error.message : 'Failed to enable account'
          ),
          500
        );
      }
    }
  );

  /**
   * POST /accounts/:id/disable
   * Disable a connected account.
   */
  app.post(
    '/accounts/:id/disable',
    zValidator('param', AccountIdParamSchema),
    async (c) => {
      try {
        const { id } = c.req.valid('param');
        const account = await composioService.disableAccount(id);
        return c.json(account);
      } catch (error) {
        console.error('Failed to disable account:', error);
        return c.json(
          createErrorResponse(
            'ACCOUNT_DISABLE_FAILED',
            error instanceof Error ? error.message : 'Failed to disable account'
          ),
          500
        );
      }
    }
  );

  // ===========================================================================
  // Toolkit Status Endpoint
  // ===========================================================================

  /**
   * GET /toolkits
   * Get toolkit connection status for a user.
   */
  app.get('/toolkits', zValidator('query', UserIdQuerySchema), async (c) => {
    try {
      const { userId } = c.req.valid('query');
      const toolkits = await composioService.getToolkitStatus(userId);
      return c.json({ toolkits });
    } catch (error) {
      console.error('Failed to get toolkit status:', error);
      return c.json(
        createErrorResponse(
          'TOOLKITS_FETCH_FAILED',
          error instanceof Error
            ? error.message
            : 'Failed to fetch toolkit status'
        ),
        500
      );
    }
  });

  // ===========================================================================
  // Tool Execution Endpoint (for testing)
  // ===========================================================================

  /**
   * POST /execute
   * Execute a tool for a user. Useful for testing connections.
   */
  app.post(
    '/execute',
    zValidator('json', ExecuteToolRequestSchema),
    async (c) => {
      try {
        const { userId, toolSlug, arguments: args } = c.req.valid('json');
        const result = await composioService.executeTool(userId, toolSlug, args);
        return c.json(result);
      } catch (error) {
        console.error('Failed to execute tool:', error);
        return c.json(
          createErrorResponse(
            'TOOL_EXECUTION_FAILED',
            error instanceof Error ? error.message : 'Failed to execute tool'
          ),
          500
        );
      }
    }
  );

  return app;
}
