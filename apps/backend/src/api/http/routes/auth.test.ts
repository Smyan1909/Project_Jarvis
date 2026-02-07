// =============================================================================
// Auth Routes - Integration Tests
// =============================================================================
// Tests for authentication API endpoints.
// Uses Hono's test client and runs against the real database.

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { app } from '../router.js';
import { db, queryClient } from '../../../infrastructure/db/client.js';
import { users, refreshTokens } from '../../../infrastructure/db/schema.js';

// =============================================================================
// Response Types
// =============================================================================

interface AuthUserResponse {
  id: string;
  email: string;
  displayName: string | null;
  createdAt: string;
}

interface AuthTokensResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

interface AuthSuccessResponse {
  data: {
    user: AuthUserResponse;
    tokens: AuthTokensResponse;
  };
}

interface RefreshSuccessResponse {
  data: AuthTokensResponse;
}

interface MeSuccessResponse {
  data: AuthUserResponse;
}

interface LogoutAllSuccessResponse {
  data: {
    sessionsRevoked: number;
  };
}

interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

describe('Auth Routes Integration', () => {
  const testEmails: string[] = [];
  
  // Helper to generate unique test emails
  const generateTestEmail = () => {
    const email = `test-auth-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
    testEmails.push(email.toLowerCase());
    return email;
  };

  // Helper to make requests to the app
  const request = (path: string, options?: RequestInit) => {
    return app.request(path, options);
  };

  afterEach(async () => {
    // Clean up test users and their refresh tokens
    for (const email of testEmails) {
      const user = await db.select().from(users).where(sql`email = ${email}`);
      if (user.length > 0) {
        await db.delete(refreshTokens).where(sql`user_id = ${user[0].id}`);
        await db.delete(users).where(sql`email = ${email}`);
      }
    }
    testEmails.length = 0;
  });

  afterAll(async () => {
    await queryClient.end();
  });

  // ===========================================================================
  // POST /api/v1/auth/register
  // ===========================================================================

  describe('POST /api/v1/auth/register', () => {
    it('should register a new user successfully', async () => {
      const email = generateTestEmail();
      
      const res = await request('/api/v1/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          password: 'password123',
          displayName: 'Test User',
        }),
      });

      expect(res.status).toBe(201);
      
      const body = await res.json() as AuthSuccessResponse;
      expect(body.data).toBeDefined();
      expect(body.data.user.email).toBe(email.toLowerCase());
      expect(body.data.user.displayName).toBe('Test User');
      expect(body.data.user.id).toBeDefined();
      expect(body.data.user.createdAt).toBeDefined();
      expect(body.data.tokens.accessToken).toBeDefined();
      expect(body.data.tokens.refreshToken).toBeDefined();
      expect(body.data.tokens.expiresIn).toBeGreaterThan(0);
    });

    it('should register without displayName', async () => {
      const email = generateTestEmail();
      
      const res = await request('/api/v1/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          password: 'password123',
        }),
      });

      expect(res.status).toBe(201);
      
      const body = await res.json() as AuthSuccessResponse;
      expect(body.data.user.displayName).toBeNull();
    });

    it('should reject duplicate email', async () => {
      const email = generateTestEmail();
      
      // First registration
      await request('/api/v1/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          password: 'password123',
        }),
      });

      // Second registration with same email
      const res = await request('/api/v1/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          password: 'password456',
        }),
      });

      expect(res.status).toBe(409);
      
      const body = await res.json() as ErrorResponse;
      expect(body.error).toBeDefined();
      expect(body.error.code).toBe('CONFLICT');
    });

    it('should reject invalid email format', async () => {
      const res = await request('/api/v1/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'not-an-email',
          password: 'password123',
        }),
      });

      expect(res.status).toBe(400);
    });

    it('should reject password shorter than 8 characters', async () => {
      const email = generateTestEmail();
      
      const res = await request('/api/v1/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          password: 'short1',
        }),
      });

      expect(res.status).toBe(400);
    });

    it('should reject password without letter and number', async () => {
      const email = generateTestEmail();
      
      const res = await request('/api/v1/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          password: 'onlyletters',
        }),
      });

      expect(res.status).toBe(400);
      
      const body = await res.json() as ErrorResponse;
      expect(body.error).toBeDefined();
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  // ===========================================================================
  // POST /api/v1/auth/login
  // ===========================================================================

  describe('POST /api/v1/auth/login', () => {
    it('should login successfully with correct credentials', async () => {
      const email = generateTestEmail();
      const password = 'password123';
      
      // Register first
      await request('/api/v1/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      // Login
      const res = await request('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      expect(res.status).toBe(200);
      
      const body = await res.json() as AuthSuccessResponse;
      expect(body.data).toBeDefined();
      expect(body.data.user.email).toBe(email.toLowerCase());
      expect(body.data.tokens.accessToken).toBeDefined();
      expect(body.data.tokens.refreshToken).toBeDefined();
    });

    it('should reject non-existent email', async () => {
      const res = await request('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'nonexistent@example.com',
          password: 'password123',
        }),
      });

      expect(res.status).toBe(401);
      
      const body = await res.json() as ErrorResponse;
      expect(body.error).toBeDefined();
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('should reject wrong password', async () => {
      const email = generateTestEmail();
      
      // Register
      await request('/api/v1/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          password: 'password123',
        }),
      });

      // Login with wrong password
      const res = await request('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          password: 'wrongpassword1',
        }),
      });

      expect(res.status).toBe(401);
      
      const body = await res.json() as ErrorResponse;
      expect(body.error).toBeDefined();
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('should reject invalid email format', async () => {
      const res = await request('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'not-an-email',
          password: 'password123',
        }),
      });

      expect(res.status).toBe(400);
    });
  });

  // ===========================================================================
  // POST /api/v1/auth/refresh
  // ===========================================================================

  describe('POST /api/v1/auth/refresh', () => {
    it('should refresh tokens with valid refresh token', async () => {
      const email = generateTestEmail();
      
      // Register to get tokens
      const registerRes = await request('/api/v1/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          password: 'password123',
        }),
      });
      
      const registerBody = await registerRes.json() as AuthSuccessResponse;
      const refreshToken = registerBody.data.tokens.refreshToken;

      // Refresh
      const res = await request('/api/v1/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });

      expect(res.status).toBe(200);
      
      const body = await res.json() as RefreshSuccessResponse;
      expect(body.data).toBeDefined();
      expect(body.data.accessToken).toBeDefined();
      expect(body.data.refreshToken).toBeDefined();
      expect(body.data.expiresIn).toBeGreaterThan(0);
      
      // New refresh token should be different (token rotation)
      expect(body.data.refreshToken).not.toBe(refreshToken);
    });

    it('should reject invalid refresh token', async () => {
      const res = await request('/api/v1/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          refreshToken: 'invalid-token-here',
        }),
      });

      expect(res.status).toBe(401);
      
      const body = await res.json() as ErrorResponse;
      expect(body.error).toBeDefined();
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('should reject already-used refresh token (after rotation)', async () => {
      const email = generateTestEmail();
      
      // Register to get tokens
      const registerRes = await request('/api/v1/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          password: 'password123',
        }),
      });
      
      const registerBody = await registerRes.json() as AuthSuccessResponse;
      const refreshToken = registerBody.data.tokens.refreshToken;

      // First refresh (should succeed)
      await request('/api/v1/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });

      // Second refresh with same token (should fail - token was rotated)
      const res = await request('/api/v1/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });

      expect(res.status).toBe(401);
    });

    it('should reject empty refresh token', async () => {
      const res = await request('/api/v1/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: '' }),
      });

      expect(res.status).toBe(400);
    });
  });

  // ===========================================================================
  // POST /api/v1/auth/logout
  // ===========================================================================

  describe('POST /api/v1/auth/logout', () => {
    it('should logout successfully with valid refresh token', async () => {
      const email = generateTestEmail();
      
      // Register to get tokens
      const registerRes = await request('/api/v1/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          password: 'password123',
        }),
      });
      
      const registerBody = await registerRes.json() as AuthSuccessResponse;
      const refreshToken = registerBody.data.tokens.refreshToken;

      // Logout
      const res = await request('/api/v1/auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });

      expect(res.status).toBe(204);
    });

    it('should invalidate refresh token after logout', async () => {
      const email = generateTestEmail();
      
      // Register to get tokens
      const registerRes = await request('/api/v1/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          password: 'password123',
        }),
      });
      
      const registerBody = await registerRes.json() as AuthSuccessResponse;
      const refreshToken = registerBody.data.tokens.refreshToken;

      // Logout
      await request('/api/v1/auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });

      // Try to refresh with the invalidated token
      const res = await request('/api/v1/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });

      expect(res.status).toBe(401);
    });

    it('should succeed even with invalid refresh token (idempotent)', async () => {
      const res = await request('/api/v1/auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          refreshToken: 'invalid-token',
        }),
      });

      // Logout is idempotent - should not error
      expect(res.status).toBe(204);
    });
  });

  // ===========================================================================
  // GET /api/v1/auth/me
  // ===========================================================================

  describe('GET /api/v1/auth/me', () => {
    it('should return current user with valid access token', async () => {
      const email = generateTestEmail();
      const displayName = 'Test User';
      
      // Register to get tokens
      const registerRes = await request('/api/v1/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          password: 'password123',
          displayName,
        }),
      });
      
      const registerBody = await registerRes.json() as AuthSuccessResponse;
      const accessToken = registerBody.data.tokens.accessToken;

      // Get current user
      const res = await request('/api/v1/auth/me', {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      expect(res.status).toBe(200);
      
      const body = await res.json() as MeSuccessResponse;
      expect(body.data).toBeDefined();
      expect(body.data.email).toBe(email.toLowerCase());
      expect(body.data.displayName).toBe(displayName);
      expect(body.data.id).toBeDefined();
      expect(body.data.createdAt).toBeDefined();
    });

    it('should reject request without authorization header', async () => {
      const res = await request('/api/v1/auth/me', {
        method: 'GET',
      });

      expect(res.status).toBe(401);
      
      const body = await res.json() as ErrorResponse;
      expect(body.error).toBeDefined();
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('should reject request with invalid token', async () => {
      const res = await request('/api/v1/auth/me', {
        method: 'GET',
        headers: { Authorization: 'Bearer invalid-token' },
      });

      expect(res.status).toBe(401);
      
      const body = await res.json() as ErrorResponse;
      expect(body.error).toBeDefined();
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('should reject request with malformed authorization header', async () => {
      const res = await request('/api/v1/auth/me', {
        method: 'GET',
        headers: { Authorization: 'NotBearer token' },
      });

      expect(res.status).toBe(401);
    });
  });

  // ===========================================================================
  // POST /api/v1/auth/logout-all
  // ===========================================================================

  describe('POST /api/v1/auth/logout-all', () => {
    it('should logout from all devices', async () => {
      const email = generateTestEmail();
      
      // Register (creates first session)
      const registerRes = await request('/api/v1/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          password: 'password123',
        }),
      });
      
      const registerBody = await registerRes.json() as AuthSuccessResponse;
      const accessToken = registerBody.data.tokens.accessToken;
      const refreshToken1 = registerBody.data.tokens.refreshToken;

      // Login again (creates second session)
      const loginRes = await request('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          password: 'password123',
        }),
      });
      
      const loginBody = await loginRes.json() as AuthSuccessResponse;
      const refreshToken2 = loginBody.data.tokens.refreshToken;

      // Logout all
      const res = await request('/api/v1/auth/logout-all', {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      expect(res.status).toBe(200);
      
      const body = await res.json() as LogoutAllSuccessResponse;
      expect(body.data).toBeDefined();
      expect(body.data.sessionsRevoked).toBeGreaterThanOrEqual(2);

      // Both refresh tokens should now be invalid
      const refresh1Res = await request('/api/v1/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: refreshToken1 }),
      });
      expect(refresh1Res.status).toBe(401);

      const refresh2Res = await request('/api/v1/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: refreshToken2 }),
      });
      expect(refresh2Res.status).toBe(401);
    });

    it('should reject request without authorization', async () => {
      const res = await request('/api/v1/auth/logout-all', {
        method: 'POST',
      });

      expect(res.status).toBe(401);
    });

    it('should return 0 sessions if no active sessions', async () => {
      const email = generateTestEmail();
      
      // Register
      const registerRes = await request('/api/v1/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          password: 'password123',
        }),
      });
      
      const registerBody = await registerRes.json() as AuthSuccessResponse;
      const accessToken = registerBody.data.tokens.accessToken;
      const refreshToken = registerBody.data.tokens.refreshToken;

      // Logout first
      await request('/api/v1/auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });

      // Logout all (no sessions left)
      const res = await request('/api/v1/auth/logout-all', {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      expect(res.status).toBe(200);
      
      const body = await res.json() as LogoutAllSuccessResponse;
      expect(body.data.sessionsRevoked).toBe(0);
    });
  });
});
