/**
 * Organization lifecycle integration tests — real Postgres, RLS active.
 *
 * Regression coverage for the raw `sql`` date-binding crash:
 * drizzle's postgres-js driver overrides postgres.js date serializers with
 * identity functions, so raw `Date` params must be converted to ISO strings
 * (`toDbDate`) before binding, and timestamptz reads normalized back
 * (`fromDbDate`). Unit tests mock the repositories, so this path can only be
 * exercised against a real database.
 *
 * Covers:
 *   - AUTH-10: creating user becomes OWNER via role + active membership
 *   - CreateOrganizationUseCase persists org + default settings atomically
 *   - Read-side timestamps come back as real `Date` instances
 *   - GDPR-2: delete schedules a 30-day grace period (pending_deletion),
 *     repeat delete is rejected, cancel restores active, suspended orgs
 *     cannot be deleted
 *   - AUTHZ-5/TEN-2: org profile PATCH is OWNER/ADMIN-only (PermissionGuard)
 *     and every :id route is bound to the session org (assertSessionOrg) —
 *     a viewer cannot rename the org, and a mismatched :id fails closed 404
 *
 * @see AGENTS.md §9 — Definition of done (integration tests)
 */
import 'reflect-metadata'; // Nest decorators (@Controller, @RequiresPermission) need the Reflect polyfill
import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import { type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { randomUUID } from 'node:crypto';

import { PermissionGuard } from '../../apps/api/src/core/authorization/permission.guard.js';
import { TransactionManager } from '../../apps/api/src/core/database/transaction-manager.js';
import { TenantContext, type TenantContextData } from '../../apps/api/src/core/tenancy/tenant-context.js';
import { applyAllMigrations } from './helpers/migrations.js';
import { OrganizationsController } from '../../apps/api/src/platform/organizations/api/organizations.controller.js';
import { CreateOrganizationUseCase } from '../../apps/api/src/platform/organizations/application/create-organization.use-case.js';
import {
  CancelDeletionUseCase,
  DeleteOrganizationUseCase,
} from '../../apps/api/src/platform/organizations/application/delete-organization.use-case.js';
import { GetOrganizationUseCase } from '../../apps/api/src/platform/organizations/application/get-organization.use-case.js';
import { UpdateOrganizationUseCase } from '../../apps/api/src/platform/organizations/application/update-organization.use-case.js';
import { UpdateOrganizationSettingsUseCase } from '../../apps/api/src/platform/organizations/application/update-organization-settings.use-case.js';
import { DrizzleOrganizationRepository } from '../../apps/api/src/platform/organizations/infrastructure/repositories/drizzle-organization.repository.js';
import { DrizzleRoleRepository } from '../../apps/api/src/platform/roles/infrastructure/repositories/drizzle-role.repository.js';
import { DrizzleMembershipRepository } from '../../apps/api/src/platform/memberships/infrastructure/repositories/drizzle-membership.repository.js';

const APP_ROLE = 'modubiz_app';
const APP_PASSWORD = 'modubiz_app_password';

let container: StartedTestContainer;
let db: PostgresJsDatabase;
let ownerSql: postgres.Sql;
let appClient: postgres.Sql;
let ownerUserId: string;

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

describe('CreateOrganizationUseCase (integration)', () => {
  it('AUTH-10: creates org, default settings, OWNER role, and active membership', async () => {
    const orgRepo = new DrizzleOrganizationRepository(db);
    const roleRepo = new DrizzleRoleRepository(db);
    const membershipRepo = new DrizzleMembershipRepository(db);
    const txManager = new TransactionManager(db);
    const useCase = new CreateOrganizationUseCase(orgRepo, roleRepo, membershipRepo, txManager);

    const slug = `acme-${randomUUID().slice(0, 8)}`;

    const result = await TenantContext.run({ ...ownerContext, userId: ownerUserId }, () =>
      useCase.execute({
        name: 'Acme Inc',
        slug,
        countryCode: 'US',
        timezone: 'UTC',
        baseCurrency: 'USD',
        defaultLocale: 'en',
      }),
    );

    const orgId = result.organization.id;

    // Read back as the owner role (bypasses RLS) to assert persisted state.
    const [orgRow] = await ownerSql`
      SELECT id, name, slug, base_currency FROM core_organizations WHERE id = ${orgId}
    `;
    expect(orgRow).toBeDefined();
    expect(orgRow?.name).toBe('Acme Inc');

    const [settingsRow] = await ownerSql`
      SELECT id FROM core_organization_settings WHERE organization_id = ${orgId}
    `;
    expect(settingsRow).toBeDefined();

    // The full system-role matrix is seeded (AUTH-10 + migration 0010):
    // owner, admin, manager, member, viewer — all flagged is_system.
    const roleRows = await ownerSql`
      SELECT key, is_system FROM core_roles WHERE organization_id = ${orgId} ORDER BY key
    `;
    expect(roleRows.map((r) => r.key as string)).toEqual(['admin', 'manager', 'member', 'owner', 'viewer']);
    for (const r of roleRows) expect(r.is_system).toBe(true);

    const [membershipRow] = await ownerSql`
      SELECT user_id, status FROM core_memberships WHERE organization_id = ${orgId}
    `;
    expect(membershipRow?.user_id).toBe(ownerUserId);
    expect(membershipRow?.status).toBe('active');
  });

  it('AUTH-10: read-side timestamps are real Date instances (toDbDate/fromDbDate)', async () => {
    const orgRepo = new DrizzleOrganizationRepository(db);
    const roleRepo = new DrizzleRoleRepository(db);
    const membershipRepo = new DrizzleMembershipRepository(db);
    const txManager = new TransactionManager(db);
    const useCase = new CreateOrganizationUseCase(orgRepo, roleRepo, membershipRepo, txManager);

    const slug = `dates-${randomUUID().slice(0, 8)}`;

    const result = await TenantContext.run({ ...ownerContext, userId: ownerUserId }, () =>
      useCase.execute({
        name: 'Dates Org',
        slug,
        countryCode: 'US',
        baseCurrency: 'USD',
      }),
    );

    const org = result.organization;
    expect(org.createdAt).toBeInstanceOf(Date);
    expect(org.updatedAt).toBeInstanceOf(Date);
    expect(org.deletionScheduledAt).toBeNull();

    // The persisted row round-trips through fromDbDate to a real Date.
    const fetched = await orgRepo.findById(org.id);
    expect(fetched?.createdAt).toBeInstanceOf(Date);
    expect(fetched?.updatedAt).toBeInstanceOf(Date);
  });

  it('rejects a duplicate slug with a conflict (no partial writes)', async () => {
    const orgRepo = new DrizzleOrganizationRepository(db);
    const roleRepo = new DrizzleRoleRepository(db);
    const membershipRepo = new DrizzleMembershipRepository(db);
    const txManager = new TransactionManager(db);
    const useCase = new CreateOrganizationUseCase(orgRepo, roleRepo, membershipRepo, txManager);

    const slug = `dup-${randomUUID().slice(0, 8)}`;

    await TenantContext.run({ ...ownerContext, userId: ownerUserId }, () =>
      useCase.execute({ name: 'First', slug, countryCode: 'US', baseCurrency: 'USD' }),
    );

    await expect(
      TenantContext.run({ ...ownerContext, userId: ownerUserId }, () =>
        useCase.execute({ name: 'Second', slug, countryCode: 'US', baseCurrency: 'USD' }),
      ),
    ).rejects.toThrow('Slug is already taken');

    // Only one org and one owner role/membership exist for that slug.
    const [orgRows] = await ownerSql`
      SELECT COUNT(*)::int AS count FROM core_organizations WHERE slug = ${slug}
    `;
    expect(orgRows?.count).toBe(1);
  });

  it('fails closed without a tenant context', async () => {
    const orgRepo = new DrizzleOrganizationRepository(db);
    const roleRepo = new DrizzleRoleRepository(db);
    const membershipRepo = new DrizzleMembershipRepository(db);
    const txManager = new TransactionManager(db);
    const useCase = new CreateOrganizationUseCase(orgRepo, roleRepo, membershipRepo, txManager);

    await expect(
      useCase.execute({
        name: 'No Ctx',
        slug: `nctx-${randomUUID().slice(0, 8)}`,
        countryCode: 'US',
        baseCurrency: 'USD',
      }),
    ).rejects.toThrow(/requires an authenticated tenant context/i);
  });

  it('TEN-4: switch-org reads the new membership when the token context has no org (no RLS uuid-cast crash)', async () => {
    const orgRepo = new DrizzleOrganizationRepository(db);
    const roleRepo = new DrizzleRoleRepository(db);
    const membershipRepo = new DrizzleMembershipRepository(db);
    const txManager = new TransactionManager(db);
    const useCase = new CreateOrganizationUseCase(orgRepo, roleRepo, membershipRepo, txManager);

    const slug = `switch-${randomUUID().slice(0, 8)}`;

    const result = await TenantContext.run({ ...ownerContext, userId: ownerUserId }, () =>
      useCase.execute({
        name: 'Switch Org',
        slug,
        countryCode: 'US',
        baseCurrency: 'USD',
      }),
    );
    const orgId = result.organization.id;

    // Regression for the create-org → switch-org browser flow: the freshly
    // signed-up user's token carries NO organizationId, so the switch-org
    // transaction runs with `app.current_organization_id` unset. TransactionManager
    // must leave it unset (NULL) — an empty-string binding would crash the RLS
    // policy cast `current_setting(...)::uuid` with `invalid input syntax for
    // type uuid: ""` and return a 500 after the org was already created.
    const membership = await TenantContext.run({ ...ownerContext, userId: ownerUserId }, () =>
      txManager.run((tx) => membershipRepo.findByUserAndOrg(ownerUserId, orgId, tx)),
    );

    expect(membership).toBeDefined();
    expect(membership?.organizationId).toBe(orgId);
    expect(membership?.status).toBe('active');
  });

  it("TEN-1/TEN-3: another tenant context sees zero rows for the new org's settings", async () => {
    const orgRepo = new DrizzleOrganizationRepository(db);
    const roleRepo = new DrizzleRoleRepository(db);
    const membershipRepo = new DrizzleMembershipRepository(db);
    const txManager = new TransactionManager(db);
    const useCase = new CreateOrganizationUseCase(orgRepo, roleRepo, membershipRepo, txManager);

    const slug = `ten-${randomUUID().slice(0, 8)}`;

    const result = await TenantContext.run({ ...ownerContext, userId: ownerUserId }, () =>
      useCase.execute({
        name: 'Tenant Org',
        slug,
        countryCode: 'US',
        baseCurrency: 'USD',
      }),
    );
    const orgId = result.organization.id;

    // Positive control: the settings row exists (visible to the owner role).
    const [controlRow] = await ownerSql`
      SELECT id FROM core_organization_settings WHERE organization_id = ${orgId}
    `;
    expect(controlRow).toBeDefined();

    // From a different tenant context, RLS must hide the org's settings.
    const otherOrg: TenantContextData = {
      userId: randomUUID(),
      organizationId: randomUUID(),
      roles: [],
      permissions: [],
      locale: 'en',
    };

    await TenantContext.run(otherOrg, async () => {
      const row = await txManager.run(async (t) => {
        const [settingsRow] = await t.execute<Record<string, unknown>>(
          sql`SELECT id FROM core_organization_settings WHERE organization_id = ${orgId}`,
        );
        return settingsRow;
      });
      expect(row).toBeUndefined();
    });
  });
});

describe('DeleteOrganizationUseCase / CancelDeletionUseCase (integration)', () => {
  async function createOrg(): Promise<{
    orgRepo: DrizzleOrganizationRepository;
    txManager: TransactionManager;
    orgId: string;
  }> {
    const orgRepo = new DrizzleOrganizationRepository(db);
    const roleRepo = new DrizzleRoleRepository(db);
    const membershipRepo = new DrizzleMembershipRepository(db);
    const txManager = new TransactionManager(db);
    const createUseCase = new CreateOrganizationUseCase(orgRepo, roleRepo, membershipRepo, txManager);

    const result = await TenantContext.run({ ...ownerContext, userId: ownerUserId }, () =>
      createUseCase.execute({
        name: `Delete Org ${randomUUID().slice(0, 6)}`,
        slug: `del-${randomUUID().slice(0, 8)}`,
        countryCode: 'US',
        baseCurrency: 'USD',
      }),
    );
    return { orgRepo, txManager, orgId: result.organization.id };
  }

  it('GDPR-2: delete schedules a 30-day grace period and flips status to pending_deletion', async () => {
    const { orgRepo, txManager, orgId } = await createOrg();
    const deleteUseCase = new DeleteOrganizationUseCase(orgRepo, txManager);

    const before = Date.now();
    const result = await TenantContext.run({ ...ownerContext, userId: ownerUserId }, () =>
      deleteUseCase.execute({ organizationId: orgId }),
    );
    const after = Date.now();

    expect(result.deletionScheduledAt).toBeInstanceOf(Date);
    expect(result.deletionScheduledAt!.getTime()).toBeGreaterThanOrEqual(before + 29 * 24 * 60 * 60 * 1000);
    expect(result.deletionScheduledAt!.getTime()).toBeLessThanOrEqual(after + 31 * 24 * 60 * 60 * 1000);

    // Persisted state reflects the grace period.
    const [orgRow] = await ownerSql`
      SELECT status, deletion_scheduled_at FROM core_organizations WHERE id = ${orgId}
    `;
    expect(orgRow?.status).toBe('pending_deletion');
    expect(orgRow?.deletion_scheduled_at).not.toBeNull();
  });

  it('GDPR-2: repeat delete throws ORG_ALREADY_PENDING_DELETION (idempotent guard)', async () => {
    const { orgRepo, txManager, orgId } = await createOrg();
    const deleteUseCase = new DeleteOrganizationUseCase(orgRepo, txManager);

    await TenantContext.run({ ...ownerContext, userId: ownerUserId }, () =>
      deleteUseCase.execute({ organizationId: orgId }),
    );

    await expect(
      TenantContext.run({ ...ownerContext, userId: ownerUserId }, () =>
        deleteUseCase.execute({ organizationId: orgId }),
      ),
    ).rejects.toMatchObject({ code: 'ORG_ALREADY_PENDING_DELETION' });
  });

  it('GDPR-2: cancel deletion restores status to active and clears the scheduled date', async () => {
    const { orgRepo, txManager, orgId } = await createOrg();
    const deleteUseCase = new DeleteOrganizationUseCase(orgRepo, txManager);
    const cancelUseCase = new CancelDeletionUseCase(orgRepo, txManager);

    await TenantContext.run({ ...ownerContext, userId: ownerUserId }, () =>
      deleteUseCase.execute({ organizationId: orgId }),
    );

    const restored = await TenantContext.run({ ...ownerContext, userId: ownerUserId }, () =>
      cancelUseCase.execute({ organizationId: orgId }),
    );

    expect(restored.status).toBe('active');
    expect(restored.deletionScheduledAt).toBeNull();

    const [orgRow] = await ownerSql`
      SELECT status, deletion_scheduled_at FROM core_organizations WHERE id = ${orgId}
    `;
    expect(orgRow?.status).toBe('active');
    expect(orgRow?.deletion_scheduled_at).toBeNull();
  });

  it('GDPR-2: cancel on an active org throws ORG_NOT_PENDING_DELETION', async () => {
    const { orgRepo, txManager, orgId } = await createOrg();
    const cancelUseCase = new CancelDeletionUseCase(orgRepo, txManager);

    await expect(
      TenantContext.run({ ...ownerContext, userId: ownerUserId }, () =>
        cancelUseCase.execute({ organizationId: orgId }),
      ),
    ).rejects.toMatchObject({ code: 'ORG_NOT_PENDING_DELETION' });
  });

  it('GDPR-2: a pending-deletion org stays visible in findOrgsByUserId (switcher regression)', async () => {
    const { orgRepo, txManager, orgId } = await createOrg();
    const membershipRepo = new DrizzleMembershipRepository(db);
    const deleteUseCase = new DeleteOrganizationUseCase(orgRepo, txManager);

    await TenantContext.run({ ...ownerContext, userId: ownerUserId }, () =>
      deleteUseCase.execute({ organizationId: orgId }),
    );

    // The switcher endpoint (GET /v1/users/me/organizations) must still list a
    // pending-deletion org so its owner can reach it and cancel the deletion.
    const orgs = await TenantContext.run({ ...ownerContext, userId: ownerUserId }, () =>
      txManager.run((tx) => membershipRepo.findOrgsByUserId(ownerUserId, tx)),
    );

    const pending = orgs.find((o) => o.organizationId === orgId);
    expect(pending).toBeDefined();
    expect(pending?.organizationStatus).toBe('pending_deletion');
  });

  it('GDPR-2: suspended orgs cannot be deleted (ORG_CANNOT_DELETE_SUSPENDED)', async () => {
    const { orgRepo, txManager, orgId } = await createOrg();
    const deleteUseCase = new DeleteOrganizationUseCase(orgRepo, txManager);

    // Force the org into suspended state (e.g. payment failure) as the owner role.
    await ownerSql`
      UPDATE core_organizations SET status = 'suspended' WHERE id = ${orgId}
    `;

    await expect(
      TenantContext.run({ ...ownerContext, userId: ownerUserId }, () =>
        deleteUseCase.execute({ organizationId: orgId }),
      ),
    ).rejects.toMatchObject({ code: 'ORG_CANNOT_DELETE_SUSPENDED' });
  });
});

describe('OrganizationsController — org profile PATCH authorization (integration, real Postgres + RLS)', () => {
  /** Create an org as the shared owner and return its id. */
  async function createOrg(name = 'Authz Org'): Promise<{ orgId: string }> {
    const orgRepo = new DrizzleOrganizationRepository(db);
    const roleRepo = new DrizzleRoleRepository(db);
    const membershipRepo = new DrizzleMembershipRepository(db);
    const txManager = new TransactionManager(db);
    const createUseCase = new CreateOrganizationUseCase(orgRepo, roleRepo, membershipRepo, txManager);

    const slug = `authz-${randomUUID().slice(0, 8)}`;
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

  /** Add a real user + active membership with a system role inside an org. */
  async function addMember(orgId: string, roleKey: string, email: string, name: string): Promise<string> {
    const [roleRow] = await ownerSql`
      SELECT id FROM core_roles WHERE organization_id = ${orgId} AND key = ${roleKey} LIMIT 1
    `;
    const userId = randomUUID();
    await ownerSql`
      INSERT INTO core_users (id, email, password_hash, name)
      VALUES (${userId}, ${email}, ${'hash'}, ${name})
    `;
    await ownerSql`
      INSERT INTO core_memberships (id, organization_id, user_id, role_id, status, joined_at, created_at, updated_at)
      VALUES (${randomUUID()}, ${orgId}, ${userId}, ${roleRow?.id as string}, 'active', NOW(), NOW(), NOW())
    `;
    return userId;
  }

  /** A real controller wired to real repositories + TransactionManager. */
  function buildController(): OrganizationsController {
    const orgRepo = new DrizzleOrganizationRepository(db);
    const roleRepo = new DrizzleRoleRepository(db);
    const membershipRepo = new DrizzleMembershipRepository(db);
    const txManager = new TransactionManager(db);
    return new OrganizationsController(
      new CreateOrganizationUseCase(orgRepo, roleRepo, membershipRepo, txManager),
      new GetOrganizationUseCase(orgRepo, txManager),
      new UpdateOrganizationUseCase(orgRepo, txManager),
      new DeleteOrganizationUseCase(orgRepo, txManager),
      new CancelDeletionUseCase(orgRepo, txManager),
      new UpdateOrganizationSettingsUseCase(orgRepo, txManager),
    );
  }

  /**
   * Build a mock ExecutionContext for the real PermissionGuard, shaped like
   * the one NestJS constructs: handler carries @RequiresPermission metadata
   * (read via Reflector), request.user carries the token claims.
   */
  function mockGuardCtx(
    controller: OrganizationsController,
    handlerName: 'update' | 'updateSettings',
    user: Record<string, unknown>,
  ): Parameters<PermissionGuard['canActivate']>[0] {
    return {
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
      getHandler: () => controller[handlerName],
      getClass: () => OrganizationsController,
    } as unknown as Parameters<PermissionGuard['canActivate']>[0];
  }

  it('AUTHZ-5: a VIEWER cannot PATCH the org profile — PermissionGuard rejects 403 and the row is unchanged', async () => {
    const { orgId } = await createOrg();
    const viewerId = await addMember(orgId, 'viewer', 'viewer-authz@example.com', 'Viewer User');
    const controller = buildController();
    const guard = new PermissionGuard(new Reflector());

    // Token claims as minted at switch-org for the viewer role (AUTHZ-5
    // snapshot): only platform:data:read — NO platform:settings:manage.
    const ctx = mockGuardCtx(controller, 'update', {
      sub: viewerId,
      organizationId: orgId,
      roles: ['viewer'],
      permissions: ['platform:data:read'],
    });

    // Regression: before the fix, PATCH /v1/organizations/:id had NO
    // @RequiresPermission — this guard passed and the viewer's rename
    // silently persisted while the /settings call 403'd (generic UI error).
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);

    // The org row in real Postgres is untouched (no partial write leaked).
    const [row] = await ownerSql`
      SELECT name FROM core_organizations WHERE id = ${orgId}
    `;
    expect(row?.name).toBe('Authz Org');
  });

  it('AUTHZ-5: an OWNER can PATCH the org profile (positive control) — the change persists', async () => {
    const { orgId } = await createOrg();
    const controller = buildController();
    const guard = new PermissionGuard(new Reflector());

    const ownerCtx = mockGuardCtx(controller, 'update', {
      sub: ownerUserId,
      organizationId: orgId,
      roles: ['owner'],
      permissions: ['platform:settings:manage'],
    });
    expect(() => guard.canActivate(ownerCtx)).not.toThrow();

    // Run the handler end-to-end: assertSessionOrg passes (session org), the
    // use case writes through the RLS-applied app role, and the name persists.
    await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      controller.update(orgId, { name: 'Acme Rebranded' } as never),
    );

    const [row] = await ownerSql`
      SELECT name FROM core_organizations WHERE id = ${orgId}
    `;
    expect(row?.name).toBe('Acme Rebranded');
  });

  it('TEN-2: PATCH with a mismatched :id fails closed with 404 ORG_NOT_FOUND and never touches the other org', async () => {
    // Session org A + a separate org B (both owned by the same user, so the
    // only reason org B is protected is the :id → session binding, not
    // membership). core_organizations is a GLOBAL non-RLS table, so without
    // assertSessionOrg the raw :id would have renamed org B.
    const { orgId: orgA } = await createOrg('Org A');
    const { orgId: orgB } = await createOrg('Org B');
    const controller = buildController();

    // From org A's session context, attempt to PATCH org B's profile.
    await expect(
      TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgA }, () =>
        controller.update(orgB, { name: 'Hacked from A' } as never),
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', message: 'ORG_NOT_FOUND' });

    // Org B's row in real Postgres is unchanged.
    const [orgBRow] = await ownerSql`
      SELECT name FROM core_organizations WHERE id = ${orgB}
    `;
    expect(orgBRow?.name).toBe('Org B');
  });
});
