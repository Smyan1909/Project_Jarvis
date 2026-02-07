// =============================================================================
// Secrets Routes - Integration Tests
// =============================================================================
// Tests for secrets API endpoints.
// Uses Hono's test client and runs against the real database.

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { app } from '../router.js';
import { db, queryClient } from '../../../infrastructure/db/client.js';
import { users, userSecrets } from '../../../infrastructure/db/schema.js';
import { authService } from '../../../services/index.js';

// =============================================================================
// Response Types
// =============================================================================

interface SecretResponse {
  id: string;
  provider: string;
  name: string;
  createdAt: string;
  updatedAt?: string;
}

interface SecretsListResponse {
  data: SecretResponse[];
}

interface SecretSuccessResponse {
  data: SecretResponse;
}

interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

// =============================================================================
// Test Setup
// =============================================================================

describe('Secrets Routes Integration', () => {
  let testUserId: string;
  let testUserEmail: string;
  let accessToken: string;
  const testSecretIds: string[] = [];

  // Helper to make authenticated requests
  const request = (path: string, options?: RequestInit) => {
    return app.request(path, {
      ...options,
      headers: {
        ...options?.headers,
        Authorization: `Bearer ${accessToken}`,
      },
    });
  };

  // Helper to make unauthenticated requests
  const unauthenticatedRequest = (path: string, options?: RequestInit) => {
    return app.request(path, options);
  };

  beforeAll(async () => {
    // Create a test user and get access token
    testUserEmail = `test-secrets-routes-${Date.now()}@example.com`;
    const result = await authService.register(testUserEmail, 'password123');
    testUserId = result.user.id;
    accessToken = result.tokens.accessToken;
  });

  afterEach(async () => {
    // Clean up test secrets
    for (const id of testSecretIds) {
      await db.delete(userSecrets).where(sql`id = ${id}`);
    }
    testSecretIds.length = 0;
  });

  afterAll(async () => {
    // Clean up test user (cascades to secrets)
    if (testUserId) {
      await db.delete(users).where(sql`id = ${testUserId}`);
    }
    await queryClient.end();
  });

  // ===========================================================================
  // POST /api/v1/secrets
  // ===========================================================================

  describe('POST /api/v1/secrets', () => {
    it('should create a new secret', async () => {
      const res = await request('/api/v1/secrets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'openai',
          name: 'My OpenAI Key',
          value: 'sk-test-key-12345',
        }),
      });

      expect(res.status).toBe(201);

      const body = (await res.json()) as SecretSuccessResponse;
      expect(body.data).toBeDefined();
      expect(body.data.id).toBeDefined();
      expect(body.data.provider).toBe('openai');
      expect(body.data.name).toBe('My OpenAI Key');
      expect(body.data.createdAt).toBeDefined();

      // Value should NOT be in response
      expect((body.data as unknown as Record<string, unknown>).value).toBeUndefined();
      expect((body.data as unknown as Record<string, unknown>).encryptedValue).toBeUndefined();

      testSecretIds.push(body.data.id);
    });

    it('should reject duplicate provider', async () => {
      // Create first secret
      const res1 = await request('/api/v1/secrets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'anthropic',
          name: 'My Anthropic Key',
          value: 'sk-ant-test-12345',
        }),
      });

      const body1 = (await res1.json()) as SecretSuccessResponse;
      testSecretIds.push(body1.data.id);

      // Try to create second secret for same provider
      const res2 = await request('/api/v1/secrets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'anthropic',
          name: 'Another Key',
          value: 'sk-ant-another',
        }),
      });

      expect(res2.status).toBe(409);

      const body2 = (await res2.json()) as ErrorResponse;
      expect(body2.error.code).toBe('CONFLICT');
    });

    it('should reject invalid provider', async () => {
      const res = await request('/api/v1/secrets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'invalid-provider',
          name: 'Test Key',
          value: 'test-value',
        }),
      });

      expect(res.status).toBe(400);
    });

    it('should reject empty name', async () => {
      const res = await request('/api/v1/secrets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'github',
          name: '',
          value: 'ghp_test123',
        }),
      });

      expect(res.status).toBe(400);
    });

    it('should reject empty value', async () => {
      const res = await request('/api/v1/secrets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'github',
          name: 'GitHub Token',
          value: '',
        }),
      });

      expect(res.status).toBe(400);
    });

    it('should require authentication', async () => {
      const res = await unauthenticatedRequest('/api/v1/secrets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'openai',
          name: 'Test',
          value: 'test',
        }),
      });

      expect(res.status).toBe(401);
    });
  });

  // ===========================================================================
  // GET /api/v1/secrets
  // ===========================================================================

  describe('GET /api/v1/secrets', () => {
    it('should list all secrets for user', async () => {
      // Create some secrets
      const providers = ['openai', 'anthropic'] as const;
      for (const provider of providers) {
        const res = await request('/api/v1/secrets', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            provider,
            name: `${provider} Key`,
            value: 'test-value',
          }),
        });
        const body = (await res.json()) as SecretSuccessResponse;
        testSecretIds.push(body.data.id);
      }

      // List secrets
      const res = await request('/api/v1/secrets');

      expect(res.status).toBe(200);

      const body = (await res.json()) as SecretsListResponse;
      expect(body.data).toHaveLength(2);
      expect(body.data.map((s) => s.provider).sort()).toEqual(['anthropic', 'openai']);

      // Values should NOT be in response
      for (const secret of body.data) {
        expect((secret as unknown as Record<string, unknown>).value).toBeUndefined();
        expect((secret as unknown as Record<string, unknown>).encryptedValue).toBeUndefined();
      }
    });

    it('should return empty array if no secrets', async () => {
      const res = await request('/api/v1/secrets');

      expect(res.status).toBe(200);

      const body = (await res.json()) as SecretsListResponse;
      expect(body.data).toEqual([]);
    });

    it('should require authentication', async () => {
      const res = await unauthenticatedRequest('/api/v1/secrets');

      expect(res.status).toBe(401);
    });

    it('should not return other users secrets', async () => {
      // Create a secret for test user
      const createRes = await request('/api/v1/secrets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'github',
          name: 'GitHub Token',
          value: 'ghp_test',
        }),
      });
      const createBody = (await createRes.json()) as SecretSuccessResponse;
      testSecretIds.push(createBody.data.id);

      // Create another user
      const otherUserResult = await authService.register(
        `other-user-${Date.now()}@example.com`,
        'password123'
      );

      // List secrets as other user
      const res = await app.request('/api/v1/secrets', {
        headers: { Authorization: `Bearer ${otherUserResult.tokens.accessToken}` },
      });

      expect(res.status).toBe(200);

      const body = (await res.json()) as SecretsListResponse;
      expect(body.data).toEqual([]); // Other user should see no secrets

      // Cleanup other user
      await db.delete(users).where(sql`id = ${otherUserResult.user.id}`);
    });
  });

  // ===========================================================================
  // PATCH /api/v1/secrets/:id
  // ===========================================================================

  describe('PATCH /api/v1/secrets/:id', () => {
    it('should update secret name', async () => {
      // Create a secret
      const createRes = await request('/api/v1/secrets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'openai',
          name: 'Original Name',
          value: 'test-value',
        }),
      });
      const createBody = (await createRes.json()) as SecretSuccessResponse;
      testSecretIds.push(createBody.data.id);

      // Update the name
      const res = await request(`/api/v1/secrets/${createBody.data.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Updated Name',
        }),
      });

      expect(res.status).toBe(200);

      const body = (await res.json()) as SecretSuccessResponse;
      expect(body.data.name).toBe('Updated Name');
      expect(body.data.updatedAt).toBeDefined();
    });

    it('should update secret value', async () => {
      // Create a secret
      const createRes = await request('/api/v1/secrets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'anthropic',
          name: 'My Key',
          value: 'original-value',
        }),
      });
      const createBody = (await createRes.json()) as SecretSuccessResponse;
      testSecretIds.push(createBody.data.id);

      // Update the value
      const res = await request(`/api/v1/secrets/${createBody.data.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          value: 'new-secret-value',
        }),
      });

      expect(res.status).toBe(200);

      // Value should NOT be in response
      const body = (await res.json()) as SecretSuccessResponse;
      expect((body.data as unknown as Record<string, unknown>).value).toBeUndefined();
    });

    it('should return 404 for non-existent secret', async () => {
      const res = await request('/api/v1/secrets/00000000-0000-0000-0000-000000000000', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'New Name',
        }),
      });

      expect(res.status).toBe(404);
    });

    it('should return 404 for other users secret', async () => {
      // Create a secret
      const createRes = await request('/api/v1/secrets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'github',
          name: 'My Key',
          value: 'test-value',
        }),
      });
      const createBody = (await createRes.json()) as SecretSuccessResponse;
      testSecretIds.push(createBody.data.id);

      // Create another user
      const otherUserResult = await authService.register(
        `patch-other-${Date.now()}@example.com`,
        'password123'
      );

      // Try to update as other user
      const res = await app.request(`/api/v1/secrets/${createBody.data.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${otherUserResult.tokens.accessToken}`,
        },
        body: JSON.stringify({
          name: 'Hacked Name',
        }),
      });

      expect(res.status).toBe(404);

      // Cleanup other user
      await db.delete(users).where(sql`id = ${otherUserResult.user.id}`);
    });

    it('should reject empty update', async () => {
      // Create a secret
      const createRes = await request('/api/v1/secrets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'composio',
          name: 'My Key',
          value: 'test-value',
        }),
      });
      const createBody = (await createRes.json()) as SecretSuccessResponse;
      testSecretIds.push(createBody.data.id);

      // Try to update with no fields
      const res = await request(`/api/v1/secrets/${createBody.data.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
    });

    it('should require authentication', async () => {
      const res = await unauthenticatedRequest('/api/v1/secrets/some-id', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'New Name' }),
      });

      expect(res.status).toBe(401);
    });
  });

  // ===========================================================================
  // DELETE /api/v1/secrets/:id
  // ===========================================================================

  describe('DELETE /api/v1/secrets/:id', () => {
    it('should delete a secret', async () => {
      // Create a secret
      const createRes = await request('/api/v1/secrets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'openai',
          name: 'To Delete',
          value: 'test-value',
        }),
      });
      const createBody = (await createRes.json()) as SecretSuccessResponse;

      // Delete the secret
      const res = await request(`/api/v1/secrets/${createBody.data.id}`, {
        method: 'DELETE',
      });

      expect(res.status).toBe(204);

      // Verify it's gone
      const listRes = await request('/api/v1/secrets');
      const listBody = (await listRes.json()) as SecretsListResponse;
      expect(listBody.data.find((s) => s.id === createBody.data.id)).toBeUndefined();
    });

    it('should return 404 for non-existent secret', async () => {
      const res = await request('/api/v1/secrets/00000000-0000-0000-0000-000000000000', {
        method: 'DELETE',
      });

      expect(res.status).toBe(404);
    });

    it('should return 404 for other users secret', async () => {
      // Create a secret
      const createRes = await request('/api/v1/secrets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'anthropic',
          name: 'Protected Key',
          value: 'test-value',
        }),
      });
      const createBody = (await createRes.json()) as SecretSuccessResponse;
      testSecretIds.push(createBody.data.id);

      // Create another user
      const otherUserResult = await authService.register(
        `delete-other-${Date.now()}@example.com`,
        'password123'
      );

      // Try to delete as other user
      const res = await app.request(`/api/v1/secrets/${createBody.data.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${otherUserResult.tokens.accessToken}` },
      });

      expect(res.status).toBe(404);

      // Verify secret still exists
      const listRes = await request('/api/v1/secrets');
      const listBody = (await listRes.json()) as SecretsListResponse;
      expect(listBody.data.find((s) => s.id === createBody.data.id)).toBeDefined();

      // Cleanup other user
      await db.delete(users).where(sql`id = ${otherUserResult.user.id}`);
    });

    it('should require authentication', async () => {
      const res = await unauthenticatedRequest('/api/v1/secrets/some-id', {
        method: 'DELETE',
      });

      expect(res.status).toBe(401);
    });
  });
});
