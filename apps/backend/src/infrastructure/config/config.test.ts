import { describe, it, expect } from 'vitest';
import { z } from 'zod';

// Simplified schema for testing (matches main config but uses regex for URL validation)
const envSchema = z.object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.coerce.number().default(3000),
    DATABASE_URL: z.string().regex(/^postgresql:\/\//),
    REDIS_URL: z.string().regex(/^redis:\/\//).default('redis://localhost:6380'),
    JWT_SECRET: z.string().min(32),
    JWT_ACCESS_EXPIRY: z.string().default('15m'),
    JWT_REFRESH_EXPIRY: z.string().default('7d'),
    SECRETS_MASTER_KEY: z.string().length(64),
    OPENAI_API_KEY: z.string().optional(),
    ANTHROPIC_API_KEY: z.string().optional(),
});

describe('Config Validation', () => {
    it('should validate valid environment variables', () => {
        const validEnv = {
            NODE_ENV: 'development',
            PORT: '3000',
            DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
            REDIS_URL: 'redis://localhost:6379',
            JWT_SECRET: 'this-is-a-very-long-jwt-secret-that-is-definitely-over-32-characters',
            SECRETS_MASTER_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        };

        const result = envSchema.safeParse(validEnv);
        if (!result.success) {
            console.log('Validation failed:', result.error.format());
        }
        expect(result.success).toBe(true);
    });

    it('should reject invalid DATABASE_URL', () => {
        const invalidEnv = {
            DATABASE_URL: 'not-a-url',
            JWT_SECRET: 'this-is-a-very-long-jwt-secret-that-is-definitely-over-32-characters',
            SECRETS_MASTER_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        };

        const result = envSchema.safeParse(invalidEnv);
        expect(result.success).toBe(false);
    });

    it('should reject short JWT_SECRET', () => {
        const invalidEnv = {
            DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
            JWT_SECRET: 'short',
            SECRETS_MASTER_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        };

        const result = envSchema.safeParse(invalidEnv);
        expect(result.success).toBe(false);
    });

    it('should reject invalid SECRETS_MASTER_KEY length', () => {
        const invalidEnv = {
            DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
            JWT_SECRET: 'this-is-a-very-long-jwt-secret-that-is-definitely-over-32-characters',
            SECRETS_MASTER_KEY: 'too-short',
        };

        const result = envSchema.safeParse(invalidEnv);
        expect(result.success).toBe(false);
    });

    it('should use default values when not provided', () => {
        const minimalEnv = {
            DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
            JWT_SECRET: 'this-is-a-very-long-jwt-secret-that-is-definitely-over-32-characters',
            SECRETS_MASTER_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        };

        const result = envSchema.safeParse(minimalEnv);
        if (!result.success) {
            console.log('Validation failed:', result.error.format());
        }
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.NODE_ENV).toBe('development');
            expect(result.data.PORT).toBe(3000);
            expect(result.data.JWT_ACCESS_EXPIRY).toBe('15m');
        }
    });
});
