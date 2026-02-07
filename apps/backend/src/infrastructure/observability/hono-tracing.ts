// =============================================================================
// Hono Tracing Middleware
// =============================================================================
// Creates OpenTelemetry spans for incoming HTTP requests in Hono.
// Propagates W3C trace context from incoming headers and injects trace ID
// into response headers for client-side correlation.

import { trace, SpanKind, SpanStatusCode, context, propagation } from '@opentelemetry/api';
import type { MiddlewareHandler } from 'hono';

// =============================================================================
// Constants
// =============================================================================

const TRACER_NAME = 'hono-http';
const TRACER_VERSION = '1.0.0';

// =============================================================================
// Tracer
// =============================================================================

/**
 * Get the tracer instance for HTTP spans
 */
function getTracer() {
  return trace.getTracer(TRACER_NAME, TRACER_VERSION);
}

// =============================================================================
// Header Extraction
// =============================================================================

/**
 * Text map getter for extracting trace context from Hono request headers
 */
const headerGetter = {
  get(carrier: Headers, key: string): string | undefined {
    return carrier.get(key) ?? undefined;
  },
  keys(carrier: Headers): string[] {
    return [...carrier.keys()];
  },
};

// =============================================================================
// Middleware
// =============================================================================

/**
 * Tracing middleware for Hono
 * 
 * Creates a span for each incoming HTTP request with:
 * - Standard HTTP semantic conventions
 * - Request/response attributes
 * - Error recording
 * - Trace ID in response headers
 * 
 * @example
 * ```typescript
 * import { tracingMiddleware } from './infrastructure/observability/hono-tracing.js';
 * 
 * app.use('*', tracingMiddleware);
 * ```
 */
export const tracingMiddleware: MiddlewareHandler = async (c, next) => {
  const tracer = getTracer();
  
  // Extract parent context from incoming headers (W3C Trace Context)
  const parentContext = propagation.extract(
    context.active(),
    c.req.raw.headers,
    headerGetter
  );

  // Build span name from method and route pattern
  // Use routePath if available (for pattern matching), otherwise use path
  const routePath = (c.req as unknown as { routePath?: string }).routePath || c.req.path;
  const spanName = `${c.req.method} ${routePath}`;

  // Parse URL for attributes
  const url = new URL(c.req.url);

  // Run request handler within the span context
  return context.with(parentContext, () => {
    return tracer.startActiveSpan(
      spanName,
      {
        kind: SpanKind.SERVER,
        attributes: {
          // HTTP semantic conventions
          'http.method': c.req.method,
          'http.url': c.req.url,
          'http.target': c.req.path,
          'http.route': routePath,
          'http.scheme': url.protocol.replace(':', ''),
          'http.host': url.host,
          'http.user_agent': c.req.header('user-agent') || '',
          'http.request_content_length': c.req.header('content-length') || '',
          
          // Custom attributes
          'http.request_id': c.req.header('x-request-id') || '',
        },
      },
      async (span) => {
        try {
          // Add trace ID to response headers for client-side correlation
          const traceId = span.spanContext().traceId;
          c.header('x-trace-id', traceId);

          // Execute the request handler
          await next();

          // Record response attributes
          span.setAttributes({
            'http.status_code': c.res.status,
            'http.response_content_length': c.res.headers.get('content-length') || '',
          });

          // Set span status based on HTTP status code
          if (c.res.status >= 500) {
            span.setStatus({
              code: SpanStatusCode.ERROR,
              message: `HTTP ${c.res.status}`,
            });
          } else if (c.res.status >= 400) {
            // 4xx errors are typically client errors, not span errors
            // but we still record them for visibility
            span.setAttributes({
              'http.error_type': 'client_error',
            });
          }
        } catch (error) {
          // Record exception details
          span.recordException(error as Error);
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: (error as Error).message,
          });
          span.setAttributes({
            'http.status_code': 500,
            'error.type': (error as Error).name,
            'error.message': (error as Error).message,
          });

          // Re-throw to let Hono's error handler deal with it
          throw error;
        } finally {
          // Always end the span
          span.end();
        }
      }
    );
  });
};

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Get the current trace ID from the active span
 * Useful for including in log messages or error responses
 */
export function getCurrentTraceId(): string | undefined {
  const span = trace.getActiveSpan();
  return span?.spanContext().traceId;
}

/**
 * Get the current span ID from the active span
 */
export function getCurrentSpanId(): string | undefined {
  const span = trace.getActiveSpan();
  return span?.spanContext().spanId;
}

/**
 * Add an event to the current span
 * Events are timestamped annotations within a span
 */
export function addSpanEvent(name: string, attributes?: Record<string, string | number | boolean>): void {
  const span = trace.getActiveSpan();
  if (span) {
    span.addEvent(name, attributes);
  }
}

/**
 * Set attributes on the current span
 */
export function setSpanAttributes(attributes: Record<string, string | number | boolean>): void {
  const span = trace.getActiveSpan();
  if (span) {
    span.setAttributes(attributes);
  }
}
