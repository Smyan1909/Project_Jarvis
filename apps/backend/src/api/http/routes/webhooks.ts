// =============================================================================
// Webhook Routes
// =============================================================================
// Handles incoming webhooks from external services like Composio.
// No authentication required - uses signature verification instead.

import { Hono } from 'hono';
import { rateLimiter } from 'hono-rate-limiter';
import crypto from 'crypto';
import { logger } from '../../../infrastructure/logging/logger.js';
import type { MonitoringAgentService } from '../../../application/services/MonitoringAgentService.js';
import { ComposioTriggerPayloadSchema } from '@project-jarvis/shared-types';

// =============================================================================
// Types
// =============================================================================

/**
 * Dependencies for webhook routes
 */
export interface WebhookRouteDependencies {
  monitoringService: MonitoringAgentService;
}

// =============================================================================
// Configuration
// =============================================================================

const WEBHOOK_SECRET = process.env.COMPOSIO_WEBHOOK_SECRET;
const WEBHOOK_RATE_LIMIT = parseInt(process.env.WEBHOOK_RATE_LIMIT || '100'); // per minute

// =============================================================================
// Routes
// =============================================================================

/**
 * Create webhook routes
 */
export function createWebhookRoutes(deps: WebhookRouteDependencies): Hono {
  const webhookRoutes = new Hono();
  const log = logger.child({ route: 'webhooks' });

  // Rate limiting middleware
  webhookRoutes.use(
    '*',
    rateLimiter({
      windowMs: 60 * 1000, // 1 minute
      limit: WEBHOOK_RATE_LIMIT,
      keyGenerator: (c) => c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || 'unknown',
    })
  );

  // ===========================================================================
  // Composio Webhook
  // ===========================================================================

  /**
   * POST /webhooks/composio
   * 
   * Receives trigger events from Composio.
   * Verifies signature and processes the webhook asynchronously.
   */
  webhookRoutes.post('/composio', async (c) => {
    const requestId = crypto.randomUUID();
    const reqLog = log.child({ requestId, path: '/composio' });

    try {
      // 1. Get raw body for signature verification
      const rawBody = await c.req.text();

      // 2. Get signature headers
      const signature = c.req.header('webhook-signature');
      const webhookId = c.req.header('webhook-id');
      const timestamp = c.req.header('webhook-timestamp');

      reqLog.debug('Received webhook', { 
        webhookId,
        hasSignature: !!signature,
        bodyLength: rawBody.length,
      });

      // 3. Verify signature
      if (!verifySignature(rawBody, signature, webhookId, timestamp, WEBHOOK_SECRET)) {
        reqLog.warn('Invalid webhook signature', { webhookId });
        return c.json({ error: 'Invalid signature' }, 401);
      }

      // 4. Parse payload
      let payload: unknown;
      try {
        payload = JSON.parse(rawBody);
      } catch (parseError) {
        reqLog.warn('Invalid JSON payload');
        return c.json({ error: 'Invalid JSON' }, 400);
      }

      // 5. Validate payload structure
      const parseResult = ComposioTriggerPayloadSchema.safeParse(payload);
      if (!parseResult.success) {
        reqLog.warn('Invalid payload structure', { 
          errors: parseResult.error.errors,
        });
        return c.json({ 
          error: 'Invalid payload structure',
          details: parseResult.error.errors,
        }, 400);
      }

      const validatedPayload = parseResult.data;
      reqLog.info('Webhook validated', { 
        triggerType: validatedPayload.type,
        logId: validatedPayload.log_id,
      });

      // 6. Process asynchronously (respond immediately)
      deps.monitoringService.processWebhook(validatedPayload).catch((err) => {
        reqLog.error('Webhook processing failed', err, { 
          webhookId,
          triggerType: validatedPayload.type,
        });
      });

      // 7. Respond with 202 Accepted
      return c.json({ 
        status: 'accepted',
        requestId,
      }, 202);

    } catch (error) {
      reqLog.error('Webhook handler error', error);
      return c.json({ error: 'Internal server error' }, 500);
    }
  });

  // ===========================================================================
  // Health Check for Webhook Endpoint
  // ===========================================================================

  /**
   * GET /webhooks/health
   * 
   * Health check for the webhook endpoint.
   * Used by Composio to verify the endpoint is reachable.
   */
  webhookRoutes.get('/health', (c) => {
    return c.json({ 
      status: 'ok',
      endpoint: 'webhooks',
      timestamp: new Date().toISOString(),
    });
  });

  return webhookRoutes;
}

// =============================================================================
// Signature Verification
// =============================================================================

/**
 * Verify Composio webhook signature
 * 
 * The signature is calculated as:
 * signing_string = "{webhook-id}.{webhook-timestamp}.{raw_body}"
 * signature = HMAC-SHA256(signing_string, secret)
 * 
 * The signature header format is: "v1,<base64_signature>"
 */
function verifySignature(
  body: string,
  signature: string | undefined,
  msgId: string | undefined,
  timestamp: string | undefined,
  secret: string | undefined
): boolean {
  // In development without a secret, skip verification
  if (!secret) {
    logger.warn('COMPOSIO_WEBHOOK_SECRET not set, skipping signature verification');
    return true;
  }

  if (!signature || !msgId || !timestamp) {
    return false;
  }

  if (!signature.startsWith('v1,')) {
    return false;
  }

  // Check timestamp is recent (within 5 minutes)
  const timestampNum = parseInt(timestamp, 10);
  const now = Math.floor(Date.now() / 1000);
  const tolerance = 5 * 60; // 5 minutes
  
  if (Math.abs(now - timestampNum) > tolerance) {
    logger.warn('Webhook timestamp too old or in future', { 
      timestamp: timestampNum, 
      now,
      diff: Math.abs(now - timestampNum),
    });
    return false;
  }

  // Verify signature
  const received = signature.slice(3);
  const signingString = `${msgId}.${timestamp}.${body}`;
  
  const expected = crypto
    .createHmac('sha256', secret)
    .update(signingString)
    .digest('base64');

  // Use timing-safe comparison
  try {
    return crypto.timingSafeEqual(
      Buffer.from(received, 'base64'),
      Buffer.from(expected, 'base64')
    );
  } catch {
    // Buffer lengths don't match
    return false;
  }
}

// =============================================================================
// Default Export
// =============================================================================

export default createWebhookRoutes;
