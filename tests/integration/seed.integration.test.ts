/**
 * Seed integration tests — reference data + mock FX rates (CUR-6, CRM-8).
 *
 * Starts its own Postgres container, applies all migrations as the owner
 * role, then runs `seedDatabase` as the app role and asserts:
 *  - core_currencies reference rows are inserted (idempotently)
 *  - core_fx_rates mock pairs exist for today, including the (EUR, USD) pair
 *    the CRM deal-conversion path (CRM-8) looks up
 *  - re-running the seed does not duplicate rows (idempotent)
 */
import type { StartedTestContainer } from 'testcontainers';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runAllMigrations } from '../../packages/db/src/migrate.js';
import { seedDatabase } from '../../packages/db/src/seed.js';

const APP_ROLE = 'modubiz_app';
const APP_PASSWORD = 'modubiz_app_password';

let container: StartedTestContainer;
let ownerSql: postgres.Sql;
let appUrl: string;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16')
    .withUsername('modubiz_owner')
    .withPassword('modubiz_owner_password')
    .withDatabase('modubiz_test')
    .withStartupTimeout(180_000)
    .start();
  const host = container.getHost();
  const port = container.getMappedPort(5432);
  const ownerUrl = `postgres://modubiz_owner:modubiz_owner_password@${host}:${port}/modubiz_test`;
  appUrl = `postgres://${APP_ROLE}:${APP_PASSWORD}@${host}:${port}/modubiz_test`;
  ownerSql = postgres(ownerUrl, { max: 1 });
  await ownerSql.unsafe(
    `CREATE ROLE ${APP_ROLE} LOGIN PASSWORD '${APP_PASSWORD}' NOBYPASSRLS; GRANT USAGE ON SCHEMA public TO ${APP_ROLE}; ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${APP_ROLE}; ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${APP_ROLE};`,
  );
  await runAllMigrations(ownerUrl);
  await ownerSql.unsafe(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${APP_ROLE}; GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${APP_ROLE};`,
  );
}, 180_000);

afterAll(async () => {
  if (ownerSql) await ownerSql.end();
  if (container) await container.stop();
});

describe('seedDatabase — reference data (CUR-6/CRM-8)', () => {
  it('seeds ISO currencies and today’s mock FX pairs, idempotently', async () => {
    await seedDatabase(appUrl);

    const currencies = await ownerSql`SELECT code FROM core_currencies ORDER BY code`;
    expect(currencies.length).toBeGreaterThanOrEqual(11);
    const codes = currencies.map((c) => c.code as string);
    expect(codes).toContain('USD');
    expect(codes).toContain('EUR');

    const today = new Date().toISOString().slice(0, 10);
    const rates = await ownerSql`
      SELECT base_currency, quote_currency FROM core_fx_rates WHERE valid_on = ${today}
    `;
    // All ordered pairs of seeded currencies, minus self-pairs.
    expect(rates.length).toBe(currencies.length * (currencies.length - 1));
    expect(rates.some((r) => r.base_currency === 'EUR' && r.quote_currency === 'USD')).toBe(true);

    // Re-run must not duplicate rows.
    await seedDatabase(appUrl);
    const afterSecondRun = await ownerSql`
      SELECT count(*)::int AS n FROM core_currencies
      UNION ALL
      SELECT count(*)::int FROM core_fx_rates WHERE valid_on = ${today}
    `;
    expect(afterSecondRun.map((r) => r.n)).toEqual([currencies.length, rates.length]);
  });
});
