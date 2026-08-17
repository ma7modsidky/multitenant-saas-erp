import { randomUUID } from 'node:crypto';

import { runAllMigrations } from '@modubiz/db/migrate';
import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import type { StartedTestContainer } from 'testcontainers';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { EntitlementGuard } from '../../../../core/authorization/entitlement.guard.js';
import { PermissionGuard } from '../../../../core/authorization/permission.guard.js';
import { TransactionManager } from '../../../../core/database/transaction-manager.js';
import { UnitOfWork } from '../../../../core/database/unit-of-work.js';
import { InMemoryEntitlementStore } from '../../../../core/entitlements/entitlement-store.js';
import { EntitlementService } from '../../../../core/entitlements/entitlement.service.js';
import { PortRegistry } from '../../../../core/ports/port-registry.js';
import { TenantContext, type TenantContextData } from '../../../../core/tenancy/tenant-context.js';
import { withoutTenantContext } from '../../../../core/tenancy/without-tenant-context.js';
import { AccountingController } from '../../api/accounting.controller.js';
import {
  ApplyPaymentUseCase,
  EnsureDefaultChartOfAccountsUseCase,
  IssueInvoiceUseCase,
  ListInvoicesUseCase,
  ListJournalEntriesUseCase,
  PostJournalEntryUseCase,
} from '../../application/index.js';
import { DrizzleAccountingRepository } from '../../infrastructure/repositories/drizzle-accounting.repository.js';

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
let repo: DrizzleAccountingRepository;
let ensureCoa: EnsureDefaultChartOfAccountsUseCase;
let postJournalEntry: PostJournalEntryUseCase;
let issueInvoice: IssueInvoiceUseCase;
let applyPayment: ApplyPaymentUseCase;
let listJournalEntries: ListJournalEntriesUseCase;
let listInvoices: ListInvoicesUseCase;

function context(organizationId: string, userId: string): TenantContextData {
  return {
    userId,
    sessionId: undefined,
    organizationId,
    roles: ['OWNER'],
    permissions: [
      'accounting:coa:manage',
      'accounting:journal:post',
      'accounting:invoice:write',
      'accounting:payment:apply',
      'accounting:invoice:read',
      'accounting:report:view',
    ],
    locale: 'en',
  };
}

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
  repo = new DrizzleAccountingRepository(db);
  const unitOfWork = new UnitOfWork(noopEventBus);
  ensureCoa = new EnsureDefaultChartOfAccountsUseCase(repo, txManager);
  postJournalEntry = new PostJournalEntryUseCase(repo, txManager, unitOfWork);
  issueInvoice = new IssueInvoiceUseCase(repo, txManager, unitOfWork, new PortRegistry(), postJournalEntry);
  applyPayment = new ApplyPaymentUseCase(repo, txManager, unitOfWork, postJournalEntry);
  listJournalEntries = new ListJournalEntriesUseCase(repo, txManager);
  listInvoices = new ListInvoicesUseCase(repo, txManager);
}, 180_000);

beforeEach(async () =>
  ownerSql.unsafe(
    'TRUNCATE TABLE acc_accounts, acc_tax_rates, acc_journal_entries, acc_journal_lines, acc_invoices, acc_invoice_lines, acc_payments, acc_payment_allocations, acc_credit_notes, acc_credit_note_lines, acc_account_balances, acc_org_settings CASCADE',
  ),
);

afterAll(async () => {
  if (appSql) await appSql.end();
  if (ownerSql) await ownerSql.end();
  if (container) await container.stop();
});

/** Seed the COA + a posted journal entry in the given org (ACC-5 lazy ensure). */
async function seedCoa(ctx: TenantContextData): Promise<void> {
  await TenantContext.run(ctx, () => ensureCoa.execute());
}

/** Seed a balanced posted journal entry; returns the entry id. */
async function seedEntry(ctx: TenantContextData): Promise<string> {
  const arId = await resolveAccount(ctx, '1200');
  const revenueId = await resolveAccount(ctx, '4000');
  const result = await TenantContext.run(ctx, () =>
    postJournalEntry.execute({
      entryDate: '2026-08-04',
      currency: 'USD',
      sourceType: 'manual',
      lines: [
        { accountId: arId, debitAmountMinor: '1000' },
        { accountId: revenueId, creditAmountMinor: '1000' },
      ],
    }),
  );
  return result.entryId;
}

/** Seed an issued invoice; returns the invoice id. */
async function seedInvoice(ctx: TenantContextData): Promise<string> {
  const result = await TenantContext.run(ctx, () =>
    issueInvoice.execute({
      customerContactId: randomUUID(),
      customerNameSnapshot: 'Isolation Customer',
      dueDate: '2026-09-04',
      currency: 'USD',
      lines: [{ itemNameSnapshot: 'Service', unitPriceAmountMinor: '1000' }],
    }),
  );
  return result.invoiceId;
}

/** Resolve an account id by code inside a tenant-bound tx. */
async function resolveAccount(ctx: TenantContextData, code: string): Promise<string> {
  return TenantContext.run(ctx, () =>
    txManager.run(async (tx) => {
      const accounts = await repo.listAccounts(tx);
      const found = accounts.find((a) => a.code === code);
      if (!found) throw new Error(`Account ${code} not seeded`);
      return found.id;
    }),
  );
}

/** Seed org B's data directly as the owner (bypasses RLS). */
async function seedOrgB(): Promise<{ entryId: string; invoiceId: string }> {
  const accountId = randomUUID();
  const entryId = randomUUID();
  const invoiceId = randomUUID();
  await ownerSql`
    INSERT INTO acc_accounts (id, organization_id, code, name_i18n, type, is_system, is_active)
    VALUES (${accountId}, ${ORG_B_ID}, '1200', '{}'::jsonb, 'asset', true, true)
  `;
  await ownerSql`
    INSERT INTO acc_journal_entries (id, organization_id, entry_number, entry_date, description, currency, status, source_type)
    VALUES (${entryId}, ${ORG_B_ID}, 1, '2026-08-04', 'B entry', 'USD', 'posted', 'manual')
  `;
  // Both lines in ONE statement: the deferred ACC-1 trigger fires at COMMIT,
  // so the entry must be balanced by the time the statement's transaction
  // ends — a single multi-row INSERT keeps it atomic.
  await ownerSql`
    INSERT INTO acc_journal_lines (id, organization_id, entry_id, account_id, debit_amount_minor, credit_amount_minor)
    VALUES
      (${randomUUID()}, ${ORG_B_ID}, ${entryId}, ${accountId}, 1000, 0),
      (${randomUUID()}, ${ORG_B_ID}, ${entryId}, ${accountId}, 0, 1000)
  `;
  await ownerSql`
    INSERT INTO acc_invoices (id, organization_id, invoice_number, customer_name_snapshot, status,
      invoice_date, due_date, currency, subtotal_amount_minor, discount_amount_minor, tax_amount_minor,
      total_amount_minor, paid_amount_minor, credited_amount_minor)
    VALUES (${invoiceId}, ${ORG_B_ID}, 'INV-B-1', 'Org B Customer', 'issued',
      '2026-08-04', '2026-09-04', 'USD', 1000, 0, 0, 1000, 0, 0)
  `;
  return { entryId, invoiceId };
}

describe('accounting tenant isolation', () => {
  it('TEN-1: org A cannot read an org B journal entry', async () => {
    const { entryId } = await seedOrgB();
    const result = await TenantContext.run(orgAContext, () =>
      txManager.run((tx) => repo.findJournalEntryById(entryId, tx)),
    );
    expect(result).toBeUndefined();
  });

  it('TEN-1: org A cannot read an org B invoice', async () => {
    const { invoiceId } = await seedOrgB();
    const result = await TenantContext.run(orgAContext, () =>
      txManager.run((tx) => repo.findInvoiceById(invoiceId, tx)),
    );
    expect(result).toBeUndefined();
  });

  it('TEN-1: org A account list excludes org B accounts', async () => {
    await seedOrgB();
    const accounts = await TenantContext.run(orgAContext, () => txManager.run((tx) => repo.listAccounts(tx)));
    expect(accounts).toHaveLength(0);
  });

  it('TEN-1: org A journal list excludes org B entries', async () => {
    await seedOrgB();
    const page = await TenantContext.run(orgAContext, () => listJournalEntries.execute());
    expect(page.items).toHaveLength(0);
    expect(page.total).toBe(0);
  });

  it('TEN-1: org A invoice list excludes org B invoices', async () => {
    await seedOrgB();
    const page = await TenantContext.run(orgAContext, () => listInvoices.execute());
    expect(page.items).toHaveLength(0);
    expect(page.total).toBe(0);
  });

  it('TEN-1: org A cannot apply a payment to an org B invoice (ACCOUNTING_INVOICE_NOT_FOUND)', async () => {
    const { invoiceId } = await seedOrgB();
    await expect(
      TenantContext.run(orgAContext, () =>
        applyPayment.execute({
          invoiceId,
          method: 'cash',
          amountMinor: '100',
          currency: 'USD',
        }),
      ),
    ).rejects.toMatchObject({ message: 'ACCOUNTING_INVOICE_NOT_FOUND' });
  });

  it('TEN-1: org A journal posting never touches org B rows (cross-org update blocked)', async () => {
    const { entryId } = await seedOrgB();
    await TenantContext.run(orgAContext, () => seedCoa(orgAContext));
    // Org A posts its own entry — org B's entry stays untouched (its status
    // and reversal pointer are invisible to org A's RLS).
    const aEntryId = await TenantContext.run(orgAContext, () =>
      txManager.run(async (tx) => {
        const arId = await resolveAccount(orgAContext, '1200');
        const revenueId = await resolveAccount(orgAContext, '4000');
        const result = await postJournalEntry.execute({
          entryDate: '2026-08-04',
          currency: 'USD',
          sourceType: 'manual',
          lines: [
            { accountId: arId, debitAmountMinor: '100' },
            { accountId: revenueId, creditAmountMinor: '100' },
          ],
        });
        void tx;
        return result.entryId;
      }),
    );
    expect(aEntryId).toBeTruthy();

    const bRows = await ownerSql`SELECT status FROM acc_journal_entries WHERE id = ${entryId}`;
    expect(bRows[0]?.status).toBe('posted'); // untouched by org A
  });

  it('TEN-2: an injected organizationId cannot override the session organization', async () => {
    await TenantContext.run(orgAContext, () => seedCoa(orgAContext));
    const input = {
      customerContactId: randomUUID(),
      customerNameSnapshot: 'Injected Customer',
      dueDate: '2026-09-04',
      currency: 'USD',
      lines: [{ itemNameSnapshot: 'Service', unitPriceAmountMinor: '1000' }],
      // Passed as an extra field so TS excess-property checks do not apply —
      // the use case ignores it; RLS + TenantContext decide the real org (TEN-2).
      organizationId: ORG_B_ID,
    };
    const result = await TenantContext.run(orgAContext, () => issueInvoice.execute(input));
    const rows = await ownerSql`SELECT organization_id FROM acc_invoices WHERE id = ${result.invoiceId}`;
    expect(rows[0]?.organization_id).toBe(ORG_A_ID);
  });

  it('TEN-3: no tenant context exposes zero accounting rows', async () => {
    await seedOrgB();
    // NO TenantContext: RLS is unset, so every read fails closed.
    await withoutTenantContext(async () => {
      const accounts = await repo.listAccounts();
      expect(accounts).toHaveLength(0);
      const rows = await db.execute(sql`SELECT id FROM acc_journal_entries`);
      expect(rows).toHaveLength(0);
      const invoices = await db.execute(sql`SELECT id FROM acc_invoices`);
      expect(invoices).toHaveLength(0);
    });
  });

  it('AUTHZ-6: an OWNER receives MODULE_NOT_ENTITLED when accounting is disabled', async () => {
    const store = new InMemoryEntitlementStore();
    await store.upsert({
      organizationId: ORG_A_ID,
      moduleKey: 'accounting',
      state: 'disabled',
      trialStartedAt: null,
      trialEndsAt: null,
      activatedAt: null,
      disabledAt: '2026-01-01T00:00:00Z',
      purgeAfter: null,
      features: [],
    });
    const guard = new EntitlementGuard(new Reflector(), new EntitlementService(store));
    await expect(guard.canActivate(guardContext(['accounting:coa:manage']))).rejects.toThrow('MODULE_NOT_ENTITLED');
  });

  it('AUTHZ-5: an entitled user without accounting:coa:manage is denied', () => {
    const guard = new PermissionGuard(new Reflector());
    // `listCoaRoute` requires accounting:coa:manage; the user holds only a
    // DIFFERENT accounting permission, so the guard must deny (AUTHZ-5).
    expect(() => guard.canActivate(guardContext(['accounting:report:view']))).toThrow(ForbiddenException);
  });

  it('ACC-16: the advanced_coa feature is enforced server-side from the entitlement', async () => {
    const store = new InMemoryEntitlementStore();
    await store.upsert({
      organizationId: ORG_A_ID,
      moduleKey: 'accounting',
      state: 'active',
      trialStartedAt: null,
      trialEndsAt: null,
      activatedAt: '2026-01-01T00:00:00Z',
      disabledAt: null,
      purgeAfter: null,
      // The plan's feature set — advanced_coa simply absent.
      features: ['e_invoicing'],
    });
    const service = new EntitlementService(store);
    await expect(service.isFeatureEnabled(ORG_A_ID, 'accounting', 'advanced_coa')).resolves.toBe(false);
    await expect(service.isFeatureEnabled(ORG_A_ID, 'accounting', 'e_invoicing')).resolves.toBe(true);
  });
});

/**
 * Guard execution context for the AUTHZ-5/6 checks — `getHandler` points at a
 * REAL controller route method (`listCoaRoute`) so the PermissionGuard reads
 * `@RequiresPermission` metadata off it.
 */
function guardContext(permissions: string[]): Parameters<EntitlementGuard['canActivate']>[0] {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user: { sub: USER_A_ID, organizationId: ORG_A_ID, roles: ['OWNER'], permissions } }),
    }),
    getHandler: () => AccountingController.prototype.listCoaRoute,
    getClass: () => AccountingController,
  } as never;
}
