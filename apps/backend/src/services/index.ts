// =============================================================================
// Services - Singleton Instances
// =============================================================================
// Centralized service instantiation for dependency injection.
// Services are created once and shared across the application.

import { UserRepository } from '../adapters/storage/user-repository.js';
import { RefreshTokenRepository } from '../adapters/storage/refresh-token-repository.js';
import { UserSecretRepository } from '../adapters/storage/user-secret-repository.js';
import { AgentRunRepository } from '../adapters/storage/agent-run-repository.js';
import { MessageRepository } from '../adapters/storage/message-repository.js';
import { ToolCallRepository } from '../adapters/storage/tool-call-repository.js';
import { AuthService } from '../application/services/auth-service.js';
import { SecretsService } from '../application/services/secrets-service.js';

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

/**
 * User secret repository singleton
 */
export const userSecretRepository = new UserSecretRepository();

/**
 * Agent run repository singleton
 * Tracks agent execution sessions with status and cost metrics
 */
export const agentRunRepository = new AgentRunRepository();

/**
 * Message repository singleton
 * Stores conversation history within agent runs
 */
export const messageRepository = new MessageRepository();

/**
 * Tool call repository singleton
 * Tracks individual tool invocations during agent runs
 */
export const toolCallRepository = new ToolCallRepository();

// =============================================================================
// Application Services
// =============================================================================

/**
 * Authentication service singleton
 * Handles user registration, login, token refresh, and logout
 */
export const authService = new AuthService(userRepository, refreshTokenRepository);

/**
 * Secrets service singleton
 * Handles encrypted storage of user API keys and tokens
 */
export const secretsService = new SecretsService(userSecretRepository);
