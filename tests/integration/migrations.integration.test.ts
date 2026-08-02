/**
 * Module-aware migration runner integration tests — real Postgres.
 *
 * Covers PLAN.md Phase 4 Step 4.0.1:
 *   - runAllMigrations applies core migrations then every module-owned
 *     migration dir under a modules root
 *   - identically-named migration files across modules (two `0001_init.sql`)
 *     do NOT collide: each is tracked under a namespaced key
 *     (`<module>/0001_init.sql`) in the `_migrations` table
 *   - re-running is idempotent (already-applied entries are skipped)
 *
 * Fixture module dirs are created in a temp dir so this test never touches the
 * real `apps/api/src/modules/` tree.
 *
 * @see AGENTS.md §9 — Definition of done (integration tests)
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import postgres from 'postgres';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { rollbackMigration, runAllMigrations } from '../../packages/db/src/migrate.js';

let container: StartedTestContainer;
let ownerSql: postgres.Sql;
let ownerConnString: string;
let fixtureModulesRoot: string;

beforeAll(async () => {
  container = await new GenericContainer('postgres:16')
    .withEnvironment({
      POSTGRES_USER: 'modubiz_owner',
      POSTGRES_PASSWORD: 'modubiz_owner_password',
      POSTGRES_DB: 'modubiz_test',
    })
    .withExposedPorts(5432)
    .withStartupTimeout(180_000)
    .start();

  const host = container.getHost();
  const port = container.getMappedPort(5432);
  ownerConnString = `postgres://modubiz_owner:modubiz_owner_password@${host}:${port}/modubiz_test`;
  ownerSql = postgres(ownerConnString, { max: 1 });

  // Core RLS migrations grant privileges to the non-owner app role, so it
  // must exist before migrating (mirrors docker/init.sql + the other suites).
  await ownerSql.unsafe(`
    CREATE ROLE modubiz_app LOGIN PASSWORD 'modubiz_app_password' NOBYPASSRLS;
    GRANT USAGE ON SCHEMA public TO modubiz_app;
  `);

  // Fixture modules root with two modules that both ship `0001_init.sql`
  // (identical filename, different content) — the collision scenario. Named
  // mod_a/mod_b so they don't shadow the real registered module keys (crm,
  // pos) if a future reader greps for namespaced tracking keys.
  fixtureModulesRoot = mkdtempSync(join(tmpdir(), 'modubiz-modules-'));
  for (const key of ['mod_a', 'mod_b'] as const) {
    const migrationsDir = join(fixtureModulesRoot, key, 'db', 'migrations');
    mkdirSync(migrationsDir, { recursive: true });
    writeFileSync(join(migrationsDir, '0001_init.sql'), `CREATE TABLE fixture_${key}_first (id uuid PRIMARY KEY);\n`);
    writeFileSync(join(migrationsDir, '0001_init.down.sql'), `DROP TABLE fixture_${key}_first;\n`);
    writeFileSync(join(migrationsDir, '0002_rls.sql'), `ALTER TABLE fixture_${key}_first ENABLE ROW LEVEL SECURITY;\n`);
  }
});

afterAll(async () => {
  if (ownerSql) await ownerSql.end();
  if (fixtureModulesRoot) rmSync(fixtureModulesRoot, { recursive: true, force: true });
  if (container) await container.stop();
});

describe('runAllMigrations — module-aware runner (integration, real Postgres)', () => {
  it('applies core + module migrations with namespaced tracking keys (no filename collision)', async () => {
    await runAllMigrations(ownerConnString, { modulesRoot: fixtureModulesRoot });

    // Both fixture tables exist (both modules' 0001_init.sql actually ran).
    for (const table of ['fixture_mod_a_first', 'fixture_mod_b_first'] as const) {
      const [row] = await ownerSql`SELECT to_regclass(${table}) AS t`;
      expect(row?.t, `${table} should exist`).toBe(table);
    }

    // Tracking keys are namespaced per module — no collision between the two
    // identically-named `0001_init.sql` files.
    const rows = await ownerSql`SELECT name FROM _migrations ORDER BY name`;
    const names = rows.map((r) => r.name as string);
    expect(names).toContain('mod_a/0001_init.sql');
    expect(names).toContain('mod_a/0002_rls.sql');
    expect(names).toContain('mod_b/0001_init.sql');
    expect(names).toContain('mod_b/0002_rls.sql');
  });

  it('rolls back a namespaced module migration (down file + tracking key stay aligned)', async () => {
    await rollbackMigration(
      ownerConnString,
      join(fixtureModulesRoot, 'mod_b', 'db', 'migrations'),
      '0001_init.sql',
      'mod_b',
    );

    // The tracked key is removed and the down file's effect (table drop) is visible.
    const names = (await ownerSql`SELECT name FROM _migrations`).map((r) => r.name as string);
    expect(names).not.toContain('mod_b/0001_init.sql');
    expect(names).toContain('mod_a/0001_init.sql'); // sibling module untouched

    // A re-apply after rollback works (the migration is no longer tracked).
    await runAllMigrations(ownerConnString, { modulesRoot: fixtureModulesRoot });
    const reApplied = (await ownerSql`SELECT name FROM _migrations`).map((r) => r.name as string);
    expect(reApplied).toContain('mod_b/0001_init.sql');
  });

  it('is idempotent — a second run applies nothing new', async () => {
    const before = (await ownerSql`SELECT COUNT(*)::int AS n FROM _migrations`)[0]!.n;

    await runAllMigrations(ownerConnString, { modulesRoot: fixtureModulesRoot });

    const after = (await ownerSql`SELECT COUNT(*)::int AS n FROM _migrations`)[0]!.n;
    expect(after).toBe(before);
  });
});
