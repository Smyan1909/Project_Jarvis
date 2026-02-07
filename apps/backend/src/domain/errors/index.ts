// =============================================================================
// Domain Errors - Re-export from shared-types
// =============================================================================
// This provides a consistent error handling interface across the backend
// while allowing for backend-specific errors to be added later.

export {
  AppError,
  NotFoundError,
  UnauthorizedError,
  ForbiddenError,
  ValidationError,
  RateLimitError,
  LLMError,
  ToolError,
  ConflictError,
  BadGatewayError,
  ServiceUnavailableError,
} from '@project-jarvis/shared-types';
