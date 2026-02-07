import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db, queryClient } from './client.js';
import { users } from './schema.js';
import { sql } from 'drizzle-orm';

describe('Database Integration', () => {
    beforeAll(async () => {
        // Ensure pgvector extension is loaded
        await db.execute(sql`CREATE EXTENSION IF NOT EXISTS vector`);
    });

    afterAll(async () => {
        await queryClient.end();
    });

    it('should connect to database', async () => {
        const result = await db.execute(sql`SELECT 1 as test`);
        expect(result).toBeDefined();
    });

    it('should have pgvector extension installed', async () => {
        const result = await db.execute(
            sql`SELECT extname FROM pg_extension WHERE extname = 'vector'`
        );
        expect(result.length).toBe(1);
    });

    it('should have all required tables', async () => {
        const result = await db.execute(sql`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);

        const tableNames = result.map((r: any) => r.table_name);

        expect(tableNames).toContain('users');
        expect(tableNames).toContain('user_secrets');
        expect(tableNames).toContain('refresh_tokens');
        expect(tableNames).toContain('agent_runs');
        expect(tableNames).toContain('messages');
        expect(tableNames).toContain('tool_calls');
        expect(tableNames).toContain('memories');
        expect(tableNames).toContain('kg_entities');
        expect(tableNames).toContain('kg_relations');
    });

    it('should be able to insert and query users', async () => {
        const testEmail = `test-${Date.now()}@example.com`;

        // Insert
        const inserted = await db.insert(users).values({
            email: testEmail,
            passwordHash: 'test-hash',
            displayName: 'Test User',
        }).returning();

        expect(inserted.length).toBe(1);
        expect(inserted[0].email).toBe(testEmail);

        // Cleanup
        await db.delete(users).where(sql`email = ${testEmail}`);
    });
});
