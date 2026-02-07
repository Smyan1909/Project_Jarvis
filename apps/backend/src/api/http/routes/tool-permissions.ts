// =============================================================================
// Tool Permissions Routes
// =============================================================================
// API endpoints for managing user tool permissions.
// All endpoints require authentication.

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { ToolPermissionRepository } from '../../../adapters/storage/tool-permission-repository.js';
import { authMiddleware, type AuthVariables } from '../middleware/auth.js';

// =============================================================================
// Request Schemas
// =============================================================================

/**
 * Grant or revoke permission for a tool
 */
const setPermissionSchema = z.object({
  toolId: z.string().min(1, 'Tool ID is required').max(255, 'Tool ID too long'),
  granted: z.boolean(),
});

/**
 * Bulk permission update
 */
const bulkPermissionSchema = z.object({
  toolIds: z.array(z.string().min(1).max(255)).min(1, 'At least one tool ID required'),
  granted: z.boolean(),
});

// =============================================================================
// Repository Instance
// =============================================================================

const permissionRepository = new ToolPermissionRepository();

// =============================================================================
// Routes
// =============================================================================

export const toolPermissionsRoutes = new Hono<{ Variables: AuthVariables }>();

// All routes require authentication
toolPermissionsRoutes.use('*', authMiddleware);

/**
 * GET /api/v1/tool-permissions
 * List all explicit permission entries for the current user
 *
 * Response:
 * - data: Array of { id, toolId, granted, createdAt, updatedAt }
 */
toolPermissionsRoutes.get('/', async (c) => {
  const userId = c.get('userId');

  const permissions = await permissionRepository.findByUser(userId);

  return c.json({
    data: permissions.map((p) => ({
      id: p.id,
      toolId: p.toolId,
      granted: p.granted,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    })),
  });
});

/**
 * GET /api/v1/tool-permissions/denied
 * List all tools explicitly denied for the current user
 *
 * Response:
 * - data: Array of tool IDs
 */
toolPermissionsRoutes.get('/denied', async (c) => {
  const userId = c.get('userId');

  const deniedTools = await permissionRepository.getDeniedTools(userId);

  return c.json({
    data: deniedTools,
  });
});

/**
 * GET /api/v1/tool-permissions/check/:toolId
 * Check if current user has permission for a specific tool
 *
 * Response:
 * - toolId: string
 * - granted: boolean
 */
toolPermissionsRoutes.get('/check/:toolId', async (c) => {
  const userId = c.get('userId');
  const toolId = c.req.param('toolId');

  const granted = await permissionRepository.hasPermission(userId, toolId);

  return c.json({
    toolId,
    granted,
  });
});

/**
 * POST /api/v1/tool-permissions
 * Set permission for a tool (grant or revoke)
 *
 * Request body:
 * - toolId: string
 * - granted: boolean
 *
 * Response: 200
 * - data: { id, toolId, granted, createdAt, updatedAt }
 */
toolPermissionsRoutes.post('/', zValidator('json', setPermissionSchema), async (c) => {
  const userId = c.get('userId');
  const { toolId, granted } = c.req.valid('json');

  const permission = await permissionRepository.upsert({
    userId,
    toolId,
    granted,
  });

  return c.json({
    data: {
      id: permission.id,
      toolId: permission.toolId,
      granted: permission.granted,
      createdAt: permission.createdAt.toISOString(),
      updatedAt: permission.updatedAt.toISOString(),
    },
  });
});

/**
 * POST /api/v1/tool-permissions/bulk
 * Bulk update permissions for multiple tools
 *
 * Request body:
 * - toolIds: string[]
 * - granted: boolean
 *
 * Response: 200
 * - updated: number of permissions updated
 */
toolPermissionsRoutes.post('/bulk', zValidator('json', bulkPermissionSchema), async (c) => {
  const userId = c.get('userId');
  const { toolIds, granted } = c.req.valid('json');

  if (granted) {
    await permissionRepository.bulkGrant(userId, toolIds);
  } else {
    await permissionRepository.bulkRevoke(userId, toolIds);
  }

  return c.json({
    updated: toolIds.length,
    granted,
  });
});

/**
 * DELETE /api/v1/tool-permissions/:toolId
 * Remove explicit permission entry for a tool (resets to default allowed)
 *
 * Response: 204 No Content
 */
toolPermissionsRoutes.delete('/:toolId', async (c) => {
  const userId = c.get('userId');
  const toolId = c.req.param('toolId');

  await permissionRepository.deletePermission(userId, toolId);

  return c.body(null, 204);
});
