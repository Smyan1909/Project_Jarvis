// =============================================================================
// OpenTelemetry Tracing - SDK Initialization
// =============================================================================
// Configures and starts the OpenTelemetry SDK for distributed tracing.
// This file MUST be imported before any other application code to ensure
// all modules are properly instrumented.
//
// Usage: Import at the very top of src/index.ts
//   import './infrastructure/observability/tracing.js';

import { NodeSDK } from '@opentelemetry/sdk-node';
import { ConsoleSpanExporter, SimpleSpanProcessor, BatchSpanProcessor } from '@opentelemetry/sdk-trace-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { Resource } from '@opentelemetry/resources';
import {
  SEMRESATTRS_SERVICE_NAME,
  SEMRESATTRS_SERVICE_VERSION,
  SEMRESATTRS_DEPLOYMENT_ENVIRONMENT,
} from '@opentelemetry/semantic-conventions';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { diag, DiagConsoleLogger, DiagLogLevel } from '@opentelemetry/api';

// =============================================================================
// Configuration
// =============================================================================

// Read configuration from environment
const OTEL_ENABLED = process.env.OTEL_ENABLED !== 'false';
const OTEL_EXPORTER_OTLP_ENDPOINT = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
const OTEL_SERVICE_NAME = process.env.OTEL_SERVICE_NAME || 'project-jarvis-backend';
const OTEL_SERVICE_VERSION = process.env.OTEL_SERVICE_VERSION || '1.0.0';
const NODE_ENV = process.env.NODE_ENV || 'development';
const OTEL_DEBUG = process.env.OTEL_DEBUG === 'true';

// =============================================================================
// SDK Instance
// =============================================================================

let sdk: NodeSDK | null = null;

// =============================================================================
// Initialize Tracing
// =============================================================================

/**
 * Initialize OpenTelemetry tracing
 * 
 * Configuration options:
 * - OTEL_ENABLED: Set to 'false' to disable tracing (default: true)
 * - OTEL_EXPORTER_OTLP_ENDPOINT: OTLP endpoint URL (if not set, uses ConsoleSpanExporter)
 * - OTEL_SERVICE_NAME: Service name for traces (default: 'project-jarvis-backend')
 * - OTEL_SERVICE_VERSION: Service version (default: '1.0.0')
 * - OTEL_DEBUG: Set to 'true' to enable diagnostic logging
 */
function initTracing(): void {
  if (!OTEL_ENABLED) {
    console.log('[Tracing] OpenTelemetry tracing is disabled');
    return;
  }

  // Enable diagnostic logging if requested
  if (OTEL_DEBUG) {
    diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.DEBUG);
  }

  // Create resource with service information
  const resource = new Resource({
    [SEMRESATTRS_SERVICE_NAME]: OTEL_SERVICE_NAME,
    [SEMRESATTRS_SERVICE_VERSION]: OTEL_SERVICE_VERSION,
    [SEMRESATTRS_DEPLOYMENT_ENVIRONMENT]: NODE_ENV,
  });

  // Choose exporter based on configuration
  // If OTLP endpoint is configured, use OTLP exporter
  // Otherwise, use console exporter for local development
  const exporter = OTEL_EXPORTER_OTLP_ENDPOINT
    ? new OTLPTraceExporter({
        url: `${OTEL_EXPORTER_OTLP_ENDPOINT}/v1/traces`,
      })
    : new ConsoleSpanExporter();

  // Use BatchSpanProcessor for production (better performance)
  // Use SimpleSpanProcessor for development (immediate export)
  const spanProcessor = NODE_ENV === 'production'
    ? new BatchSpanProcessor(exporter, {
        maxQueueSize: 2048,
        maxExportBatchSize: 512,
        scheduledDelayMillis: 5000,
      })
    : new SimpleSpanProcessor(exporter);

  // Create and configure SDK
  sdk = new NodeSDK({
    resource,
    spanProcessor,
    instrumentations: [
      // HTTP instrumentation for outgoing requests
      new HttpInstrumentation({
        // Don't create spans for health checks
        ignoreIncomingRequestHook: (request) => {
          return request.url === '/health' || request.url === '/health/ready';
        },
      }),
      // PostgreSQL instrumentation
      new PgInstrumentation({
        enhancedDatabaseReporting: true,
      }),
    ],
  });

  // Start the SDK
  sdk.start();

  const exporterType = OTEL_EXPORTER_OTLP_ENDPOINT ? 'OTLP' : 'Console';
  console.log(`[Tracing] OpenTelemetry initialized (${exporterType} exporter, ${NODE_ENV} mode)`);

  // Register shutdown handler
  process.on('SIGTERM', async () => {
    await shutdownTracing();
  });

  process.on('SIGINT', async () => {
    await shutdownTracing();
  });
}

// =============================================================================
// Shutdown
// =============================================================================

/**
 * Gracefully shutdown the OpenTelemetry SDK
 * Ensures all pending spans are exported before exit
 */
async function shutdownTracing(): Promise<void> {
  if (sdk) {
    try {
      await sdk.shutdown();
      console.log('[Tracing] OpenTelemetry SDK shut down successfully');
    } catch (error) {
      console.error('[Tracing] Error shutting down OpenTelemetry SDK:', error);
    }
  }
}

// =============================================================================
// Auto-initialize
// =============================================================================

// Initialize tracing immediately when this module is imported
initTracing();

// =============================================================================
// Exports
// =============================================================================

export { shutdownTracing };
