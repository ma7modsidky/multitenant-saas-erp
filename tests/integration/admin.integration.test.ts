/**
 * Platform Admin Console integration tests — real Postgres, RLS active.
 *
 * Covers the admin code path (PRD §5.5, docs/ARCHITECTURE.md §8):
 *   - PLT-3: per-org tenant state is read/written only inside
 *     TransactionManager.runWithOrg — never via an unscoped cross-tenant scan
 *   - PLT-4: every admin mutation is appended to core_platform_audit_log
 *   - PLT-6: module pricing upserts join the boot-mirrored catalog
 *   - PLT-7: SaaS settings are allow-listed and value-typed
 *   - Admin overview aggregates per-org entitlements correctly
 *   - PLT-2: PlatformAdminGuard rejects non-admin sessions (403)
 *
 * @see AGENTS.md §9 — Definition of done (integration tests)
 */
import 'reflect-metadata'; // Nest decorators need the Reflect polyfill
import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { RequiresPlatformAdmin } from '../../apps/api/src/core/authorization/platform-admin.decorator.js';
import type { StartedTestContainer } from 'testcontainers';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { randomUUID } from 'node:crypto';

import { PlatformAdminGuard } from '../../apps/api/src/core/authorization/platform-admin.guard.js';
import { TransactionManager } from '../../apps/api/src/core/database/transaction-manager.js';
import { TenantContext, type TenantContextData } from '../../apps/api/src/core/tenancy/tenant-context.js';
import { applyAllMigrations } from './helpers/migrations.js';
import { AdminOverviewUseCase } from '../../apps/api/src/platform/admin/application/admin-overview.use-case.js';
import { GetOrganizationDetailUseCase } from '../../apps/api/src/platform/admin/application/get-organization-detail.use-case.js';
import { SetOrganizationModuleUseCase } from '../../apps/api/src/platform/admin/application/set-organization-module.use-case.js';
import { UpdateModulePricingUseCase } from '../../apps/api/src/platform/admin/application/update-module-pricing.use-case.js';
import { UpdateSaasSettingsUseCase } from '../../apps/api/src/platform/admin/application/update-saas-settings.use-case.js';
import { DrizzleAdminDirectoryRepository } from '../../apps/api/src/platform/admin/infrastructure/repositories/drizzle-admin-directory.repository.js';
import { DrizzleModulePricingRepository } from '../../apps/api/src/platform/admin/infrastructure/repositories/drizzle-module-pricing.repository.js';
import { DrizzlePlatformAuditRepository } from '../../apps/api/src/platform/admin/infrastructure/repositories/drizzle-platform-audit.repository.js';
import { DrizzleSaasSettingsRepository } from '../../apps/api/src/platform/admin/infrastructure/repositories/drizzle-saas-settings.repository.js';
import { DrizzleBillingRepository } from '../../apps/api/src/platform/billing/infrastructure/repositories/drizzle-billing.repository.js';
import { FakeStripeAdapter } from '../../apps/api/src/platform/billing/infrastructure/stripe/fake-stripe.adapter.js';
import { DrizzleMembershipRepository } from '../../apps/api/src/platform/memberships/infrastructure/repositories/drizzle-membership.repository.js';
import { DrizzleModuleRegistryRepository } from '../../apps/api/src/platform/module-registry/infrastructure/repositories/drizzle-module-registry.repository.js';
import { CreateOrganizationUseCase } from '../../apps/api/src/platform/organizations/application/create-organization.use-case.js';
import { DrizzleOrganizationRepository } from '../../apps/api/src/platform/organizations/infrastructure/repositories/drizzle-organization.repository.js';
import { DrizzleRoleRepository } from '../../apps/api/src/platform/roles/infrastructure/repositories/drizzle-role.repository.js';

const APP_ROLE = 'modubiz_app';
const APP_PASSWORD = 'modubiz_app_password';

let container: StartedTestContainer;
let db: PostgresJsDatabase;
let ownerSql: postgres.Sql;
let appClient: postgres.Sql;
let ownerUserId: string;

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

  // Create the non-owner app role that RLS applies to (mirrors docker init.sql).
  await ownerSql.unsafe(`
    CREATE ROLE ${APP_ROLE} LOGIN PASSWORD '${APP_PASSWORD}' NOBYPASSRLS;
    GRANT USAGE ON SCHEMA public TO ${APP_ROLE};
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${APP_ROLE};
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      GRANT USAGE, SELECT ON SEQUENCES TO ${APP_ROLE};
  `);

  // Apply the real core + module migrations as the owner role.
  await applyAllMigrations(ownerConnString);

  // Tables already exist, so explicit grants are needed (default privileges
  // only cover future tables).
  await ownerSql.unsafe(`
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${APP_ROLE};
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${APP_ROLE};
  `);

  // A real user row is required (membership insert has an FK to core_users).
  ownerUserId = randomUUID();
  await ownerSql`
    INSERT INTO core_users (id, email, password_hash, name)
    VALUES (${ownerUserId}, ${'owner@example.com'}, ${'hash'}, ${'Owner'})
  `;

  // Seed the module catalog the same way the boot-time mirror does
  // (integration tests don't boot the Nest app, so no ModuleRegistry mirror).
  // crm/inventory/pos are the three registered modules (registered-modules.ts).
  await ownerSql`
    INSERT INTO core_module_catalog (key, version, name, description, icon, depends_on, table_prefix, stripe_price_key, trial_days, created_at, updated_at)
    VALUES
      ('crm', '1.0.0', 'CRM', 'Contacts, companies, deals', 'users', '{}', 'crm_', 'price_crm_monthly', 14, NOW(), NOW()),
      ('inventory', '1.0.0', 'Inventory', 'Products and stock', 'box', '{}', 'inv_', 'price_inventory_monthly', 14, NOW(), NOW()),
      ('pos', '1.0.0', 'POS', 'Point of sale', 'cart', '{inventory}', 'pos_', 'price_pos_monthly', 14, NOW(), NOW())
  `;

  appClient = postgres(appConnString);
  db = drizzle(appClient, { logger: false });
});

afterAll(async () => {
  if (ownerSql) await ownerSql.end();
  if (appClient) await appClient.end();
  if (container) await container.stop();
});

const ownerContext: TenantContextData = {
  userId: '',
  organizationId: undefined,
  roles: [],
  permissions: [],
  locale: 'en',
};

/** Create an org as the shared owner and return its id + members count. */
async function createOrg(name = 'Admin Test Org'): Promise<{ orgId: string }> {
  const orgRepo = new DrizzleOrganizationRepository(db);
  const roleRepo = new DrizzleRoleRepository(db);
  const membershipRepo = new DrizzleMembershipRepository(db);
  const txManager = new TransactionManager(db);
  const createUseCase = new CreateOrganizationUseCase(orgRepo, roleRepo, membershipRepo, txManager);

  const slug = `admin-${randomUUID().slice(0, 8)}`;
  const result = await TenantContext.run({ ...ownerContext, userId: ownerUserId }, () =>
    createUseCase.execute({
      name,
      slug,
      countryCode: 'US',
      baseCurrency: 'USD',
    }),
  );
  return { orgId: result.organization.id };
}

describe('Admin directory + overview (integration, real Postgres + RLS)', () => {
  it('PLT-3: overview aggregates per-org entitlements inside runWithOrg without a session org', async () => {
    const { orgId } = await createOrg();

    // Enable a module through the admin path — the org has no session context
    // here, so runWithOrg must bind it (PLT-3).
    const billingRepo = new DrizzleBillingRepository(db);
    const auditRepo = new DrizzlePlatformAuditRepository(db);
    const txManager = new TransactionManager(db);
    const setModule = new SetOrganizationModuleUseCase(billingRepo, new FakeStripeAdapter(), auditRepo, txManager);

    const result = await TenantContext.run({ ...ownerContext, userId: ownerUserId }, () =>
      setModule.execute({
        targetOrgId: orgId,
        moduleKey: 'crm',
        action: 'enable',
        actorUserId: ownerUserId,
        actorEmail: 'owner@example.com',
      }),
    );
    expect(result.message).toContain('crm');

    // Admin overview counts the entitlement as enabled.
    const directoryRepo = new DrizzleAdminDirectoryRepository(db);
    const overview = new AdminOverviewUseCase(directoryRepo, billingRepo, txManager);
    const stats = await TenantContext.run({ ...ownerContext, userId: ownerUserId }, () => overview.execute());

    expect(stats.organizations.total).toBeGreaterThanOrEqual(1);
    expect(stats.totalUsers).toBeGreaterThanOrEqual(1);
    expect(stats.modulesEnabledByKey.crm).toBeGreaterThanOrEqual(1);
  });

  it('PLT-3/TEN-1: the tenant-facing path still sees zero entitlements — RLS backstop holds', async () => {
    const { orgId } = await createOrg();
    const billingRepo = new DrizzleBillingRepository(db);
    const auditRepo = new DrizzlePlatformAuditRepository(db);
    const txManager = new TransactionManager(db);
    const setModule = new SetOrganizationModuleUseCase(billingRepo, new FakeStripeAdapter(), auditRepo, txManager);

    await TenantContext.run({ ...ownerContext, userId: ownerUserId }, () =>
      setModule.execute({
        targetOrgId: orgId,
        moduleKey: 'inventory',
        action: 'enable',
        actorUserId: ownerUserId,
        actorEmail: 'owner@example.com',
      }),
    );

    // A DIFFERENT org's tenant context must not see the entitlement.
    const otherOrg: TenantContextData = {
      userId: randomUUID(),
      organizationId: randomUUID(),
      roles: [],
      permissions: [],
      locale: 'en',
    };
    const rows = await TenantContext.run(otherOrg, () =>
      txManager.run((tx) => billingRepo.findEntitlementsByOrg(orgId, tx)),
    );
    expect(rows).toEqual([]);
  });

  it('PLT-6: pricing upsert joins the catalog and persists integer minor units', async () => {
    const pricingRepo = new DrizzleModulePricingRepository(db);
    const registryRepo = new DrizzleModuleRegistryRepository(db);
    const auditRepo = new DrizzlePlatformAuditRepository(db);
    const useCase = new UpdateModulePricingUseCase(pricingRepo, registryRepo, auditRepo);

    const result = await TenantContext.run({ ...ownerContext, userId: ownerUserId }, () =>
      useCase.execute({
        moduleKey: 'crm',
        priceMonthlyMinor: '2990',
        priceYearlyMinor: '29900',
        currency: 'usd',
        actorUserId: ownerUserId,
        actorEmail: 'owner@example.com',
      }),
    );
    expect(result.currency).toBe('USD');
    expect(result.priceMonthlyMinor).toBe('2990');

    const rows = await pricingRepo.listWithCatalog();
    const crm = rows.find((r) => r.moduleKey === 'crm');
    expect(crm).toBeDefined();
    expect(crm?.priceMonthlyMinor).toBe('2990');
    expect(crm?.priceYearlyMinor).toBe('29900');
    expect(crm?.name).toBe('CRM');
  });

  it('PLT-7: SaaS settings are allow-listed, typed, and audited', async () => {
    const settingsRepo = new DrizzleSaasSettingsRepository(db);
    const auditRepo = new DrizzlePlatformAuditRepository(db);
    const useCase = new UpdateSaasSettingsUseCase(settingsRepo, auditRepo);

    const result = await TenantContext.run({ ...ownerContext, userId: ownerUserId }, () =>
      useCase.execute({
        settings: { platformName: 'ModuBiz Pro', trialDurationDays: 30, allowSelfSignup: false },
        actorUserId: ownerUserId,
        actorEmail: 'owner@example.com',
      }),
    );
    expect(result.platformName).toBe('ModuBiz Pro');

    const all = await settingsRepo.getAll();
    const platformName = all.find((r) => r.key === 'platformName');
    expect(platformName?.value).toBe('ModuBiz Pro');

    // Unknown key rejected before any write.
    await expect(
      TenantContext.run({ ...ownerContext, userId: ownerUserId }, () =>
        useCase.execute({
          settings: { maliciousKey: 'x' },
          actorUserId: ownerUserId,
          actorEmail: 'owner@example.com',
        }),
      ),
    ).rejects.toMatchObject({ code: 'UNKNOWN_SAAS_SETTING', httpStatus: 400 });

    // Invalid value type rejected.
    await expect(
      TenantContext.run({ ...ownerContext, userId: ownerUserId }, () =>
        useCase.execute({
          settings: { trialDurationDays: 'thirty' as unknown as number },
          actorUserId: ownerUserId,
          actorEmail: 'owner@example.com',
        }),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', httpStatus: 400 });
  });

  it('PLT-4: every admin mutation lands in core_platform_audit_log', async () => {
    const { orgId } = await createOrg();
    const auditRepo = new DrizzlePlatformAuditRepository(db);
    const pricingRepo = new DrizzleModulePricingRepository(db);
    const registryRepo = new DrizzleModuleRegistryRepository(db);
    const billingRepo = new DrizzleBillingRepository(db);
    const txManager = new TransactionManager(db);

    await TenantContext.run({ ...ownerContext, userId: ownerUserId }, () =>
      new SetOrganizationModuleUseCase(billingRepo, new FakeStripeAdapter(), auditRepo, txManager).execute({
        targetOrgId: orgId,
        moduleKey: 'crm',
        action: 'enable',
        actorUserId: ownerUserId,
        actorEmail: 'owner@example.com',
      }),
    );
    await TenantContext.run({ ...ownerContext, userId: ownerUserId }, () =>
      new UpdateModulePricingUseCase(pricingRepo, registryRepo, auditRepo).execute({
        moduleKey: 'inventory',
        priceMonthlyMinor: '1000',
        priceYearlyMinor: '10000',
        currency: 'USD',
        actorUserId: ownerUserId,
        actorEmail: 'owner@example.com',
      }),
    );

    const actions = (await ownerSql`SELECT action FROM core_platform_audit_log ORDER BY occurred_at DESC LIMIT 5`).map(
      (r) => r.action as string,
    );
    expect(actions).toContain('module.trialing');
    expect(actions).toContain('module.pricing.updated');
    expect(actions).toContain('settings.updated');
  });

  it('PLT-3: dependency-gated disable — disabling inventory while pos depends on it is rejected', async () => {
    const { orgId } = await createOrg();
    const billingRepo = new DrizzleBillingRepository(db);
    const auditRepo = new DrizzlePlatformAuditRepository(db);
    const txManager = new TransactionManager(db);
    const setModule = new SetOrganizationModuleUseCase(billingRepo, new FakeStripeAdapter(), auditRepo, txManager);

    const enable = (moduleKey: string, skipTrial: boolean) =>
      TenantContext.run({ ...ownerContext, userId: ownerUserId }, () =>
        setModule.execute({
          targetOrgId: orgId,
          moduleKey,
          action: 'enable',
          skipTrial,
          actorUserId: ownerUserId,
          actorEmail: 'owner@example.com',
        }),
      );

    // Enable inventory, then pos (which depends on inventory).
    await enable('inventory', true);
    await enable('pos', true);

    // Disabling inventory must fail while pos is entitled (MODULE_DEPENDENCY_CONFLICT).
    await expect(
      TenantContext.run({ ...ownerContext, userId: ownerUserId }, () =>
        setModule.execute({
          targetOrgId: orgId,
          moduleKey: 'inventory',
          action: 'disable',
          actorUserId: ownerUserId,
          actorEmail: 'owner@example.com',
        }),
      ),
    ).rejects.toMatchObject({ code: 'MODULE_DEPENDENCY_CONFLICT', httpStatus: 409 });
  });

  it('PLT-3: organization detail returns members, subscription, and entitlements', async () => {
    const { orgId } = await createOrg();
    const directoryRepo = new DrizzleAdminDirectoryRepository(db);
    const membershipRepo = new DrizzleMembershipRepository(db);
    const billingRepo = new DrizzleBillingRepository(db);
    const registryRepo = new DrizzleModuleRegistryRepository(db);
    const txManager = new TransactionManager(db);

    const detail = await TenantContext.run({ ...ownerContext, userId: ownerUserId }, () =>
      new GetOrganizationDetailUseCase(directoryRepo, membershipRepo, billingRepo, registryRepo, txManager).execute({
        organizationId: orgId,
      }),
    );

    expect(detail.organization.id).toBe(orgId);
    expect(detail.organization.status).toBe('active');
    // The org owner is a member.
    expect(detail.members.length).toBeGreaterThanOrEqual(1);
    expect(detail.members[0]?.email).toBe('owner@example.com');
    // No subscription yet — the admin never enabled a module for this org.
    expect(detail.subscription).toBeNull();
    expect(detail.entitlements).toEqual([]);
  });
});

describe('PlatformAdminGuard — 403 boundary (integration, real controller metadata)', () => {
  /** A real handler carrying @RequiresPlatformAdmin() metadata (like a controller). */
  class AdminHandler {
    @RequiresPlatformAdmin()
    protected adminAction(): void {
      /* no-op */
    }

    get handler(): () => void {
      return this.adminAction;
    }
  }

  function adminCtx(user?: {
    sub?: string;
    isPlatformAdmin?: boolean;
  }): Parameters<PlatformAdminGuard['canActivate']>[0] {
    return {
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
      getHandler: () => new AdminHandler().handler,
      getClass: () => AdminHandler,
    } as unknown as Parameters<PlatformAdminGuard['canActivate']>[0];
  }

  it('PLT-2: rejects a session that is not platform-admin with 403 PLATFORM_ADMIN_REQUIRED', () => {
    const guard = new PlatformAdminGuard(new Reflector());

    const ctx = adminCtx({ sub: 'user-1', isPlatformAdmin: false });
    let thrown: unknown;
    try {
      guard.canActivate(ctx);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(ForbiddenException);
    expect((thrown as ForbiddenException).message).toBe('PLATFORM_ADMIN_REQUIRED');
  });

  it('PLT-2: admits a session whose token carries isPlatformAdmin = true', () => {
    const guard = new PlatformAdminGuard(new Reflector());
    const ctx = adminCtx({ sub: 'admin-1', isPlatformAdmin: true });

    expect(guard.canActivate(ctx)).toBe(true);
  });
});
