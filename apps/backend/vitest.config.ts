import { defineConfig } from 'vitest/config';
import dotenv from 'dotenv';

// Load .env file
dotenv.config();

export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        include: ['src/**/*.test.ts'],
        testTimeout: 10000,
    },
});
