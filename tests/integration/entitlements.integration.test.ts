/**
 * Entitlement-store integration tests — real Postgres, RLS active.
 *
 * Proves the EntitlementGuard path (AUTHZ-6/BILL-4): DrizzleEntitlementStore
 * reads core_module_entitlements scoped to the org bound from the verified
 * JWT — and does so WITHOUT a TenantContext, because the guard runs before
 * the TenantInterceptor. This is the regression that made every CRM request
 * return 403 MODULE_NOT_ENTITLED while the in-memory stub was the provider:
 * the trial write landed in the DB, but the guard never saw it.
 *
 * @see BILL-4 — core_module_entitlements is the runtime authority
 * @see ARCHITECTURE.md §5 — Request lifecycle (EntitlementGuard pre-interceptor)
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import type { StartedTestContainer } from 'testcontainers';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { randomUUID } from 'node:crypto';

import { TransactionManager } from '../../apps/api/src/core/database/transaction-manager.js';
import { TenantContext, type TenantContextData } from '../../apps/api/src/core/tenancy/tenant-context.js';
import { DrizzleEntitlementStore } from '../../apps/api/src/core/entitlements/drizzle-entitlement.store.js';
import { EntitlementService } from '../../apps/api/src/core/entitlements/entitlement.service.js';
import { applyAllMigrations } from './helpers/migrations.js';
import { DrizzleOrganizationRepository } from '../../apps/api/src/platform/organizations/infrastructure/repositories/drizzle-organization.repository.js';
import { DrizzleRoleRepository } from '../../apps/api/src/platform/roles/infrastructure/repositories/drizzle-role.repository.js';
import { DrizzleMembershipRepository } from '../../apps/api/src/platform/memberships/infrastructure/repositories/drizzle-membership.repository.js';
import { CreateOrganizationUseCase } from '../../apps/api/src/platform/organizations/application/create-organization.use-case.js';

const APP_ROLE = 'modubiz_app';
const APP_PASSWORD = 'modubiz_app_password';

let container: StartedTestContainer;
let db: PostgresJsDatabase;
let ownerSql: postgres.Sql;
let ownerUserId: string;
let store: DrizzleEntitlementStore;
let service: EntitlementService;
let orgA: string;
let orgB: string;

const ownerContext: TenantContextData = {
  userId: '',
  organizationId: undefined,
  roles: [],
  permissions: [],
  locale: 'en',
};

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16')
    .withUsername('modubiz_owner')
    .withPassword('modubiz_owner_password')
    .withDatabase('modubiz_test')
    .withStartupTimeout(180_000)
    .start();

  const host = container.getHost();
  const port = container.getMappedPort(5432);
  const ownerConnString = `postgres://modubiz_owner:modubiz_owner_password@${host}:${port}/modubiz_test`;
  const appConnString = `postgres://${APP_ROLE}:${APP_PASSWORD}@${host}:${port}/modubiz_test`;

  ownerSql = postgres(ownerConnString, { max: 1 });

  await ownerSql.unsafe(`
    CREATE ROLE ${APP_ROLE} LOGIN PASSWORD '${APP_PASSWORD}' NOBYPASSRLS;
    GRANT USAGE ON SCHEMA public TO ${APP_ROLE};
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${APP_ROLE};
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      GRANT USAGE, SELECT ON SEQUENCES TO ${APP_ROLE};
  `);

  await applyAllMigrations(ownerConnString);

  await ownerSql.unsafe(`
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${APP_ROLE};
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${APP_ROLE};
  `);

  // A real user row is required (core_organizations.created_by FK).
  ownerUserId = randomUUID();
  await ownerSql`
    INSERT INTO core_users (id, email, password_hash, name)
    VALUES (${ownerUserId}, ${'ent-owner@example.com'}, ${'hash'}, ${'Ent Owner'})
  `;

  // Catalog rows are required by the core_module_entitlements FK.
  await ownerSql`
    INSERT INTO core_module_catalog (key, version, name, description, table_prefix, stripe_price_key, trial_days)
    VALUES
      ('crm', '1.0.0', 'CRM', 'Customer relationship management', 'crm_', 'price_crm_monthly', 14),
      ('pos', '1.0.0', 'POS', 'Point of sale', 'pos_', 'price_pos_monthly', 14)
  `;

  db = drizzle(postgres(appConnString), { logger: false });
  store = new DrizzleEntitlementStore(db);
  service = new EntitlementService(store);

  orgA = await createOrg('Ent Org A');
  orgB = await createOrg('Ent Org B');
}, 180_000);

afterAll(async () => {
  if (ownerSql) await ownerSql.end();
  if (container) await container.stop();
});

async function createOrg(name: string): Promise<string> {
  const orgRepo = new DrizzleOrganizationRepository(db);
  const roleRepo = new DrizzleRoleRepository(db);
  const membershipRepo = new DrizzleMembershipRepository(db);
  const txManager = new TransactionManager(db);
  const createUseCase = new CreateOrganizationUseCase(orgRepo, roleRepo, membershipRepo, txManager);

  const slug = `ent-${randomUUID().slice(0, 8)}`;

  const result = await TenantContext.run({ ...ownerContext, userId: ownerUserId }, () =>
    createUseCase.execute({
      name,
      slug,
      countryCode: 'US',
      baseCurrency: 'USD',
    }),
  );

  return result.organization.id;
}

/** Seed an entitlement row as the owner role (bypasses RLS). */
async function seedEntitlement(orgId: string, moduleKey: string, state: string): Promise<void> {
  await ownerSql`
    INSERT INTO core_module_entitlements (organization_id, module_key, state, trial_started_at, trial_ends_at, activated_at)
    VALUES (${orgId}, ${moduleKey}, ${state}, NOW(), NOW() + INTERVAL '14 days', NOW())
  `;
}

describe('DrizzleEntitlementStore (integration)', () => {
  it('BILL-4/AUTHZ-6: reads a trialing entitlement scoped to the bound org, without TenantContext (guard path)', async () => {
    await seedEntitlement(orgA, 'crm', 'trialing');

    // No TenantContext.run() — exactly the conditions the EntitlementGuard
    // runs under (guards execute before the TenantInterceptor).
    const entry = await store.findByOrgAndModule(orgA, 'crm');
    expect(entry).toBeDefined();
    expect(entry?.moduleKey).toBe('crm');
    expect(entry?.organizationId).toBe(orgA);
    expect(entry?.state).toBe('trialing');
    expect(entry?.trialStartedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(entry?.trialEndsAt).not.toBeNull();

    // RLS fail-closed: a different org never sees org A's entitlement.
    const otherOrg = await store.findByOrgAndModule(orgB, 'crm');
    expect(otherOrg).toBeUndefined();
  });

  it('findByOrg lists only the bound org entitlements', async () => {
    await seedEntitlement(orgA, 'pos', 'active');

    const orgAEntries = await store.findByOrg(orgA);
    expect(orgAEntries.map((e) => e.moduleKey).sort()).toEqual(['crm', 'pos']);

    const orgBEntries = await store.findByOrg(orgB);
    expect(orgBEntries).toHaveLength(0);
  });

  it('EntitlementService.isEntitled reflects live DB state (active/trialing entitled, missing denied)', async () => {
    expect(await service.isEntitled(orgA, 'crm')).toBe(true);
    expect(await service.isEntitled(orgA, 'pos')).toBe(true);
    expect(await service.isEntitled(orgB, 'crm')).toBe(false);
    expect(await service.hasFullAccess(orgA, 'crm')).toBe(true);
  });

  it('upsert creates and updates; updateState transitions the entitlement', async () => {
    // upsert of a brand-new module (inventory is not in the catalog FK set,
    // so use a fresh org + an existing catalog key instead).
    await store.upsert({
      moduleKey: 'pos',
      organizationId: orgB,
      state: 'trialing',
      trialStartedAt: new Date().toISOString(),
      trialEndsAt: null,
      activatedAt: new Date().toISOString(),
      disabledAt: null,
      purgeAfter: null,
    });
    expect(await service.isEntitled(orgB, 'pos')).toBe(true);

    // updateState flips to disabled → denied.
    await store.updateState(orgB, 'pos', 'disabled');
    expect(await service.isEntitled(orgB, 'pos')).toBe(false);

    // upsert on an existing row updates its state.
    await store.upsert({
      moduleKey: 'crm',
      organizationId: orgA,
      state: 'expired',
      trialStartedAt: null,
      trialEndsAt: null,
      activatedAt: null,
      disabledAt: null,
      purgeAfter: null,
    });
    expect(await service.isEntitled(orgA, 'crm')).toBe(true); // expired = read-only
    expect(await service.hasFullAccess(orgA, 'crm')).toBe(false);
  });

  it('ACC-16: features survive a store round-trip as a real jsonb array (isFeatureEnabled)', async () => {
    // The drizzle write path JSON-encodes the set and casts ::jsonb; the read
    // path must return a REAL array (Array.isArray true) so isFeatureEnabled
    // works. Regression guard for the ACC-16/PUR-12 plan-gated features.
    await store.upsert({
      moduleKey: 'pos',
      organizationId: orgA,
      state: 'trialing',
      trialStartedAt: null,
      trialEndsAt: null,
      activatedAt: null,
      disabledAt: null,
      purgeAfter: null,
      features: ['advanced_coa', 'e_invoicing'],
    });

    const entry = await store.findByOrgAndModule(orgA, 'pos');
    expect(Array.isArray(entry?.features)).toBe(true);
    expect(entry?.features).toEqual(['advanced_coa', 'e_invoicing']);

    expect(await service.isFeatureEnabled(orgA, 'pos', 'advanced_coa')).toBe(true);
    expect(await service.isFeatureEnabled(orgA, 'pos', 'purchase_approval')).toBe(false);
  });
});
