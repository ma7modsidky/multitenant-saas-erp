/**
 * Audit log integration tests — real Postgres, RLS active.
 *
 * Covers:
 *   - TEN-3/RLS: QueryAuditLogUseCase reads core_audit_log inside the
 *     tenant-bound transaction (the pre-fix raw-pool read failed closed to
 *     zero rows for every org — the "empty audit log" bug)
 *   - AUTHZ-5: the audit-log controller route requires platform:audit:view
 *     (OWNER/ADMIN only) — a VIEWER's token is rejected 403 by PermissionGuard
 *   - TEN-1: a different tenant context sees zero rows
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
import { type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { randomUUID } from 'node:crypto';

import { PermissionGuard } from '../../apps/api/src/core/authorization/permission.guard.js';
import { TransactionManager } from '../../apps/api/src/core/database/transaction-manager.js';
import { TenantContext, type TenantContextData } from '../../apps/api/src/core/tenancy/tenant-context.js';
import { applyAllMigrations } from './helpers/migrations.js';
import { AuditLogController } from '../../apps/api/src/platform/audit-log/api/audit-log.controller.js';
import { QueryAuditLogUseCase } from '../../apps/api/src/platform/audit-log/application/query-audit-log.use-case.js';
import { DrizzleAuditLogRepository } from '../../apps/api/src/platform/audit-log/infrastructure/repositories/drizzle-audit-log.repository.js';
import { DrizzleOrganizationRepository } from '../../apps/api/src/platform/organizations/infrastructure/repositories/drizzle-organization.repository.js';
import { DrizzleRoleRepository } from '../../apps/api/src/platform/roles/infrastructure/repositories/drizzle-role.repository.js';
import { DrizzleMembershipRepository } from '../../apps/api/src/platform/memberships/infrastructure/repositories/drizzle-membership.repository.js';
import { CreateOrganizationUseCase } from '../../apps/api/src/platform/organizations/application/create-organization.use-case.js';

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

  await ownerSql.unsafe(`
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${APP_ROLE};
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${APP_ROLE};
  `);

  ownerUserId = randomUUID();
  await ownerSql`
    INSERT INTO core_users (id, email, password_hash, name)
    VALUES (${ownerUserId}, ${'owner@example.com'}, ${'hash'}, ${'Owner User'})
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

/** Create an org as the shared owner and return its id. */
async function createOrg(): Promise<{ orgId: string }> {
  const orgRepo = new DrizzleOrganizationRepository(db);
  const roleRepo = new DrizzleRoleRepository(db);
  const membershipRepo = new DrizzleMembershipRepository(db);
  const txManager = new TransactionManager(db);
  const createUseCase = new CreateOrganizationUseCase(orgRepo, roleRepo, membershipRepo, txManager);

  const slug = `audit-${randomUUID().slice(0, 8)}`;
  const result = await TenantContext.run({ ...ownerContext, userId: ownerUserId }, () =>
    createUseCase.execute({
      name: `Audit Org ${slug}`,
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

describe('QueryAuditLogUseCase — RLS read (integration, real Postgres)', () => {
  it('TEN-3: an OWNER reads audit rows inside the tenant transaction (pre-fix raw-pool read returned empty)', async () => {
    const { orgId } = await createOrg();
    const txManager = new TransactionManager(db);
    const useCase = new QueryAuditLogUseCase(new DrizzleAuditLogRepository(db), txManager);

    // Insert two real audit rows as the owner role (core_audit_log is
    // append-only: INSERT allowed, UPDATE/DELETE blocked by trigger 0005).
    await ownerSql`
      INSERT INTO core_audit_log (organization_id, actor_user_id, actor_type, action, entity_type, entity_id, after, occurred_at)
      VALUES
        (${orgId}, ${ownerUserId}, 'user', 'UPDATE', 'membership', 'mem-1', '{"roleId":"role-admin"}'::jsonb, NOW()),
        (${orgId}, ${ownerUserId}, 'user', 'CREATE', 'invitation', 'inv-1', '{"email":"newbie@example.com"}'::jsonb, NOW() - INTERVAL '1 hour')
    `;

    // Regression: before the fix the read ran on the RAW pool where the org
    // GUC is unset — RLS failed closed and this returned zero rows even for
    // the owner. Now it must return both entries.
    const result = await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      useCase.execute({ organizationId: orgId, pageSize: 10 }),
    );

    expect(result.total).toBe(2);
    expect(result.entries.map((e) => e.action).sort()).toEqual(['CREATE', 'UPDATE']);
    expect(result.entries[0]!.entityId).toBeTruthy();
  });

  it('TEN-1: another tenant context sees zero rows for the org', async () => {
    const { orgId } = await createOrg();
    const txManager = new TransactionManager(db);
    const useCase = new QueryAuditLogUseCase(new DrizzleAuditLogRepository(db), txManager);

    await ownerSql`
      INSERT INTO core_audit_log (organization_id, actor_user_id, actor_type, action, entity_type, entity_id, occurred_at)
      VALUES (${orgId}, ${ownerUserId}, 'user', 'UPDATE', 'organization', 'org-x', NOW())
    `;

    // From a different tenant context, RLS must hide the org's audit rows.
    const otherOrg: TenantContextData = {
      userId: randomUUID(),
      organizationId: randomUUID(),
      roles: [],
      permissions: [],
      locale: 'en',
    };

    const result = await TenantContext.run(otherOrg, () => useCase.execute({ organizationId: orgId, pageSize: 10 }));
    expect(result.total).toBe(0);
    expect(result.entries).toEqual([]);
  });
});

describe('AuditLogController — permission gating (integration, real Postgres + RLS)', () => {
  it('AUTHZ-5: a VIEWER token (platform:data:read only) is rejected 403 by PermissionGuard', async () => {
    const { orgId } = await createOrg();
    const viewerId = await addMember(orgId, 'viewer', 'viewer-audit@example.com', 'Viewer User');

    const controller = new AuditLogController(
      new QueryAuditLogUseCase(new DrizzleAuditLogRepository(db), new TransactionManager(db)),
    );
    const guard = new PermissionGuard(new Reflector());

    // Token claims as minted at switch-org for the viewer role (AUTHZ-5
    // snapshot): platform:data:read — NO platform:audit:view.
    const ctx = {
      switchToHttp: () => ({
        getRequest: () => ({
          user: { sub: viewerId, organizationId: orgId, roles: ['viewer'], permissions: ['platform:data:read'] },
        }),
      }),
      getHandler: () => controller.queryAuditLog,
      getClass: () => AuditLogController,
    } as unknown as Parameters<PermissionGuard['canActivate']>[0];

    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('AUTHZ-5: an OWNER token passes the guard and the handler returns real rows (positive control)', async () => {
    const { orgId } = await createOrg();
    const txManager = new TransactionManager(db);
    const useCase = new QueryAuditLogUseCase(new DrizzleAuditLogRepository(db), txManager);
    const controller = new AuditLogController(useCase);
    const guard = new PermissionGuard(new Reflector());

    await ownerSql`
      INSERT INTO core_audit_log (organization_id, actor_user_id, actor_type, action, entity_type, entity_id, occurred_at)
      VALUES (${orgId}, ${ownerUserId}, 'user', 'CREATE', 'organization', ${orgId}, NOW())
    `;

    const ownerCtx = {
      switchToHttp: () => ({
        getRequest: () => ({
          user: { sub: ownerUserId, organizationId: orgId, roles: ['owner'], permissions: ['platform:audit:view'] },
        }),
      }),
      getHandler: () => controller.queryAuditLog,
      getClass: () => AuditLogController,
    } as unknown as Parameters<PermissionGuard['canActivate']>[0];

    expect(() => guard.canActivate(ownerCtx)).not.toThrow();

    // Handler end-to-end: the org-bound transaction + RLS returns the row.
    const response = await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      controller.queryAuditLog(orgId, undefined, undefined, undefined, undefined, undefined, undefined, '1', '10'),
    );
    expect(response.data.total).toBe(1);
    expect(response.data.entries[0]!.action).toBe('CREATE');
  });
});
