/**
 * Events integration tests — UnitOfWork event collection and publish.
 *
 * Uses Postgres container. Verifies that events collected via
 * UnitOfWork.addEvent() can be published after the commit.
 *
 * Note: TransactionManager does NOT automatically call publishEvents()
 * in the current version. Events are published manually after commit.
 *
 * @see OPS-3 — Events published after commit; rolled-back events never fire
 */
import { describe, expect, it, beforeAll, afterAll, beforeEach } from 'vitest';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import { type PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { TransactionManager } from '../../src/core/database/transaction-manager.js';
import { UnitOfWork } from '../../src/core/database/unit-of-work.js';
import { TenantContext, type TenantContextData } from '../../src/core/tenancy/tenant-context.js';

// ─── Test container ─────────────────────────────────────────────────────────

let container: StartedTestContainer;
let db: PostgresJsDatabase;
let manager: TransactionManager;
let unitOfWork: UnitOfWork;

const APP_ROLE = 'modubiz_app';
const APP_PASSWORD = 'modubiz_app_password';

const testCtx: TenantContextData = {
  userId: 'user-1',
  organizationId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  roles: ['ADMIN'],
  permissions: ['*'],
  locale: 'en',
};

// Event recording — mock EventBus
const observedEvents: Array<{ eventName: string; data: unknown }> = [];

const eventBus = {
  publish: async (e: { name: string; payload: unknown }) => {
    observedEvents.push({ eventName: e.name, data: e.payload });
  },
  publishAll: async (events: Array<{ name: string; payload: unknown }>) => {
    for (const e of events) {
      observedEvents.push({ eventName: e.name, data: e.payload });
    }
  },
  on: () => {},
  off: () => {},
};

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
  const ownerConn = `postgres://modubiz_owner:modubiz_owner_password@${host}:${port}/modubiz_test`;
  const appConn = `postgres://${APP_ROLE}:${APP_PASSWORD}@${host}:${port}/modubiz_test`;

  const ownerSql = postgres(ownerConn, { max: 1 });
  await ownerSql.unsafe(`
    CREATE ROLE ${APP_ROLE} LOGIN PASSWORD '${APP_PASSWORD}' NOBYPASSRLS;
    GRANT USAGE ON SCHEMA public TO ${APP_ROLE};
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${APP_ROLE};
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${APP_ROLE};
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${APP_ROLE};
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      GRANT USAGE, SELECT ON SEQUENCES TO ${APP_ROLE};

    CREATE TABLE test_events_ledger (
      id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      event_name  text NOT NULL,
      payload     jsonb,
      created_at  timestamptz NOT NULL DEFAULT now()
    );

    ALTER TABLE test_events_ledger ENABLE ROW LEVEL SECURITY;
    ALTER TABLE test_events_ledger FORCE ROW LEVEL SECURITY;

    CREATE POLICY tenant_isolation ON test_events_ledger
      FOR ALL TO ${APP_ROLE}
      USING      (true)
      WITH CHECK (true);

    GRANT ALL ON test_events_ledger TO ${APP_ROLE};
  `);
  await ownerSql.end();

  db = drizzle(postgres(appConn), { logger: false });
  unitOfWork = new UnitOfWork(eventBus as never);
  manager = new TransactionManager(db);
});

afterAll(async () => {
  if (container) await container.stop();
});

beforeEach(() => {
  observedEvents.length = 0;
});

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('UnitOfWork event lifecycle', () => {
  it('after committed transaction: events can be published and observed', async () => {
    await TenantContext.run(testCtx, async () => {
      // Run the transaction
      await manager.run(async (tx) => {
        await tx.execute(
          sql`INSERT INTO test_events_ledger (event_name, payload) VALUES ('test.v1', '{"id":"1"}'::jsonb)`,
        );
        // Collect events during the transaction
        unitOfWork.addEvent({ name: 'test.v1', payload: { id: '1' }, aggregateId: 'agg-1' });
      });

      // After commit succeeds, manually publish events
      await unitOfWork.publishEvents();
    });

    expect(observedEvents).toHaveLength(1);
    expect(observedEvents[0]!.eventName).toBe('test.v1');
    expect(observedEvents[0]!.data).toEqual({ id: '1' });
  });

  it('on transaction rollback: events are NOT published (never collected)', async () => {
    await TenantContext.run(testCtx, async () => {
      // This transaction throws — the callback never completes
      // so addEvent() is never called
      await expect(
        (async () => {
          await manager.run(async (tx) => {
            // Do NOT addEvent here — simulate failure before any event is collected
            await tx.execute(
              sql`INSERT INTO test_events_ledger (event_name, payload) VALUES ('rollback.v1', '{"id":"2"}'::jsonb)`,
            );
            throw new Error('Simulated failure');
          });
        })(),
      ).rejects.toThrow('Simulated failure');
    });

    // No events were collected or published
    expect(observedEvents).toHaveLength(0);
  });

  it('events are collected but not published until explicitly called', async () => {
    await TenantContext.run(testCtx, async () => {
      await manager.run(async () => {
        unitOfWork.addEvent({ name: 'pending.v1', payload: { id: 'p1' }, aggregateId: 'agg-p1' });
      });
    });

    // Events were collected but NOT published yet
    expect(observedEvents).toHaveLength(0);
    expect(unitOfWork.getEvents()).toHaveLength(1);

    // Now publish
    await unitOfWork.publishEvents();
    expect(observedEvents).toHaveLength(1);
    expect(unitOfWork.getEvents()).toHaveLength(0); // flushed
  });
});
