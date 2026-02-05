// =============================================================================
// Base Application Error
// =============================================================================

export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 500,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'AppError';
    // V8 specific - available in Node.js
    // Using 'in' operator for type-safe property check
    if ('captureStackTrace' in Error && typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  toJSON() {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details && { details: this.details }),
      },
    };
  }
}

// =============================================================================
// Not Found Error (404)
// =============================================================================

export class NotFoundError extends AppError {
  constructor(resource: string, id?: string) {
    super(
      `${resource.toUpperCase()}_NOT_FOUND`,
      id ? `${resource} with id ${id} not found` : `${resource} not found`,
      404
    );
    this.name = 'NotFoundError';
  }
}

// =============================================================================
// Unauthorized Error (401)
// =============================================================================

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super('UNAUTHORIZED', message, 401);
    this.name = 'UnauthorizedError';
  }
}

// =============================================================================
// Forbidden Error (403)
// =============================================================================

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super('FORBIDDEN', message, 403);
    this.name = 'ForbiddenError';
  }
}

// =============================================================================
// Validation Error (400)
// =============================================================================

export class ValidationError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('VALIDATION_ERROR', message, 400, details);
    this.name = 'ValidationError';
  }
}

// =============================================================================
// Rate Limit Error (429)
// =============================================================================

export class RateLimitError extends AppError {
  constructor(retryAfter?: number) {
    super('RATE_LIMIT_EXCEEDED', 'Too many requests', 429, { retryAfter });
    this.name = 'RateLimitError';
  }
}

// =============================================================================
// LLM Error (502)
// =============================================================================

export class LLMError extends AppError {
  constructor(provider: string, message: string, details?: Record<string, unknown>) {
    super('LLM_ERROR', `${provider}: ${message}`, 502, details);
    this.name = 'LLMError';
  }
}

// =============================================================================
// Tool Error (500)
// =============================================================================

export class ToolError extends AppError {
  constructor(toolId: string, message: string) {
    super('TOOL_ERROR', `Tool ${toolId}: ${message}`, 500, { toolId });
    this.name = 'ToolError';
  }
}

// =============================================================================
// Conflict Error (409)
// =============================================================================

export class ConflictError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('CONFLICT', message, 409, details);
    this.name = 'ConflictError';
  }
}

// =============================================================================
// Bad Gateway Error (502)
// =============================================================================

export class BadGatewayError extends AppError {
  constructor(service: string, message: string) {
    super('BAD_GATEWAY', `${service}: ${message}`, 502, { service });
    this.name = 'BadGatewayError';
  }
}

// =============================================================================
// Service Unavailable Error (503)
// =============================================================================

export class ServiceUnavailableError extends AppError {
  constructor(message = 'Service temporarily unavailable', retryAfter?: number) {
    super('SERVICE_UNAVAILABLE', message, 503, { retryAfter });
    this.name = 'ServiceUnavailableError';
  }
}
