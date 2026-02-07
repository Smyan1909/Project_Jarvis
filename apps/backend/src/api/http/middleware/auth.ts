// =============================================================================
// Authentication Middleware
// =============================================================================
// Stub implementation - to be completed with actual JWT validation

import type { Context, Next } from 'hono';

/**
 * Variables added to context by auth middleware
 */
export interface AuthVariables {
  userId: string;
}

/**
 * Authentication middleware
 *
 * Currently a stub that allows unauthenticated requests in development.
 * TODO: Implement actual JWT validation for production.
 *
 * Usage:
 * ```typescript
 * import { authMiddleware } from './middleware/auth.js';
 *
 * app.use('/api/v1/*', authMiddleware);
 *
 * // Access userId in route handlers
 * app.get('/api/v1/me', (c) => {
 *   const userId = c.get('userId');
 *   return c.json({ userId });
 * });
 * ```
 */
export async function authMiddleware(c: Context, next: Next): Promise<Response | void> {
  const authHeader = c.req.header('Authorization');

  if (!authHeader) {
    // In development, allow unauthenticated requests
    if (process.env.NODE_ENV === 'development') {
      c.set('userId', 'dev-user-anonymous');
      return next();
    }

    return c.json(
      {
        error: 'Unauthorized',
        message: 'Authorization header is required',
      },
      401
    );
  }

  // Extract token from "Bearer <token>" format
  const token = authHeader.replace('Bearer ', '');

  if (!token) {
    return c.json(
      {
        error: 'Unauthorized',
        message: 'Invalid authorization format. Use: Bearer <token>',
      },
      401
    );
  }

  // TODO: Validate JWT token and extract user ID
  // For now, use a placeholder
  try {
    // Placeholder: In production, validate the JWT here
    // const payload = await validateJWT(token);
    // c.set('userId', payload.sub);

    // Stub implementation
    c.set('userId', 'user-from-token');

    return next();
  } catch (error) {
    return c.json(
      {
        error: 'Unauthorized',
        message: 'Invalid or expired token',
      },
      401
    );
  }
}

/**
 * Optional authentication middleware
 *
 * Sets userId if Authorization header is present, but doesn't require it.
 * Useful for endpoints that behave differently for authenticated users.
 */
export async function optionalAuthMiddleware(c: Context, next: Next): Promise<Response | void> {
  const authHeader = c.req.header('Authorization');

  if (authHeader) {
    const token = authHeader.replace('Bearer ', '');

    if (token) {
      // TODO: Validate JWT and extract user ID
      c.set('userId', 'user-from-token');
    }
  } else {
    c.set('userId', 'anonymous');
  }

  return next();
}
