// =============================================================================
// Auth Routes
// =============================================================================
// Authentication endpoints: register, login, refresh, logout, me

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { authService } from '../../../services/index.js';
import { authMiddleware, type AuthVariables } from '../middleware/auth.js';

// =============================================================================
// Request Schemas
// =============================================================================

/**
 * Register a new user
 */
const registerSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  displayName: z.string().max(255).optional(),
});

/**
 * Login with email and password
 */
const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

/**
 * Refresh access token
 */
const refreshSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
});

/**
 * Logout (invalidate refresh token)
 */
const logoutSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
});

// =============================================================================
// Routes
// =============================================================================

export const authRoutes = new Hono<{ Variables: AuthVariables }>();

/**
 * POST /api/v1/auth/register
 * Register a new user account
 *
 * Request body:
 * - email: string (required, valid email)
 * - password: string (required, min 8 chars, must contain letter and number)
 * - displayName: string (optional, max 255 chars)
 *
 * Response:
 * - user: { id, email, displayName, createdAt }
 * - tokens: { accessToken, refreshToken, expiresIn }
 */
authRoutes.post('/register', zValidator('json', registerSchema), async (c) => {
  const { email, password, displayName } = c.req.valid('json');

  const result = await authService.register(email, password, displayName);

  return c.json(
    {
      data: {
        user: {
          id: result.user.id,
          email: result.user.email,
          displayName: result.user.displayName,
          createdAt: result.user.createdAt.toISOString(),
        },
        tokens: {
          accessToken: result.tokens.accessToken,
          refreshToken: result.tokens.refreshToken,
          expiresIn: result.tokens.expiresIn,
        },
      },
    },
    201
  );
});

/**
 * POST /api/v1/auth/login
 * Login with email and password
 *
 * Request body:
 * - email: string (required, valid email)
 * - password: string (required)
 *
 * Response:
 * - user: { id, email, displayName, createdAt }
 * - tokens: { accessToken, refreshToken, expiresIn }
 */
authRoutes.post('/login', zValidator('json', loginSchema), async (c) => {
  const { email, password } = c.req.valid('json');

  const result = await authService.login(email, password);

  return c.json({
    data: {
      user: {
        id: result.user.id,
        email: result.user.email,
        displayName: result.user.displayName,
        createdAt: result.user.createdAt.toISOString(),
      },
      tokens: {
        accessToken: result.tokens.accessToken,
        refreshToken: result.tokens.refreshToken,
        expiresIn: result.tokens.expiresIn,
      },
    },
  });
});

/**
 * POST /api/v1/auth/refresh
 * Refresh access token using a valid refresh token
 *
 * Request body:
 * - refreshToken: string (required)
 *
 * Response:
 * - accessToken: string
 * - refreshToken: string (new token, old one is invalidated)
 * - expiresIn: number (seconds)
 */
authRoutes.post('/refresh', zValidator('json', refreshSchema), async (c) => {
  const { refreshToken } = c.req.valid('json');

  const tokens = await authService.refresh(refreshToken);

  return c.json({
    data: {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresIn: tokens.expiresIn,
    },
  });
});

/**
 * POST /api/v1/auth/logout
 * Logout by invalidating the refresh token
 *
 * Request body:
 * - refreshToken: string (required)
 *
 * Response: 204 No Content
 */
authRoutes.post('/logout', zValidator('json', logoutSchema), async (c) => {
  const { refreshToken } = c.req.valid('json');

  await authService.logout(refreshToken);

  return c.body(null, 204);
});

/**
 * GET /api/v1/auth/me
 * Get current authenticated user's profile
 *
 * Requires: Bearer token in Authorization header
 *
 * Response:
 * - id: string (uuid)
 * - email: string
 * - displayName: string | null
 * - createdAt: string (ISO 8601)
 */
authRoutes.get('/me', authMiddleware, async (c) => {
  const userId = c.get('userId');

  const user = await authService.getUserById(userId);

  if (!user) {
    return c.json(
      {
        error: {
          code: 'USER_NOT_FOUND',
          message: 'User not found',
        },
      },
      404
    );
  }

  return c.json({
    data: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      createdAt: user.createdAt.toISOString(),
    },
  });
});

/**
 * POST /api/v1/auth/logout-all
 * Logout from all devices by invalidating all refresh tokens
 *
 * Requires: Bearer token in Authorization header
 *
 * Response:
 * - sessionsRevoked: number (count of revoked sessions)
 */
authRoutes.post('/logout-all', authMiddleware, async (c) => {
  const userId = c.get('userId');

  const count = await authService.logoutAll(userId);

  return c.json({
    data: {
      sessionsRevoked: count,
    },
  });
});
