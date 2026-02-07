// =============================================================================
// MCP Admin API Routes
// =============================================================================
// CRUD endpoints for managing MCP server configurations

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { MCPServerService } from '../../../application/services/MCPServerService.js';
import type { MCPClientManager } from '../../../adapters/mcp/MCPClientManager.js';
import { logger } from '../../../infrastructure/logging/logger.js';

const log = logger.child({ module: 'MCPRoutes' });

// =============================================================================
// Request Schemas (defined locally to avoid zod version conflicts)
// =============================================================================

const MCPTransportTypeSchema = z.enum(['streamable-http', 'sse']);
const MCPAuthTypeSchema = z.enum(['oauth', 'api-key', 'none']);

const MCPOAuthConfigSchema = z.object({
  clientId: z.string(),
  clientSecret: z.string(),
  tokenUrl: z.string().url(),
  authorizationUrl: z.string().url().optional(),
  scopes: z.array(z.string()).optional(),
  accessToken: z.string().optional(),
  refreshToken: z.string().optional(),
  expiresAt: z.number().optional(),
});

const MCPApiKeyConfigSchema = z.object({
  apiKey: z.string(),
  headerName: z.string().default('Authorization'),
  headerPrefix: z.string().default('Bearer'),
});

const MCPAuthConfigSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('oauth'),
    oauth: MCPOAuthConfigSchema,
  }),
  z.object({
    type: z.literal('api-key'),
    apiKey: MCPApiKeyConfigSchema,
  }),
  z.object({
    type: z.literal('none'),
  }),
]);

const CreateMCPServerSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(1024).optional(),
  url: z.string().url(),
  transport: MCPTransportTypeSchema.optional().default('streamable-http'),
  authType: MCPAuthTypeSchema.optional().default('none'),
  authConfig: MCPAuthConfigSchema.optional(),
  enabled: z.boolean().optional().default(true),
  priority: z.number().int().min(0).optional().default(0),
  connectionTimeoutMs: z.number().int().positive().optional().default(30000),
  requestTimeoutMs: z.number().int().positive().optional().default(60000),
  maxRetries: z.number().int().min(0).optional().default(3),
});

const UpdateMCPServerSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(1024).optional(),
  url: z.string().url().optional(),
  transport: MCPTransportTypeSchema.optional(),
  authType: MCPAuthTypeSchema.optional(),
  authConfig: MCPAuthConfigSchema.optional(),
  enabled: z.boolean().optional(),
  priority: z.number().int().min(0).optional(),
  connectionTimeoutMs: z.number().int().positive().optional(),
  requestTimeoutMs: z.number().int().positive().optional(),
  maxRetries: z.number().int().min(0).optional(),
});

const ServerIdParamSchema = z.object({
  id: z.string().uuid(),
});

// =============================================================================
// Route Factory
// =============================================================================

export interface MCPRouteDependencies {
  mcpServerService: MCPServerService;
  mcpClientManager: MCPClientManager | null;
}

/**
 * Create MCP admin routes
 *
 * Note: These routes should be protected with admin authentication middleware
 */
export function createMCPRoutes(deps: MCPRouteDependencies) {
  const { mcpServerService, mcpClientManager } = deps;
  const app = new Hono();

  // -------------------------------------------------------------------------
  // GET /api/v1/admin/mcp-servers - List all MCP server configurations
  // -------------------------------------------------------------------------
  app.get('/', async (c) => {
    log.debug('Listing MCP servers');

    const servers = await mcpServerService.getAll();

    // Optionally include status information
    const includeStatus = c.req.query('includeStatus') === 'true';
    let statuses: Record<string, unknown> = {};

    if (includeStatus && mcpClientManager) {
      const statusList = mcpClientManager.getAllServerStatus();
      statuses = Object.fromEntries(statusList.map((s) => [s.serverId, s]));
    }

    const response = servers.map((server) => ({
      ...server,
      status: includeStatus ? statuses[server.id] : undefined,
    }));

    return c.json({ servers: response });
  });

  // -------------------------------------------------------------------------
  // GET /api/v1/admin/mcp-servers/:id - Get specific MCP server configuration
  // -------------------------------------------------------------------------
  app.get('/:id', zValidator('param', ServerIdParamSchema), async (c) => {
    const { id } = c.req.valid('param');

    const server = await mcpServerService.getById(id);

    if (!server) {
      return c.json({ error: 'MCP server not found' }, 404);
    }

    // Include status if manager is available
    let status = null;
    if (mcpClientManager) {
      const client = mcpClientManager.getClient(id);
      if (client) {
        status = client.getStatus();
      }
    }

    return c.json({ server, status });
  });

  // -------------------------------------------------------------------------
  // POST /api/v1/admin/mcp-servers - Create new MCP server configuration
  // -------------------------------------------------------------------------
  app.post('/', zValidator('json', CreateMCPServerSchema), async (c) => {
    const body = c.req.valid('json') as z.infer<typeof CreateMCPServerSchema>;

    log.info('Creating MCP server', { name: body.name, url: body.url });

    const server = await mcpServerService.create({
      name: body.name,
      url: body.url,
      transport: body.transport,
      authType: body.authType,
      authConfig: body.authConfig,
      enabled: body.enabled,
      priority: body.priority,
      connectionTimeoutMs: body.connectionTimeoutMs,
      requestTimeoutMs: body.requestTimeoutMs,
      maxRetries: body.maxRetries,
      description: body.description,
    });

    // Refresh manager if available
    if (mcpClientManager) {
      try {
        await mcpClientManager.refreshConfigurations();
      } catch (error) {
        log.warn('Failed to refresh MCP client manager after create', error as Record<string, unknown>);
      }
    }

    return c.json({ server }, 201);
  });

  // -------------------------------------------------------------------------
  // PUT /api/v1/admin/mcp-servers/:id - Update MCP server configuration
  // -------------------------------------------------------------------------
  app.put(
    '/:id',
    zValidator('param', ServerIdParamSchema),
    zValidator('json', UpdateMCPServerSchema),
    async (c) => {
      const { id } = c.req.valid('param');
      const body = c.req.valid('json') as z.infer<typeof UpdateMCPServerSchema>;

      log.info('Updating MCP server', { id, updates: Object.keys(body) });

      const server = await mcpServerService.update(id, body as Record<string, unknown>);

      if (!server) {
        return c.json({ error: 'MCP server not found' }, 404);
      }

      // Refresh manager if available
      if (mcpClientManager) {
        try {
          await mcpClientManager.refreshConfigurations();
        } catch (error) {
          log.warn('Failed to refresh MCP client manager after update', error as Record<string, unknown>);
        }
      }

      return c.json({ server });
    }
  );

  // -------------------------------------------------------------------------
  // DELETE /api/v1/admin/mcp-servers/:id - Delete MCP server configuration
  // -------------------------------------------------------------------------
  app.delete('/:id', zValidator('param', ServerIdParamSchema), async (c) => {
    const { id } = c.req.valid('param');

    log.info('Deleting MCP server', { id });

    const deleted = await mcpServerService.delete(id);

    if (!deleted) {
      return c.json({ error: 'MCP server not found' }, 404);
    }

    // Refresh manager if available
    if (mcpClientManager) {
      try {
        await mcpClientManager.refreshConfigurations();
      } catch (error) {
        log.warn('Failed to refresh MCP client manager after delete', error as Record<string, unknown>);
      }
    }

    return c.json({ success: true });
  });

  // -------------------------------------------------------------------------
  // POST /api/v1/admin/mcp-servers/:id/test - Test connection to MCP server
  // -------------------------------------------------------------------------
  app.post('/:id/test', zValidator('param', ServerIdParamSchema), async (c) => {
    const { id } = c.req.valid('param');

    log.info('Testing MCP server connection', { id });

    const result = await mcpServerService.testConnection(id);

    return c.json(result);
  });

  // -------------------------------------------------------------------------
  // POST /api/v1/admin/mcp-servers/:id/reconnect - Force reconnect to server
  // -------------------------------------------------------------------------
  app.post('/:id/reconnect', zValidator('param', ServerIdParamSchema), async (c) => {
    const { id } = c.req.valid('param');

    if (!mcpClientManager) {
      return c.json({ error: 'MCP client manager not available' }, 503);
    }

    log.info('Reconnecting to MCP server', { id });

    try {
      await mcpClientManager.reconnectServer(id);
      return c.json({ success: true });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return c.json({ success: false, error: errorMessage }, 500);
    }
  });

  // -------------------------------------------------------------------------
  // POST /api/v1/admin/mcp-servers/:id/enable - Enable MCP server
  // -------------------------------------------------------------------------
  app.post('/:id/enable', zValidator('param', ServerIdParamSchema), async (c) => {
    const { id } = c.req.valid('param');

    const server = await mcpServerService.setEnabled(id, true);

    if (!server) {
      return c.json({ error: 'MCP server not found' }, 404);
    }

    // Refresh manager
    if (mcpClientManager) {
      try {
        await mcpClientManager.refreshConfigurations();
      } catch (error) {
        log.warn('Failed to refresh MCP client manager after enable', error as Record<string, unknown>);
      }
    }

    return c.json({ server });
  });

  // -------------------------------------------------------------------------
  // POST /api/v1/admin/mcp-servers/:id/disable - Disable MCP server
  // -------------------------------------------------------------------------
  app.post('/:id/disable', zValidator('param', ServerIdParamSchema), async (c) => {
    const { id } = c.req.valid('param');

    const server = await mcpServerService.setEnabled(id, false);

    if (!server) {
      return c.json({ error: 'MCP server not found' }, 404);
    }

    // Refresh manager
    if (mcpClientManager) {
      try {
        await mcpClientManager.refreshConfigurations();
      } catch (error) {
        log.warn('Failed to refresh MCP client manager after disable', error as Record<string, unknown>);
      }
    }

    return c.json({ server });
  });

  return app;
}

// =============================================================================
// MCP Tools Debug Route (for development/debugging)
// =============================================================================

/**
 * Create MCP tools debug routes
 *
 * These routes are for debugging and can be mounted at /api/v1/mcp
 */
export function createMCPToolsRoutes(deps: MCPRouteDependencies) {
  const { mcpClientManager } = deps;
  const app = new Hono();

  // -------------------------------------------------------------------------
  // GET /api/v1/mcp/tools - List all available MCP tools
  // -------------------------------------------------------------------------
  app.get('/tools', async (c) => {
    if (!mcpClientManager) {
      return c.json({ error: 'MCP client manager not available', tools: [] });
    }

    try {
      const tools = await mcpClientManager.getToolDefinitions();
      return c.json({ tools, count: tools.length });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return c.json({ error: errorMessage, tools: [] }, 500);
    }
  });

  // -------------------------------------------------------------------------
  // GET /api/v1/mcp/status - Get status of all MCP servers
  // -------------------------------------------------------------------------
  app.get('/status', async (c) => {
    if (!mcpClientManager) {
      return c.json({ error: 'MCP client manager not available', servers: [] });
    }

    const servers = mcpClientManager.getAllServerStatus();
    return c.json({ servers });
  });

  return app;
}
