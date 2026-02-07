// =============================================================================
// Secrets Routes
// =============================================================================
// API endpoints for managing user secrets (API keys, tokens, etc.)
// All endpoints require authentication.

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { secretsService } from '../../../services/index.js';
import { authMiddleware, type AuthVariables } from '../middleware/auth.js';

// =============================================================================
// Request Schemas
// =============================================================================

/**
 * Valid provider types
 */
const providerEnum = z.enum(['openai', 'anthropic', 'composio', 'github', 'custom']);

/**
 * Create a new secret
 */
const createSecretSchema = z.object({
  provider: providerEnum,
  name: z.string().min(1, 'Name is required').max(255, 'Name too long'),
  value: z.string().min(1, 'Value is required'),
});

/**
 * Update an existing secret
 */
const updateSecretSchema = z
  .object({
    name: z.string().min(1).max(255).optional(),
    value: z.string().min(1).optional(),
  })
  .refine((data) => data.name !== undefined || data.value !== undefined, {
    message: 'At least one field (name or value) must be provided',
  });

// =============================================================================
// Routes
// =============================================================================

export const secretsRoutes = new Hono<{ Variables: AuthVariables }>();

// All routes require authentication
secretsRoutes.use('*', authMiddleware);

/**
 * GET /api/v1/secrets
 * List all secrets for the current user (metadata only, no values)
 *
 * Response:
 * - data: Array of { id, provider, name, createdAt, updatedAt }
 */
secretsRoutes.get('/', async (c) => {
  const userId = c.get('userId');

  const secrets = await secretsService.list(userId);

  return c.json({
    data: secrets.map((s) => ({
      id: s.id,
      provider: s.provider,
      name: s.name,
      createdAt: s.createdAt.toISOString(),
      updatedAt: s.updatedAt.toISOString(),
    })),
  });
});

/**
 * POST /api/v1/secrets
 * Create a new secret
 *
 * Request body:
 * - provider: 'openai' | 'anthropic' | 'composio' | 'github' | 'custom'
 * - name: string (1-255 chars)
 * - value: string (the secret value to encrypt and store)
 *
 * Response: 201
 * - data: { id, provider, name, createdAt }
 *
 * Errors:
 * - 409 Conflict: Secret for this provider already exists
 */
secretsRoutes.post('/', zValidator('json', createSecretSchema), async (c) => {
  const userId = c.get('userId');
  const { provider, name, value } = c.req.valid('json');

  const secret = await secretsService.create(userId, { provider, name, value });

  return c.json(
    {
      data: {
        id: secret.id,
        provider: secret.provider,
        name: secret.name,
        createdAt: secret.createdAt.toISOString(),
      },
    },
    201
  );
});

/**
 * PATCH /api/v1/secrets/:id
 * Update an existing secret
 *
 * Request body (at least one required):
 * - name: string (1-255 chars)
 * - value: string (new secret value to encrypt)
 *
 * Response: 200
 * - data: { id, provider, name, updatedAt }
 *
 * Errors:
 * - 404 Not Found: Secret not found or doesn't belong to user
 */
secretsRoutes.patch('/:id', zValidator('json', updateSecretSchema), async (c) => {
  const userId = c.get('userId');
  const secretId = c.req.param('id');
  const { name, value } = c.req.valid('json');

  const secret = await secretsService.update(userId, secretId, { name, value });

  return c.json({
    data: {
      id: secret.id,
      provider: secret.provider,
      name: secret.name,
      updatedAt: secret.updatedAt.toISOString(),
    },
  });
});

/**
 * DELETE /api/v1/secrets/:id
 * Delete a secret
 *
 * Response: 204 No Content
 *
 * Errors:
 * - 404 Not Found: Secret not found or doesn't belong to user
 */
secretsRoutes.delete('/:id', async (c) => {
  const userId = c.get('userId');
  const secretId = c.req.param('id');

  await secretsService.delete(userId, secretId);

  return c.body(null, 204);
});
