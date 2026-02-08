import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

async function runMigrations() {
    const connectionString = process.env.DATABASE_URL;

    if (!connectionString) {
        throw new Error('DATABASE_URL environment variable is required');
    }

    console.log('Running migrations...');

    // Connection for migrations (max 1 connection)
    const migrationClient = postgres(connectionString, { max: 1 });
    const db = drizzle(migrationClient);

    await migrate(db, { migrationsFolder: './src/infrastructure/db/migrations' });

    console.log('Migrations completed successfully');

    await migrationClient.end();
    process.exit(0);
}

runMigrations().catch((error) => {
    console.error('Migration failed:', error);
    process.exit(1);
});
