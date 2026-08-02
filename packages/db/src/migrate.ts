import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMigrationClient } from './drizzle-config.js';

// Repo-root-relative paths are resolved from this file's URL (not CWD) so the
// runner works regardless of the directory it is invoked from.
const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const CORE_MIGRATIONS_DIR = join(REPO_ROOT, 'packages/db/migrations/core');
const MODULES_ROOT = join(REPO_ROOT, 'apps/api/src/modules');

/**
 * Migration runner.
 *
 * Executes SQL migration files sequentially as the `modubiz_owner` role.
 * Migrations are owned per module and stored in:
 * - `packages/db/migrations/core/` — platform migrations (bare tracking names)
 * - `apps/api/src/modules/<key>/db/migrations/` — module-owned migrations
 *
 * @param connectionString - Owner role connection string (DATABASE_MIGRATION_URL)
 * @param migrationsDir - Directory containing `.sql` migration files
 * @param namespace - Optional module key. When set, the `_migrations` tracking
 *   key becomes `<namespace>/<file>` so identically-named files across modules
 *   (e.g. two `0001_init.sql`) never collide. Core stays bare (backward
 *   compatible with already-applied rows).
 */
export async function runMigrations(
  connectionString: string,
  migrationsDir: string,
  namespace?: string,
): Promise<void> {
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
      const trackingName = namespace ? `${namespace}/${file}` : file;

      // Check if already applied
      const [row] = await sql`SELECT name FROM _migrations WHERE name = ${trackingName}`;

      if (!row) {
        const filePath = join(migrationsDir, file);
        const sqlContent = readFileSync(filePath, 'utf-8');

        console.log(`📦 Applying migration: ${trackingName}`);

        await sql.unsafe(sqlContent);

        await sql`INSERT INTO _migrations (name) VALUES (${trackingName})`;

        console.log(`✅ Applied: ${trackingName}`);
      } else {
        console.log(`⏭️  Already applied: ${trackingName}`);
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
 *
 * @param namespace - Module key matching the namespace used at apply time; the
 *   `_migrations` key is `<namespace>/<migrationName>`. Core passes undefined.
 */
export async function rollbackMigration(
  connectionString: string,
  migrationsDir: string,
  migrationName: string,
  namespace?: string,
): Promise<void> {
  const sql = createMigrationClient(connectionString);

  try {
    const downFile = join(migrationsDir, migrationName.replace('.sql', '.down.sql'));
    const trackingName = namespace ? `${namespace}/${migrationName}` : migrationName;

    try {
      const sqlContent = readFileSync(downFile, 'utf-8');
      console.log(`⏪ Rolling back: ${trackingName}`);
      await sql.unsafe(sqlContent);
      await sql`DELETE FROM _migrations WHERE name = ${trackingName}`;
      console.log(`✅ Rolled back: ${trackingName}`);
    } catch {
      console.error(`❌ No .down.sql file found for: ${trackingName}`);
      throw new Error(`Rollback not available for ${trackingName}`);
    }
  } finally {
    await sql.end();
  }
}

/** A module's migration directory discovered under `modules/<key>/db/migrations/`. */
export interface ModuleMigrationDir {
  key: string;
  dir: string;
}

/**
 * Discover module-owned migration directories: one subdirectory per module
 * under `modulesRoot`, each with a `db/migrations/` folder. Only directories
 * containing at least one `.sql` migration (non-down) are returned, sorted by
 * module key for a deterministic apply order.
 */
export function discoverModuleMigrationDirs(modulesRoot: string): ModuleMigrationDir[] {
  if (!existsSync(modulesRoot)) return [];

  return readdirSync(modulesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      key: entry.name,
      dir: join(modulesRoot, entry.name, 'db', 'migrations'),
    }))
    .filter(
      ({ dir }) => existsSync(dir) && readdirSync(dir).some((f) => f.endsWith('.sql') && !f.endsWith('.down.sql')),
    )
    .sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * Apply the platform core migrations followed by every discovered module-owned
 * migration directory. Each module's migrations run with the module key as a
 * namespace, so identical filenames across modules never collide in
 * `_migrations`.
 *
 * @param options.modulesRoot - Override the modules root (defaults to
 *   `apps/api/src/modules`). Used by tests with fixture module dirs.
 */
export async function runAllMigrations(
  connectionString: string,
  options: { modulesRoot?: string } = {},
): Promise<void> {
  const modulesRoot = options.modulesRoot ?? MODULES_ROOT;

  await runMigrations(connectionString, CORE_MIGRATIONS_DIR);

  // Discovery order is alphabetical by module key (deterministic), which is
  // correct because module-owned tables are independent — the architecture
  // forbids cross-module FKs (ids are stored and validated via ports/events).
  // If a future module migration genuinely depends on another module's schema,
  // this needs a dependency-ordered (topological) sort instead.
  for (const { key, dir } of discoverModuleMigrationDirs(modulesRoot)) {
    console.log(`\n🧩 Applying migrations for module "${key}"`);
    await runMigrations(connectionString, dir, key);
  }
}
