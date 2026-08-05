import { randomUUID } from 'node:crypto';

import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runAllMigrations } from '@modubiz/db/migrate';

import { EntitlementGuard } from '../../../../core/authorization/entitlement.guard.js';
import { PermissionGuard } from '../../../../core/authorization/permission.guard.js';
import { TransactionManager } from '../../../../core/database/transaction-manager.js';
import { UnitOfWork } from '../../../../core/database/unit-of-work.js';
import { EntitlementService } from '../../../../core/entitlements/entitlement.service.js';
import { InMemoryEntitlementStore } from '../../../../core/entitlements/entitlement-store.js';
import { TenantContext, type TenantContextData } from '../../../../core/tenancy/tenant-context.js';
import { withoutTenantContext } from '../../../../core/tenancy/without-tenant-context.js';
import { ContactsController } from '../../api/contacts.controller.js';
import { CreateContactUseCase } from '../../application/create-contact.use-case.js';
import { ListContactsUseCase } from '../../application/crm-queries.use-cases.js';
import { UpdateContactUseCase } from '../../application/update-contact.use-case.js';
import { DrizzleContactRepository } from '../../infrastructure/repositories/drizzle-contact.repository.js';
import { DrizzleCrmReadRepository } from '../../infrastructure/repositories/drizzle-crm-read.repository.js';

const APP_ROLE = 'modubiz_app';
const APP_PASSWORD = 'modubiz_app_password';
const ORG_A_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ORG_B_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const USER_A_ID = '11111111-1111-1111-1111-111111111111';
const USER_B_ID = '22222222-2222-2222-2222-222222222222';

const orgAContext = context(ORG_A_ID, USER_A_ID);
const orgBContext = context(ORG_B_ID, USER_B_ID);
const noopEventBus = { publish: async () => {}, publishAll: async () => {}, on: () => {}, off: () => {} };

let container: StartedTestContainer;
let ownerSql: postgres.Sql;
let appSql: postgres.Sql;
let db: PostgresJsDatabase;
let txManager: TransactionManager;
let contactRepo: DrizzleContactRepository;
let createContact: CreateContactUseCase;
let updateContact: UpdateContactUseCase;
let listContacts: ListContactsUseCase;

function context(organizationId: string, userId: string): TenantContextData {
  return {
    userId,
    sessionId: undefined,
    organizationId,
    roles: ['OWNER'],
    permissions: ['crm:contact:read', 'crm:contact:write'],
    locale: 'en',
  };
}

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
  const ownerUrl = `postgres://modubiz_owner:modubiz_owner_password@${host}:${port}/modubiz_test`;
  const appUrl = `postgres://${APP_ROLE}:${APP_PASSWORD}@${host}:${port}/modubiz_test`;
  ownerSql = postgres(ownerUrl, { max: 1 });
  await ownerSql.unsafe(
    `CREATE ROLE ${APP_ROLE} LOGIN PASSWORD '${APP_PASSWORD}' NOBYPASSRLS; GRANT USAGE ON SCHEMA public TO ${APP_ROLE}; ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${APP_ROLE}; ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${APP_ROLE};`,
  );
  await runAllMigrations(ownerUrl);
  await ownerSql.unsafe(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${APP_ROLE}; GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${APP_ROLE};`,
  );
  appSql = postgres(appUrl);
  db = drizzle(appSql, { logger: false });
  txManager = new TransactionManager(db);
  contactRepo = new DrizzleContactRepository(db);
  const unitOfWork = new UnitOfWork(noopEventBus);
  createContact = new CreateContactUseCase(contactRepo, txManager, unitOfWork);
  updateContact = new UpdateContactUseCase(contactRepo, txManager, unitOfWork);
  listContacts = new ListContactsUseCase(new DrizzleCrmReadRepository(db), txManager);
}, 180_000);

beforeEach(async () => ownerSql.unsafe('TRUNCATE TABLE crm_contacts CASCADE'));

afterAll(async () => {
  if (appSql) await appSql.end();
  if (ownerSql) await ownerSql.end();
  if (container) await container.stop();
});

async function seedContact(ctx: TenantContextData, email = `${randomUUID()}@example.com`) {
  const result = await TenantContext.run(ctx, () =>
    createContact.execute({ firstName: 'Isolation', lastName: 'Contact', email, phone: null }),
  );
  return result.contact;
}

describe('crm tenant isolation', () => {
  it('TEN-1: org A cannot read an org B contact', async () => {
    const contact = await seedContact(orgBContext);
    const result = await TenantContext.run(orgAContext, () =>
      txManager.run((tx) => contactRepo.findById(contact.id, tx)),
    );
    expect(result).toBeUndefined();
  });

  it('TEN-1: org A cannot update an org B contact', async () => {
    const contact = await seedContact(orgBContext);
    await expect(
      TenantContext.run(orgAContext, () => updateContact.execute({ contactId: contact.id, firstName: 'Compromised' })),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const rows = await ownerSql`SELECT first_name FROM crm_contacts WHERE id = ${contact.id}`;
    expect(rows[0]?.first_name).toBe('Isolation');
  });

  it('TEN-1: org A cannot soft-delete an org B contact', async () => {
    const contact = await seedContact(orgBContext);
    await TenantContext.run(orgAContext, () => txManager.run((tx) => contactRepo.softDelete(contact.id, tx)));
    const rows = await ownerSql`SELECT deleted_at FROM crm_contacts WHERE id = ${contact.id}`;
    expect(rows[0]?.deleted_at).toBeNull();
  });

  it('TEN-1: org A list excludes org B contacts', async () => {
    const contact = await seedContact(orgBContext);
    const page = await TenantContext.run(orgAContext, () => listContacts.execute());
    expect(page.items.some((item) => item.id === contact.id)).toBe(false);
  });

  it('TEN-2: an injected organizationId cannot override the session organization', async () => {
    const input = {
      firstName: 'Injected',
      lastName: 'Tenant',
      email: 'injected@example.com',
      phone: null,
      organizationId: ORG_B_ID,
    };
    const result = await TenantContext.run(orgAContext, () => createContact.execute(input));
    const rows = await ownerSql`SELECT organization_id FROM crm_contacts WHERE id = ${result.contact.id}`;
    expect(rows[0]?.organization_id).toBe(ORG_A_ID);
  });

  it('TEN-3: no tenant context exposes zero CRM rows', async () => {
    const contact = await seedContact(orgBContext);
    await withoutTenantContext(async () => {
      expect(await contactRepo.findById(contact.id)).toBeUndefined();
      const rows = await db.execute(sql`SELECT id FROM crm_contacts WHERE id = ${contact.id}`);
      expect(rows).toHaveLength(0);
    });
  });

  it('AUTHZ-6: an OWNER receives MODULE_NOT_ENTITLED when CRM is disabled', async () => {
    const store = new InMemoryEntitlementStore();
    await store.upsert({
      organizationId: ORG_A_ID,
      moduleKey: 'crm',
      state: 'disabled',
      trialStartedAt: null,
      trialEndsAt: null,
      activatedAt: null,
      disabledAt: '2026-01-01T00:00:00Z',
      purgeAfter: null,
    });
    const guard = new EntitlementGuard(new Reflector(), new EntitlementService(store));
    await expect(guard.canActivate(guardContext(['crm:contact:read']))).rejects.toThrow('MODULE_NOT_ENTITLED');
  });

  it('AUTHZ-5: an entitled user without crm:contact:read is denied', () => {
    const guard = new PermissionGuard(new Reflector());
    expect(() => guard.canActivate(guardContext(['crm:contact:write']))).toThrow(ForbiddenException);
  });
});

function guardContext(permissions: string[]): Parameters<EntitlementGuard['canActivate']>[0] {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user: { sub: USER_A_ID, organizationId: ORG_A_ID, roles: ['OWNER'], permissions } }),
    }),
    getHandler: () => ContactsController.prototype.list,
    getClass: () => ContactsController,
  } as never;
}
