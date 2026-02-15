import { z } from 'zod';

const envSchema = z.object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.coerce.number().default(3000),

    // Database
    DATABASE_URL: z.string().regex(/^postgresql:\/\//, 'Must be a PostgreSQL URL'),

    // Redis
    REDIS_URL: z.string().regex(/^redis:\/\//, 'Must be a Redis URL').default('redis://localhost:6380'),

    // Auth
    JWT_SECRET: z.string().min(32),
    JWT_ACCESS_EXPIRY: z.string().default('15m'),
    JWT_REFRESH_EXPIRY: z.string().default('7d'),

    // Secrets encryption
    SECRETS_MASTER_KEY: z.string().length(64), // 32 bytes hex-encoded

    // CORS
    CORS_ORIGIN: z.string().default('*'),

    // WebSocket
    WS_PING_INTERVAL: z.coerce.number().default(25000), // 25 seconds
    WS_PING_TIMEOUT: z.coerce.number().default(5000),   // 5 seconds

    // LLM (optional - can use user secrets)
    OPENAI_API_KEY: z.string().optional(),
    ANTHROPIC_API_KEY: z.string().optional(),

    // OpenTelemetry (optional)
    OTEL_ENABLED: z.enum(['true', 'false']).default('true'),
    OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
    OTEL_SERVICE_NAME: z.string().default('project-jarvis-backend'),
    OTEL_SERVICE_VERSION: z.string().default('1.0.0'),
    OTEL_DEBUG: z.enum(['true', 'false']).default('false'),

    // Monitoring Agent (Composio integration)
    COMPOSIO_WEBHOOK_URL: z.string().url().optional(),
    COMPOSIO_WEBHOOK_SECRET: z.string().optional(),

    // Feature Flags
    ENABLE_EXAMPLE_PROMPTS: z.enum(['true', 'false']).default('false'),
    EXAMPLE_PROMPTS_PATH: z.string().default('./src/domain/orchestrator/example-prompts'),
});

export type Env = z.infer<typeof envSchema>;

function loadConfig(): Env {
    const result = envSchema.safeParse(process.env);

    if (!result.success) {
        console.error('Invalid environment variables:');
        console.error(result.error.format());
        process.exit(1);
    }

    return result.data;
}

export const config = loadConfig();
