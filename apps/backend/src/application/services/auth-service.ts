// =============================================================================
// Auth Service - Application Service
// =============================================================================
// Handles user authentication: registration, login, token refresh, and logout.
// Implements JWT-based authentication with refresh token rotation.

import { hash, compare } from 'bcrypt';
import jwt, { type JwtPayload, type SignOptions } from 'jsonwebtoken';
const { sign, verify } = jwt;
import { randomBytes, createHash } from 'crypto';
import { config } from '../../infrastructure/config/index.js';
import { UserRepository, type User } from '../../adapters/storage/user-repository.js';
import { RefreshTokenRepository } from '../../adapters/storage/refresh-token-repository.js';
import {
  ValidationError,
  UnauthorizedError,
  NotFoundError,
  ConflictError,
} from '../../domain/errors/index.js';
import { logger } from '../../infrastructure/logging/logger.js';

// =============================================================================
// Types
// =============================================================================

/**
 * JWT access token payload
 */
export interface TokenPayload {
  userId: string;
  email: string;
}

/**
 * Authentication tokens returned after login/register
 */
export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number; // seconds until access token expires
}

/**
 * User data safe to return to clients (no password hash)
 */
export interface SafeUser {
  id: string;
  email: string;
  displayName: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Registration result with user data and tokens
 */
export interface RegisterResult {
  user: SafeUser;
  tokens: AuthTokens;
}

/**
 * Login result with user data and tokens
 */
export interface LoginResult {
  user: SafeUser;
  tokens: AuthTokens;
}

// =============================================================================
// Constants
// =============================================================================

const BCRYPT_ROUNDS = 12;
const REFRESH_TOKEN_BYTES = 32;

// Password validation: min 8 chars, at least one letter and one number
const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_REGEX = /^(?=.*[a-zA-Z])(?=.*\d).+$/;

// =============================================================================
// Service
// =============================================================================

/**
 * Authentication service
 * Handles user registration, login, token refresh, and logout
 */
export class AuthService {
  constructor(
    private userRepo: UserRepository,
    private refreshTokenRepo: RefreshTokenRepository
  ) {}

  // ===========================================================================
  // Public Methods
  // ===========================================================================

  /**
   * Register a new user
   * @throws ConflictError if email already exists
   * @throws ValidationError if password doesn't meet requirements
   */
  async register(
    email: string,
    password: string,
    displayName?: string
  ): Promise<RegisterResult> {
    // Validate password
    this.validatePassword(password);

    // Check if email already exists
    const existing = await this.userRepo.findByEmail(email);
    if (existing) {
      throw new ConflictError('Email already registered');
    }

    // Hash password and create user
    const passwordHash = await hash(password, BCRYPT_ROUNDS);
    const user = await this.userRepo.create({
      email,
      passwordHash,
      displayName,
    });

    // Generate tokens
    const tokens = await this.generateTokens(user.id, user.email);

    logger.info('User registered', { userId: user.id, email: user.email });

    return {
      user: this.toSafeUser(user),
      tokens,
    };
  }

  /**
   * Login with email and password
   * @throws UnauthorizedError if credentials are invalid
   */
  async login(email: string, password: string): Promise<LoginResult> {
    const user = await this.userRepo.findByEmail(email);

    if (!user) {
      // Use same error message for both cases to prevent email enumeration
      throw new UnauthorizedError('Invalid email or password');
    }

    const isValidPassword = await compare(password, user.passwordHash);

    if (!isValidPassword) {
      logger.warn('Failed login attempt', { email: user.email });
      throw new UnauthorizedError('Invalid email or password');
    }

    const tokens = await this.generateTokens(user.id, user.email);

    logger.info('User logged in', { userId: user.id, email: user.email });

    return {
      user: this.toSafeUser(user),
      tokens,
    };
  }

  /**
   * Refresh access token using a valid refresh token
   * Implements token rotation: old token is deleted, new one is issued
   * @throws UnauthorizedError if refresh token is invalid or expired
   */
  async refresh(refreshToken: string): Promise<AuthTokens> {
    const tokenHash = this.hashToken(refreshToken);
    const stored = await this.refreshTokenRepo.findByHash(tokenHash);

    if (!stored) {
      throw new UnauthorizedError('Invalid refresh token');
    }

    if (stored.expiresAt < new Date()) {
      // Clean up expired token
      await this.refreshTokenRepo.delete(stored.id);
      throw new UnauthorizedError('Refresh token expired');
    }

    // Delete old token (rotation)
    await this.refreshTokenRepo.delete(stored.id);

    // Get user to include email in new token
    const user = await this.userRepo.findById(stored.userId);

    if (!user) {
      throw new NotFoundError('User');
    }

    // Generate new tokens
    const tokens = await this.generateTokens(user.id, user.email);

    logger.info('Token refreshed', { userId: user.id });

    return tokens;
  }

  /**
   * Logout by invalidating a refresh token
   */
  async logout(refreshToken: string): Promise<void> {
    const tokenHash = this.hashToken(refreshToken);
    const deleted = await this.refreshTokenRepo.deleteByHash(tokenHash);

    if (deleted) {
      logger.info('User logged out');
    }
  }

  /**
   * Logout from all devices by invalidating all refresh tokens for a user
   */
  async logoutAll(userId: string): Promise<number> {
    const count = await this.refreshTokenRepo.deleteAllForUser(userId);

    logger.info('User logged out from all devices', { userId, sessionCount: count });

    return count;
  }

  /**
   * Verify an access token and return its payload
   * @throws UnauthorizedError if token is invalid or expired
   */
  verifyAccessToken(token: string): TokenPayload {
    try {
      const decoded = verify(token, config.JWT_SECRET) as JwtPayload & TokenPayload;

      return {
        userId: decoded.userId,
        email: decoded.email,
      };
    } catch (error) {
      throw new UnauthorizedError('Invalid or expired access token');
    }
  }

  /**
   * Get user by ID (for use by other services)
   */
  async getUserById(userId: string): Promise<SafeUser | null> {
    const user = await this.userRepo.findById(userId);
    return user ? this.toSafeUser(user) : null;
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  /**
   * Validate password meets requirements
   * @throws ValidationError if password is invalid
   */
  private validatePassword(password: string): void {
    if (password.length < PASSWORD_MIN_LENGTH) {
      throw new ValidationError(
        `Password must be at least ${PASSWORD_MIN_LENGTH} characters long`
      );
    }

    if (!PASSWORD_REGEX.test(password)) {
      throw new ValidationError(
        'Password must contain at least one letter and one number'
      );
    }
  }

  /**
   * Generate access and refresh tokens for a user
   */
  private async generateTokens(userId: string, email: string): Promise<AuthTokens> {
    const payload: TokenPayload = { userId, email };

    // Parse expiry for JWT sign - convert to seconds for numeric expiry
    const expiresInMs = this.parseExpiry(config.JWT_ACCESS_EXPIRY);
    const expiresInSeconds = Math.floor(expiresInMs / 1000);

    const signOptions: SignOptions = {
      expiresIn: expiresInSeconds,
    };

    const accessToken = sign(payload, config.JWT_SECRET, signOptions);

    // Generate random refresh token
    const refreshToken = randomBytes(REFRESH_TOKEN_BYTES).toString('hex');
    const tokenHash = this.hashToken(refreshToken);
    const expiresAt = new Date(
      Date.now() + this.parseExpiry(config.JWT_REFRESH_EXPIRY)
    );

    // Store refresh token hash
    await this.refreshTokenRepo.create({
      userId,
      tokenHash,
      expiresAt,
    });

    return {
      accessToken,
      refreshToken,
      expiresIn: expiresInSeconds,
    };
  }

  /**
   * Hash a token using SHA-256
   * Used for storing refresh tokens securely
   */
  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /**
   * Parse expiry string (e.g., "15m", "7d") to milliseconds
   */
  private parseExpiry(expiry: string): number {
    const match = expiry.match(/^(\d+)([smhd])$/);

    if (!match) {
      // Default to 7 days if format is invalid
      return 7 * 24 * 60 * 60 * 1000;
    }

    const value = parseInt(match[1], 10);
    const unit = match[2];

    switch (unit) {
      case 's':
        return value * 1000;
      case 'm':
        return value * 60 * 1000;
      case 'h':
        return value * 60 * 60 * 1000;
      case 'd':
        return value * 24 * 60 * 60 * 1000;
      default:
        return 7 * 24 * 60 * 60 * 1000;
    }
  }

  /**
   * Convert a User entity to a SafeUser (without password hash)
   */
  private toSafeUser(user: User): SafeUser {
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }
}
