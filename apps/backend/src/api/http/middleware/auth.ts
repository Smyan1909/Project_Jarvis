// =============================================================================
// Authentication Middleware
// =============================================================================
// JWT-based authentication middleware for protected routes.

import type { Context, Next } from 'hono';
import { authService } from '../../../services/index.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Variables added to Hono context by auth middleware
 */
export interface AuthVariables {
  userId: string;
  userEmail: string;
}

// =============================================================================
// Auth Middleware
// =============================================================================

/**
 * Authentication middleware - requires valid JWT token
 *
 * Validates the Authorization header and extracts user info from the JWT.
 * Throws an error if the token is missing, invalid, or expired.
 *
 * Usage:
 * ```typescript
 * import { authMiddleware } from './middleware/auth.js';
 *
 * // Protect a single route
 * app.get('/api/v1/me', authMiddleware, (c) => {
 *   const userId = c.get('userId');
 *   const userEmail = c.get('userEmail');
 *   return c.json({ userId, userEmail });
 * });
 *
 * // Protect all routes under a path
 * app.use('/api/v1/protected/*', authMiddleware);
 * ```
 */
export async function authMiddleware(c: Context, next: Next): Promise<Response | void> {
  const authHeader = c.req.header('Authorization');

  if (!authHeader) {
    return c.json(
      {
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authorization header is required',
        },
      },
      401
    );
  }

  if (!authHeader.startsWith('Bearer ')) {
    return c.json(
      {
        error: {
          code: 'UNAUTHORIZED',
          message: 'Invalid authorization format. Use: Bearer <token>',
        },
      },
      401
    );
  }

  const token = authHeader.slice(7);

  if (!token) {
    return c.json(
      {
        error: {
          code: 'UNAUTHORIZED',
          message: 'Token is required',
        },
      },
      401
    );
  }

  try {
    const payload = authService.verifyAccessToken(token);

    c.set('userId', payload.userId);
    c.set('userEmail', payload.email);

    return next();
  } catch (error) {
    return c.json(
      {
        error: {
          code: 'UNAUTHORIZED',
          message: 'Invalid or expired access token',
        },
      },
      401
    );
  }
}

// =============================================================================
// Optional Auth Middleware
// =============================================================================

/**
 * Optional authentication middleware
 *
 * Sets userId and userEmail if a valid token is present, but doesn't require it.
 * Useful for endpoints that behave differently for authenticated users.
 *
 * If no token or invalid token:
 * - userId is set to empty string
 * - userEmail is set to empty string
 */
export async function optionalAuthMiddleware(c: Context, next: Next): Promise<Response | void> {
  const authHeader = c.req.header('Authorization');

  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);

    if (token) {
      try {
        const payload = authService.verifyAccessToken(token);
        c.set('userId', payload.userId);
        c.set('userEmail', payload.email);
        return next();
      } catch {
        // Invalid token - continue as unauthenticated
      }
    }
  }

  // No token or invalid token - set empty values
  c.set('userId', '');
  c.set('userEmail', '');

  return next();
}
