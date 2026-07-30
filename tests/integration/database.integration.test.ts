/**
 * Database integration tests — RLS and tenant isolation (TEN-1, TEN-3).
 *
 * Starts its own Postgres container for complete isolation.
 * Test files run sequentially (fileParallelism: false in workspace config).
 *
 * @see TEN-1 — RLS WITH CHECK blocks inserting a row with a different organization_id
 * @see TEN-3 — No tenant context ⇒ zero rows, never all rows
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import { type PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { TransactionManager } from '../apps/api/src/core/database/transaction-manager.js';
import { UnitOfWork } from '../apps/api/src/core/database/unit-of-work.js';
import { TenantContext, type TenantContextData } from '../apps/api/src/core/tenancy/tenant-context.js';

// ─── Test container ─────────────────────────────────────────────────────────

let container: StartedTestContainer;
let db: PostgresJsDatabase;
let manager: TransactionManager;
let unitOfWork: UnitOfWork;

const APP_ROLE = 'modubiz_app';
const APP_PASSWORD = 'modubiz_app_password';

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
  const ownerConnString = `postgres://modubiz_owner:modubiz_owner_password@${host}:${port}/modubiz_test`;
  const appConnString = `postgres://${APP_ROLE}:${APP_PASSWORD}@${host}:${port}/modubiz_test`;

  const ownerSql = postgres(ownerConnString, { max: 1 });

  await ownerSql.unsafe(`
    CREATE ROLE ${APP_ROLE} LOGIN PASSWORD '${APP_PASSWORD}' NOBYPASSRLS;
    GRANT USAGE ON SCHEMA public TO ${APP_ROLE};
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${APP_ROLE};
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${APP_ROLE};
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${APP_ROLE};
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      GRANT USAGE, SELECT ON SEQUENCES TO ${APP_ROLE};

    CREATE TABLE test_items (
      id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id uuid NOT NULL,
      name            text NOT NULL,
      created_at      timestamptz NOT NULL DEFAULT now()
    );

    ALTER TABLE test_items ENABLE ROW LEVEL SECURITY;
    ALTER TABLE test_items FORCE ROW LEVEL SECURITY;

    CREATE POLICY tenant_isolation ON test_items
      FOR ALL TO ${APP_ROLE}
      USING      (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
      WITH CHECK (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);

    GRANT ALL ON test_items TO ${APP_ROLE};
  `);

  await ownerSql.end();

  const appClient = postgres(appConnString);
  db = drizzle(appClient, { logger: false });

  const mockEventBus = { publish: async () => {}, publishAll: async () => {}, on: () => {}, off: () => {} };
  unitOfWork = new UnitOfWork(mockEventBus as never);
  manager = new TransactionManager(db, unitOfWork as never);
});

afterAll(async () => {
  if (container) await container.stop();
});

// ─── Tenant contexts ────────────────────────────────────────────────────────

const orgA: TenantContextData = {
  userId: 'user-1',
  organizationId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  roles: ['ADMIN'],
  permissions: ['*'],
  locale: 'en',
};

const orgB: TenantContextData = {
  userId: 'user-2',
  organizationId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  roles: ['ADMIN'],
  permissions: ['*'],
  locale: 'en',
};

// ─── TEN-3 ──────────────────────────────────────────────────────────────────

describe('TEN-3: No tenant context ⇒ zero rows, never all rows', () => {
  it('TEN-3: read without tenant context returns zero rows', async () => {
    await TenantContext.run(orgA, async () => {
      await manager.run(async (tx) => {
        await tx.execute(sql`INSERT INTO test_items (organization_id, name) VALUES (${orgA.organizationId}, 'ten3a')`);
      });
    });

    await TenantContext.runWithCleanContext(async () => {
      const rows = await db.execute(sql`SELECT * FROM test_items WHERE name = 'ten3a'`);
      expect(rows.count).toBe(0);
    });
  });

  it('TEN-3: update without tenant context affects zero rows', async () => {
    let id: string | undefined;
    await TenantContext.run(orgA, async () => {
      await manager.run(async (tx) => {
        const [row] = await tx.execute(
          sql`INSERT INTO test_items (organization_id, name) VALUES (${orgA.organizationId}, 'ten3b') RETURNING id`,
        );
        id = row!.id as string;
      });
    });

    await TenantContext.runWithCleanContext(async () => {
      await db.execute(sql`UPDATE test_items SET name = 'hacked' WHERE id = ${id}`);
    });

    await TenantContext.run(orgA, async () => {
      await manager.run(async (tx) => {
        const [row] = await tx.execute(sql`SELECT name FROM test_items WHERE id = ${id}`);
        expect((row as Record<string, unknown> | undefined)?.name).toBe('ten3b');
      });
    });
  });

  it('TEN-3: delete without tenant context affects zero rows', async () => {
    let id: string | undefined;
    await TenantContext.run(orgA, async () => {
      await manager.run(async (tx) => {
        const [row] = await tx.execute(
          sql`INSERT INTO test_items (organization_id, name) VALUES (${orgA.organizationId}, 'ten3c') RETURNING id`,
        );
        id = row!.id as string;
      });
    });

    await TenantContext.runWithCleanContext(async () => {
      await db.execute(sql`DELETE FROM test_items WHERE id = ${id}`);
    });

    await TenantContext.run(orgA, async () => {
      await manager.run(async (tx) => {
        const [row] = await tx.execute(sql`SELECT id FROM test_items WHERE id = ${id}`);
        expect(row).toBeDefined();
      });
    });
  });
});

// ─── TEN-1 ──────────────────────────────────────────────────────────────────

describe('TEN-1: RLS WITH CHECK', () => {
  it('TEN-1: insert with matching org_id succeeds', async () => {
    await TenantContext.run(orgA, async () => {
      await manager.run(async (tx) => {
        await expect(
          tx.execute(sql`INSERT INTO test_items (organization_id, name) VALUES (${orgA.organizationId}, 'ten1a')`),
        ).resolves.not.toThrow();
      });
    });
  });

  it('TEN-1: insert with different org_id is rejected', async () => {
    await TenantContext.run(orgA, async () => {
      await expect(
        manager.run(async (tx) => {
          await tx.execute(
            sql`INSERT INTO test_items (organization_id, name) VALUES (${orgB.organizationId}, 'ten1b')`,
          );
        }),
      ).rejects.toThrow();
    });
  });
});

// ─── TransactionManager session variables ──────────────────────────────────

describe('TransactionManager sets session variables', () => {
  it('sets current_organization_id', async () => {
    await TenantContext.run(orgA, async () => {
      await manager.run(async (tx) => {
        const [row] = await tx.execute(sql`SELECT current_setting('app.current_organization_id', true) AS v`);
        expect((row as Record<string, unknown>).v).toBe(orgA.organizationId);
      });
    });
  });

  it('sets current_user_id', async () => {
    await TenantContext.run(orgA, async () => {
      await manager.run(async (tx) => {
        const [row] = await tx.execute(sql`SELECT current_setting('app.current_user_id', true) AS v`);
        expect((row as Record<string, unknown>).v).toBe(orgA.userId);
      });
    });
  });

  it('throws TenantContext required error', async () => {
    await TenantContext.runWithCleanContext(async () => {
      await expect(
        manager.run(async (tx) => {
          await tx.execute(sql`SELECT 1`);
        }),
      ).rejects.toThrow(/Cannot run transaction without tenant context/i);
    });
  });
});
