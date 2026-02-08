// =============================================================================
// Auth Service - Unit Tests
// =============================================================================
// Unit tests with mocked repositories to test business logic in isolation.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { hash } from 'bcrypt';

// =============================================================================
// Types for mocks
// =============================================================================

interface MockUser {
  id: string;
  email: string;
  passwordHash: string;
  displayName: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface MockRefreshToken {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  createdAt: Date;
}

// =============================================================================
// Mock Setup - vi.mock calls are hoisted, so factory must be self-contained
// =============================================================================

// Mock the config module
vi.mock('../../infrastructure/config/index.js', () => ({
  config: {
    JWT_SECRET: 'test-secret-key-that-is-at-least-32-chars-long',
    JWT_ACCESS_EXPIRY: '15m',
    JWT_REFRESH_EXPIRY: '7d',
  },
}));

// Mock the logger
vi.mock('../../infrastructure/logging/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(() => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    })),
  },
}));

// Mock the domain errors module - factory must be self-contained
vi.mock('../../domain/errors/index.js', () => {
  // Define classes inside the factory
  class AppError extends Error {
    constructor(
      public readonly code: string,
      message: string,
      public readonly statusCode: number = 500
    ) {
      super(message);
      this.name = 'AppError';
    }
  }

  class ValidationError extends AppError {
    constructor(message: string) {
      super('VALIDATION_ERROR', message, 400);
      this.name = 'ValidationError';
    }
  }

  class UnauthorizedError extends AppError {
    constructor(message = 'Unauthorized') {
      super('UNAUTHORIZED', message, 401);
      this.name = 'UnauthorizedError';
    }
  }

  class NotFoundError extends AppError {
    constructor(resource: string) {
      super(`${resource.toUpperCase()}_NOT_FOUND`, `${resource} not found`, 404);
      this.name = 'NotFoundError';
    }
  }

  class ConflictError extends AppError {
    constructor(message: string) {
      super('CONFLICT', message, 409);
      this.name = 'ConflictError';
    }
  }

  class ForbiddenError extends AppError {
    constructor(message = 'Forbidden') {
      super('FORBIDDEN', message, 403);
      this.name = 'ForbiddenError';
    }
  }

  class RateLimitError extends AppError {
    constructor() {
      super('RATE_LIMIT_EXCEEDED', 'Too many requests', 429);
      this.name = 'RateLimitError';
    }
  }

  return {
    AppError,
    ValidationError,
    UnauthorizedError,
    NotFoundError,
    ConflictError,
    ForbiddenError,
    RateLimitError,
  };
});

// Now import AuthService after mocks are set up
import { AuthService } from './auth-service.js';
import type { UserRepository } from '../../adapters/storage/user-repository.js';
import type { RefreshTokenRepository } from '../../adapters/storage/refresh-token-repository.js';

// =============================================================================
// Helpers
// =============================================================================

// Helper to create a mock user
function createMockUser(overrides: Partial<MockUser> = {}): MockUser {
  return {
    id: 'user-123',
    email: 'test@example.com',
    passwordHash: '$2b$12$dummy.hash.value.here',
    displayName: 'Test User',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// Helper to create a mock refresh token
function createMockRefreshToken(overrides: Partial<MockRefreshToken> = {}): MockRefreshToken {
  return {
    id: 'token-123',
    userId: 'user-123',
    tokenHash: 'hashed-refresh-token',
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
    createdAt: new Date(),
    ...overrides,
  };
}

// Helper to create a real bcrypt hash for a password
async function createRealHash(password: string): Promise<string> {
  return hash(password, 4); // Use low rounds for faster tests
}

// =============================================================================
// Tests
// =============================================================================

describe('AuthService', () => {
  let authService: AuthService;
  let mockUserRepo: UserRepository;
  let mockRefreshTokenRepo: RefreshTokenRepository;

  beforeEach(() => {
    // Create fresh mocks for each test
    mockUserRepo = {
      findById: vi.fn(),
      findByEmail: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      emailExists: vi.fn(),
    } as unknown as UserRepository;

    mockRefreshTokenRepo = {
      create: vi.fn(),
      findByHash: vi.fn(),
      findById: vi.fn(),
      delete: vi.fn(),
      deleteByHash: vi.fn(),
      deleteAllForUser: vi.fn(),
      deleteExpired: vi.fn(),
      countByUser: vi.fn(),
    } as unknown as RefreshTokenRepository;

    authService = new AuthService(mockUserRepo, mockRefreshTokenRepo);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ===========================================================================
  // register() tests
  // ===========================================================================

  describe('register()', () => {
    it('should register a new user and return tokens', async () => {
      const mockUser = createMockUser({
        id: 'new-user-id',
        email: 'new@example.com',
      });

      vi.mocked(mockUserRepo.findByEmail).mockResolvedValue(null);
      vi.mocked(mockUserRepo.create).mockResolvedValue(mockUser);
      vi.mocked(mockRefreshTokenRepo.create).mockResolvedValue(createMockRefreshToken());

      const result = await authService.register('new@example.com', 'password123', 'New User');

      expect(result.user).toBeDefined();
      expect(result.user.email).toBe('new@example.com');
      expect(result.user.id).toBe('new-user-id');
      expect(result.tokens.accessToken).toBeDefined();
      expect(result.tokens.refreshToken).toBeDefined();
      expect(result.tokens.expiresIn).toBeDefined();

      // Should not expose password hash
      expect((result.user as unknown as Record<string, unknown>).passwordHash).toBeUndefined();
    });

    it('should throw error if email already exists', async () => {
      vi.mocked(mockUserRepo.findByEmail).mockResolvedValue(createMockUser());

      await expect(
        authService.register('existing@example.com', 'password123')
      ).rejects.toThrow(/already registered/i);
    });

    it('should throw error for short password', async () => {
      await expect(
        authService.register('new@example.com', 'short1')
      ).rejects.toThrow(/at least 8 characters/i);
    });

    it('should throw error for password without number', async () => {
      await expect(
        authService.register('new@example.com', 'passwordonly')
      ).rejects.toThrow(/letter and one number/i);
    });

    it('should throw error for password without letter', async () => {
      await expect(
        authService.register('new@example.com', '12345678')
      ).rejects.toThrow(/letter and one number/i);
    });

    it('should hash password before storing', async () => {
      const mockUser = createMockUser();

      vi.mocked(mockUserRepo.findByEmail).mockResolvedValue(null);
      vi.mocked(mockUserRepo.create).mockResolvedValue(mockUser);
      vi.mocked(mockRefreshTokenRepo.create).mockResolvedValue(createMockRefreshToken());

      await authService.register('new@example.com', 'password123');

      expect(mockUserRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'new@example.com',
          passwordHash: expect.stringMatching(/^\$2[aby]\$/), // bcrypt hash
        })
      );
    });
  });

  // ===========================================================================
  // login() tests
  // ===========================================================================

  describe('login()', () => {
    it('should login with valid credentials and return tokens', async () => {
      // Create a user with a real bcrypt hash for the password
      const realHash = await createRealHash('password123');
      const mockUser = createMockUser({
        passwordHash: realHash,
      });

      vi.mocked(mockUserRepo.findByEmail).mockResolvedValue(mockUser);
      vi.mocked(mockRefreshTokenRepo.create).mockResolvedValue(createMockRefreshToken());

      const result = await authService.login('test@example.com', 'password123');

      expect(result.user).toBeDefined();
      expect(result.user.email).toBe('test@example.com');
      expect(result.tokens.accessToken).toBeDefined();
      expect(result.tokens.refreshToken).toBeDefined();
    });

    it('should throw error for non-existent email', async () => {
      vi.mocked(mockUserRepo.findByEmail).mockResolvedValue(null);

      await expect(
        authService.login('nonexistent@example.com', 'password123')
      ).rejects.toThrow(/invalid email or password/i);
    });

    it('should throw error for wrong password', async () => {
      const realHash = await createRealHash('password123');
      const mockUser = createMockUser({
        passwordHash: realHash,
      });

      vi.mocked(mockUserRepo.findByEmail).mockResolvedValue(mockUser);

      await expect(
        authService.login('test@example.com', 'wrongpassword')
      ).rejects.toThrow(/invalid email or password/i);
    });
  });

  // ===========================================================================
  // refresh() tests
  // ===========================================================================

  describe('refresh()', () => {
    it('should refresh tokens and rotate the refresh token', async () => {
      const mockToken = createMockRefreshToken();
      const mockUser = createMockUser();

      vi.mocked(mockRefreshTokenRepo.findByHash).mockResolvedValue(mockToken);
      vi.mocked(mockRefreshTokenRepo.delete).mockResolvedValue(true);
      vi.mocked(mockUserRepo.findById).mockResolvedValue(mockUser);
      vi.mocked(mockRefreshTokenRepo.create).mockResolvedValue(createMockRefreshToken());

      const result = await authService.refresh('valid-refresh-token');

      expect(result.accessToken).toBeDefined();
      expect(result.refreshToken).toBeDefined();

      // Should delete old token
      expect(mockRefreshTokenRepo.delete).toHaveBeenCalledWith(mockToken.id);

      // Should create new token
      expect(mockRefreshTokenRepo.create).toHaveBeenCalled();
    });

    it('should throw error for invalid refresh token', async () => {
      vi.mocked(mockRefreshTokenRepo.findByHash).mockResolvedValue(null);

      await expect(authService.refresh('invalid-token')).rejects.toThrow(
        /invalid refresh token/i
      );
    });

    it('should throw error for expired refresh token', async () => {
      const expiredToken = createMockRefreshToken({
        expiresAt: new Date(Date.now() - 1000), // Expired 1 second ago
      });

      vi.mocked(mockRefreshTokenRepo.findByHash).mockResolvedValue(expiredToken);
      vi.mocked(mockRefreshTokenRepo.delete).mockResolvedValue(true);

      await expect(authService.refresh('expired-token')).rejects.toThrow(
        /expired/i
      );
    });

    it('should throw error if user no longer exists', async () => {
      const mockToken = createMockRefreshToken();

      vi.mocked(mockRefreshTokenRepo.findByHash).mockResolvedValue(mockToken);
      vi.mocked(mockRefreshTokenRepo.delete).mockResolvedValue(true);
      vi.mocked(mockUserRepo.findById).mockResolvedValue(null);

      await expect(authService.refresh('valid-token')).rejects.toThrow(/not found/i);
    });
  });

  // ===========================================================================
  // logout() tests
  // ===========================================================================

  describe('logout()', () => {
    it('should delete the refresh token', async () => {
      vi.mocked(mockRefreshTokenRepo.deleteByHash).mockResolvedValue(true);

      await authService.logout('refresh-token');

      expect(mockRefreshTokenRepo.deleteByHash).toHaveBeenCalled();
    });

    it('should not throw if token does not exist', async () => {
      vi.mocked(mockRefreshTokenRepo.deleteByHash).mockResolvedValue(false);

      await expect(authService.logout('nonexistent-token')).resolves.not.toThrow();
    });
  });

  // ===========================================================================
  // logoutAll() tests
  // ===========================================================================

  describe('logoutAll()', () => {
    it('should delete all tokens for user', async () => {
      vi.mocked(mockRefreshTokenRepo.deleteAllForUser).mockResolvedValue(3);

      const count = await authService.logoutAll('user-123');

      expect(count).toBe(3);
      expect(mockRefreshTokenRepo.deleteAllForUser).toHaveBeenCalledWith('user-123');
    });
  });

  // ===========================================================================
  // verifyAccessToken() tests
  // ===========================================================================

  describe('verifyAccessToken()', () => {
    it('should verify a valid token and return payload', async () => {
      // First, generate a real token
      const mockUser = createMockUser();

      vi.mocked(mockUserRepo.findByEmail).mockResolvedValue(null);
      vi.mocked(mockUserRepo.create).mockResolvedValue(mockUser);
      vi.mocked(mockRefreshTokenRepo.create).mockResolvedValue(createMockRefreshToken());

      const result = await authService.register('verify@example.com', 'password123');

      // Now verify it
      const payload = authService.verifyAccessToken(result.tokens.accessToken);

      expect(payload.userId).toBe(mockUser.id);
      expect(payload.email).toBe(mockUser.email);
    });

    it('should throw error for invalid token', () => {
      expect(() => authService.verifyAccessToken('invalid-token')).toThrow(
        /invalid or expired/i
      );
    });

    it('should throw error for malformed token', () => {
      expect(() => authService.verifyAccessToken('not.a.jwt')).toThrow(
        /invalid or expired/i
      );
    });
  });

  // ===========================================================================
  // getUserById() tests
  // ===========================================================================

  describe('getUserById()', () => {
    it('should return safe user without password hash', async () => {
      const mockUser = createMockUser();
      vi.mocked(mockUserRepo.findById).mockResolvedValue(mockUser);

      const user = await authService.getUserById('user-123');

      expect(user).toBeDefined();
      expect(user!.id).toBe(mockUser.id);
      expect(user!.email).toBe(mockUser.email);
      expect((user as unknown as Record<string, unknown>).passwordHash).toBeUndefined();
    });

    it('should return null for non-existent user', async () => {
      vi.mocked(mockUserRepo.findById).mockResolvedValue(null);

      const user = await authService.getUserById('nonexistent');

      expect(user).toBeNull();
    });
  });

  // ===========================================================================
  // resetPassword() tests
  // ===========================================================================

  describe('resetPassword()', () => {
    it('should reset password and invalidate all refresh tokens', async () => {
      const mockUser = createMockUser();

      vi.mocked(mockUserRepo.findById).mockResolvedValue(mockUser);
      vi.mocked(mockUserRepo.update).mockResolvedValue(mockUser);
      vi.mocked(mockRefreshTokenRepo.deleteAllForUser).mockResolvedValue(2);

      await authService.resetPassword('user-123', 'newpassword123');

      // Should update password hash
      expect(mockUserRepo.update).toHaveBeenCalledWith(
        'user-123',
        expect.objectContaining({
          passwordHash: expect.stringMatching(/^\$2[aby]\$/), // bcrypt hash
        })
      );

      // CRITICAL: Should invalidate all refresh tokens
      expect(mockRefreshTokenRepo.deleteAllForUser).toHaveBeenCalledWith('user-123');
    });

    it('should throw error for non-existent user', async () => {
      vi.mocked(mockUserRepo.findById).mockResolvedValue(null);

      await expect(
        authService.resetPassword('nonexistent', 'newpassword123')
      ).rejects.toThrow(/not found/i);
    });

    it('should throw error for invalid new password', async () => {
      const mockUser = createMockUser();
      vi.mocked(mockUserRepo.findById).mockResolvedValue(mockUser);

      await expect(
        authService.resetPassword('user-123', 'short1')
      ).rejects.toThrow(/at least 8 characters/i);
    });

    it('should throw error for password without letter and number', async () => {
      const mockUser = createMockUser();
      vi.mocked(mockUserRepo.findById).mockResolvedValue(mockUser);

      await expect(
        authService.resetPassword('user-123', 'onlyletters')
      ).rejects.toThrow(/letter and one number/i);
    });

    it('should allow login with new password after reset', async () => {
      const mockUser = createMockUser();
      const newPassword = 'newpassword123';
      const newHash = await createRealHash(newPassword);
      const updatedUser = { ...mockUser, passwordHash: newHash };

      // Reset password
      vi.mocked(mockUserRepo.findById).mockResolvedValue(mockUser);
      vi.mocked(mockUserRepo.update).mockResolvedValue(updatedUser);
      vi.mocked(mockRefreshTokenRepo.deleteAllForUser).mockResolvedValue(1);

      await authService.resetPassword('user-123', newPassword);

      // Try to login with new password
      vi.mocked(mockUserRepo.findByEmail).mockResolvedValue(updatedUser);
      vi.mocked(mockRefreshTokenRepo.create).mockResolvedValue(createMockRefreshToken());

      const result = await authService.login(mockUser.email, newPassword);

      expect(result.user.id).toBe(mockUser.id);
      expect(result.tokens.accessToken).toBeDefined();
    });
  });
});
