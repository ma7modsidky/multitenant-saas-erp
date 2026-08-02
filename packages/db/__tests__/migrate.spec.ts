/**
 * Unit tests for the module-aware migration discovery (PLAN.md Step 4.0.1).
 *
 * `discoverModuleMigrationDirs` is pure filesystem logic, so it is tested
 * here without a database. The apply + collision + idempotency behaviour is
 * covered against real Postgres in tests/integration/migrations.integration.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { discoverModuleMigrationDirs } from '../src/migrate.js';

function makeFixtureRoot(): string {
  return mkdtempSync(join(tmpdir(), 'modubiz-discover-'));
}

describe('discoverModuleMigrationDirs', () => {
  it('returns modules with a non-empty db/migrations dir, sorted by key', () => {
    const root = makeFixtureRoot();
    try {
      // crm and pos both have migrations; zzz has none (empty dir → skipped).
      for (const key of ['pos', 'crm', 'zzz'] as const) {
        const dir = join(root, key, 'db', 'migrations');
        mkdirSync(dir, { recursive: true });
        if (key !== 'zzz') {
          writeFileSync(join(dir, '0001_init.sql'), 'SELECT 1;');
        }
      }

      const found = discoverModuleMigrationDirs(root);
      expect(found.map((m) => m.key)).toEqual(['crm', 'pos']);
      expect(found[0]!.dir).toBe(join(root, 'crm', 'db', 'migrations'));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('ignores .down.sql files when deciding a dir has migrations', () => {
    const root = makeFixtureRoot();
    try {
      const dir = join(root, 'inv', 'db', 'migrations');
      mkdirSync(dir, { recursive: true });
      // Only a down file present — must NOT count as a migration dir.
      writeFileSync(join(dir, '0001_init.down.sql'), 'DROP TABLE x;');

      expect(discoverModuleMigrationDirs(root)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('returns [] for a missing root and for dirs without a db/migrations path', () => {
    const root = makeFixtureRoot();
    try {
      mkdirSync(join(root, 'no-db-folder'), { recursive: true });
      expect(discoverModuleMigrationDirs(root)).toEqual([]);
      expect(discoverModuleMigrationDirs(join(root, 'does-not-exist'))).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
