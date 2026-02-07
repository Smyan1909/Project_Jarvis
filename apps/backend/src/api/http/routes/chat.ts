// =============================================================================
// Chat Routes
// =============================================================================
// Streaming chat endpoints using Vercel AI SDK

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { streamText, generateText } from 'ai';
import { getLanguageModel } from '../../../infrastructure/ai/registry.js';
import { DEFAULT_MODELS } from '../../../infrastructure/ai/config.js';

export const chatRoutes = new Hono();

// =============================================================================
// Request Schemas
// =============================================================================

/**
 * Message schema matching AI SDK UIMessage format
 */
const messageSchema = z.object({
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string(),
});

/**
 * Streaming chat request schema
 */
const chatRequestSchema = z.object({
  messages: z.array(messageSchema).min(1),
  model: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().positive().optional(),
});

/**
 * Non-streaming generate request schema
 */
const generateRequestSchema = z.object({
  prompt: z.string().min(1).max(10000),
  system: z.string().max(5000).optional(),
  model: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().positive().optional(),
});

// =============================================================================
// Routes
// =============================================================================

/**
 * POST /api/v1/chat
 * Streaming chat endpoint using Data Stream Response
 *
 * This endpoint returns a data stream compatible with:
 * - @ai-sdk/react useChat hook
 * - React Native / Expo clients using AI SDK
 *
 * The stream includes text deltas, tool calls, and usage information.
 */
chatRoutes.post('/', zValidator('json', chatRequestSchema), async (c) => {
  const { messages, model, temperature, maxTokens } = c.req.valid('json');

  const modelId = model ?? DEFAULT_MODELS.chat;

  const result = streamText({
    model: getLanguageModel(modelId),
    messages,
    temperature,
    maxTokens,
    onError: ({ error }) => {
      console.error('[Chat Stream Error]', error);
    },
  });

  // Return data stream response for AI SDK UI integration
  return result.toDataStreamResponse();
});

/**
 * POST /api/v1/chat/stream
 * Alternative streaming endpoint with text-only response
 */
chatRoutes.post('/stream', zValidator('json', chatRequestSchema), async (c) => {
  const { messages, model, temperature, maxTokens } = c.req.valid('json');

  const modelId = model ?? DEFAULT_MODELS.chat;

  const result = streamText({
    model: getLanguageModel(modelId),
    messages,
    temperature,
    maxTokens,
  });

  // Return simple text stream
  return result.toTextStreamResponse();
});

/**
 * POST /api/v1/chat/generate
 * Non-streaming text generation endpoint
 *
 * Use this for simple one-shot requests where streaming is not needed.
 * Returns the complete response with usage statistics.
 */
chatRoutes.post('/generate', zValidator('json', generateRequestSchema), async (c) => {
  const { prompt, system, model, temperature, maxTokens } = c.req.valid('json');

  const modelId = model ?? DEFAULT_MODELS.chat;

  try {
    const result = await generateText({
      model: getLanguageModel(modelId),
      prompt,
      system,
      temperature,
      maxTokens,
    });

    return c.json({
      text: result.text,
      usage: {
        promptTokens: result.usage.promptTokens,
        completionTokens: result.usage.completionTokens,
        totalTokens: result.usage.totalTokens,
      },
      finishReason: result.finishReason,
      model: modelId,
    });
  } catch (error) {
    console.error('[Chat Generate Error]', error);

    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json(
      {
        error: 'Generation failed',
        message,
      },
      500
    );
  }
});

/**
 * GET /api/v1/chat/models
 * List available models
 */
chatRoutes.get('/models', (c) => {
  return c.json({
    models: [
      {
        id: 'openai:gpt-4o-mini',
        name: 'GPT-4o Mini',
        provider: 'openai',
        description: 'Fast, cost-effective model for simple tasks',
      },
      {
        id: 'openai:gpt-4o',
        name: 'GPT-4o',
        provider: 'openai',
        description: 'Balanced performance and cost',
      },
      {
        id: 'anthropic:claude-sonnet-4-20250514',
        name: 'Claude Sonnet 4',
        provider: 'anthropic',
        description: 'Powerful model for complex reasoning',
      },
      {
        id: 'anthropic:claude-haiku-3-5-20241022',
        name: 'Claude Haiku 3.5',
        provider: 'anthropic',
        description: 'Fast Anthropic model',
      },
    ],
    default: DEFAULT_MODELS.chat,
  });
});
