import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createMigrationClient } from './drizzle-config.js';

/**
 * Migration runner.
 *
 * Executes SQL migration files sequentially as the `modubiz_owner` role.
 * Migrations are owned per module and stored in:
 * - `packages/db/migrations/core/` — platform migrations
 * - `modules/<key>/db/migrations/` — module-owned migrations
 *
 * @param connectionString - Owner role connection string (DATABASE_MIGRATION_URL)
 * @param migrationsDir - Directory containing `.sql` migration files
 */
export async function runMigrations(connectionString: string, migrationsDir: string): Promise<void> {
  const sql = createMigrationClient(connectionString);

  try {
    // Ensure the migrations tracking table exists
    await sql`
      CREATE TABLE IF NOT EXISTS _migrations (
        name    text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `;

    // Read and sort migration files
    const files = readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql') && !f.endsWith('.down.sql'))
      .sort();

    for (const file of files) {
      // Check if already applied
      const [row] = await sql`SELECT name FROM _migrations WHERE name = ${file}`;

      if (!row) {
        const filePath = join(migrationsDir, file);
        const sqlContent = readFileSync(filePath, 'utf-8');

        console.log(`📦 Applying migration: ${file}`);

        await sql.unsafe(sqlContent);

        await sql`INSERT INTO _migrations (name) VALUES (${file})`;

        console.log(`✅ Applied: ${file}`);
      } else {
        console.log(`⏭️  Already applied: ${file}`);
      }
    }

    console.log('🎉 All migrations applied successfully');
  } finally {
    await sql.end();
  }
}

/**
 * Rollback a specific migration by name.
 * Executes the corresponding `.down.sql` file if it exists.
 */
export async function rollbackMigration(
  connectionString: string,
  migrationsDir: string,
  migrationName: string,
): Promise<void> {
  const sql = createMigrationClient(connectionString);

  try {
    const downFile = join(migrationsDir, migrationName.replace('.sql', '.down.sql'));

    try {
      const sqlContent = readFileSync(downFile, 'utf-8');
      console.log(`⏪ Rolling back: ${migrationName}`);
      await sql.unsafe(sqlContent);
      await sql`DELETE FROM _migrations WHERE name = ${migrationName}`;
      console.log(`✅ Rolled back: ${migrationName}`);
    } catch {
      console.error(`❌ No .down.sql file found for: ${migrationName}`);
      throw new Error(`Rollback not available for ${migrationName}`);
    }
  } finally {
    await sql.end();
  }
}
