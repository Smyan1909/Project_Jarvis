// =============================================================================
// Services - Singleton Instances
// =============================================================================
// Centralized service instantiation for dependency injection.
// Services are created once and shared across the application.

import { UserRepository } from '../adapters/storage/user-repository.js';
import { RefreshTokenRepository } from '../adapters/storage/refresh-token-repository.js';
import { AuthService } from '../application/services/auth-service.js';

// =============================================================================
// Repositories
// =============================================================================

/**
 * User repository singleton
 */
export const userRepository = new UserRepository();

/**
 * Refresh token repository singleton
 */
export const refreshTokenRepository = new RefreshTokenRepository();

// =============================================================================
// Application Services
// =============================================================================

/**
 * Authentication service singleton
 * Handles user registration, login, token refresh, and logout
 */
export const authService = new AuthService(userRepository, refreshTokenRepository);
