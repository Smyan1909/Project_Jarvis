// =============================================================================
// Observability Module - Public Exports
// =============================================================================
// Exports tracing utilities and middleware for use throughout the application.

// Tracing middleware for Hono
export {
  tracingMiddleware,
  getCurrentTraceId,
  getCurrentSpanId,
  addSpanEvent,
  setSpanAttributes,
} from './hono-tracing.js';

// Tracing shutdown (for graceful shutdown handling)
export { shutdownTracing } from './tracing.js';

// Re-export commonly used OpenTelemetry types and functions
export {
  trace,
  context,
  SpanKind,
  SpanStatusCode,
  type Span,
  type Tracer,
} from '@opentelemetry/api';

// =============================================================================
// Tracer Factory
// =============================================================================

import { trace } from '@opentelemetry/api';

/**
 * Create a tracer for a specific component
 * 
 * @param name - Component name (e.g., 'llm-provider', 'orchestrator')
 * @param version - Component version (default: '1.0.0')
 * @returns Tracer instance
 * 
 * @example
 * ```typescript
 * import { createTracer } from '../infrastructure/observability/index.js';
 * 
 * const tracer = createTracer('my-component');
 * 
 * tracer.startActiveSpan('my-operation', async (span) => {
 *   // ... do work
 *   span.end();
 * });
 * ```
 */
export function createTracer(name: string, version: string = '1.0.0') {
  return trace.getTracer(name, version);
}
