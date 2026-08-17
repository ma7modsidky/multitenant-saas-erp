/**
 * Accounting & Invoicing integration tests — real Postgres, RLS active
 * (Phase 7).
 *
 * Exercises the accounting use cases end-to-end against the real `acc_`
 * schema with the `modubiz_app` role:
 *   - ACC-1: the DB backstop rejects an unbalanced entry even if the domain
 *     were bypassed (deferred trigger at commit).
 *   - ACC-6: issuing an invoice posts the AR entry (Dr AR / Cr Revenue /
 *     Cr VAT) atomically in the same transaction.
 *   - ACC-3: entry and invoice numbers are sequential + gap-free per org.
 *   - ACC-13: a replayed pos.sale.completed.v1 auto-invoice is idempotent —
 *     exactly one invoice per sale.
 *   - ACC-14: goods-invoice issuance deducts stock through the movement port
 *     inside the same transaction; a stock failure fails the invoice.
 *   - ACC-15: the movement GL handler posts idempotently (movement id key) and
 *     a replayed movement is a no-op.
 *   - ACC-9: partial payments; over-allocation is rejected.
 *   - ACC-10: a credit note reverses an invoice; cumulative credited amount
 *     never exceeds the net total.
 *   - TEN-1: cross-org reads fail closed (zero rows).
 *
 * @see PLAN.md §7.5 — Application layer integration tests
 * @see AGENTS.md §9 — Definition of done (integration tests)
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import type { StartedTestContainer } from 'testcontainers';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import postgres from 'postgres';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { randomUUID } from 'node:crypto';

import { TransactionManager } from '../../apps/api/src/core/database/transaction-manager.js';
import { UnitOfWork } from '../../apps/api/src/core/database/unit-of-work.js';
import { TenantContext, type TenantContextData } from '../../apps/api/src/core/tenancy/tenant-context.js';
import { EntitlementService } from '../../apps/api/src/core/entitlements/entitlement.service.js';
import type {
  EntitlementEntry,
  IEntitlementStore,
} from '../../apps/api/src/core/entitlements/entitlement-store.interface.js';
import { CreateAccountUseCase } from '../../apps/api/src/modules/accounting/application/create-account.use-case.js';
import { GetAccountDetailUseCase } from '../../apps/api/src/modules/accounting/application/get-account-detail.use-case.js';
import { UpdateAccountUseCase } from '../../apps/api/src/modules/accounting/application/update-account.use-case.js';
import { GetInvoiceDetailUseCase } from '../../apps/api/src/modules/accounting/application/get-invoice-detail.use-case.js';
import { GetJournalEntryDetailUseCase } from '../../apps/api/src/modules/accounting/application/get-journal-entry-detail.use-case.js';
import { GetTrialBalanceUseCase } from '../../apps/api/src/modules/accounting/application/get-trial-balance.use-case.js';
import { GetIncomeStatementUseCase } from '../../apps/api/src/modules/accounting/application/get-income-statement.use-case.js';
import { GetBalanceSheetUseCase } from '../../apps/api/src/modules/accounting/application/get-balance-sheet.use-case.js';
import { GetArAgingUseCase } from '../../apps/api/src/modules/accounting/application/get-ar-aging.use-case.js';
import { ListPaymentsUseCase } from '../../apps/api/src/modules/accounting/application/list-payments.use-case.js';
import { GetPaymentDetailUseCase } from '../../apps/api/src/modules/accounting/application/get-payment-detail.use-case.js';
import { GetCreditNoteDetailUseCase } from '../../apps/api/src/modules/accounting/application/get-credit-note-detail.use-case.js';
import { ListCreditNotesUseCase } from '../../apps/api/src/modules/accounting/application/list-credit-notes.use-case.js';
import { ListJournalEntriesUseCase } from '../../apps/api/src/modules/accounting/application/list-journal-entries.use-case.js';
import { ListInvoicesUseCase } from '../../apps/api/src/modules/accounting/application/list-invoices.use-case.js';
import { applyAllMigrations } from './helpers/migrations.js';
import { DrizzleOrganizationRepository } from '../../apps/api/src/platform/organizations/infrastructure/repositories/drizzle-organization.repository.js';
import { DrizzleRoleRepository } from '../../apps/api/src/platform/roles/infrastructure/repositories/drizzle-role.repository.js';
import { DrizzleMembershipRepository } from '../../apps/api/src/platform/memberships/infrastructure/repositories/drizzle-membership.repository.js';
import { CreateOrganizationUseCase } from '../../apps/api/src/platform/organizations/application/create-organization.use-case.js';
import { DrizzleAccountingRepository } from '../../apps/api/src/modules/accounting/infrastructure/repositories/drizzle-accounting.repository.js';
import { EnsureDefaultChartOfAccountsUseCase } from '../../apps/api/src/modules/accounting/application/ensure-default-coa.use-case.js';
import { PostJournalEntryUseCase } from '../../apps/api/src/modules/accounting/application/post-journal-entry.use-case.js';
import { ReverseJournalEntryUseCase } from '../../apps/api/src/modules/accounting/application/reverse-journal-entry.use-case.js';
import { IssueInvoiceUseCase } from '../../apps/api/src/modules/accounting/application/issue-invoice.use-case.js';
import { ApplyPaymentUseCase } from '../../apps/api/src/modules/accounting/application/apply-payment.use-case.js';
import { IssueCreditNoteUseCase } from '../../apps/api/src/modules/accounting/application/issue-credit-note.use-case.js';
import { GenerateInvoiceFromPosSaleUseCase } from '../../apps/api/src/modules/accounting/application/generate-invoice-from-pos-sale.use-case.js';
import { DrizzleInventoryRepository } from '../../apps/api/src/modules/inventory/infrastructure/repositories/drizzle-inventory.repository.js';
import { InventoryMovementPortImpl } from '../../apps/api/src/modules/inventory/infrastructure/ports/inventory-movement.port.impl.js';
import { CreateProductUseCase } from '../../apps/api/src/modules/inventory/application/create-product.use-case.js';
import { PortRegistry } from '../../apps/api/src/core/ports/port-registry.js';
import { INVENTORY_MOVEMENT_PORT } from '../../packages/contracts/src/ports/index.js';
import type { MovementEventCollector } from '../../packages/contracts/src/ports/index.js';

const APP_ROLE = 'modubiz_app';
const APP_PASSWORD = 'modubiz_app_password';

let container: StartedTestContainer;
let db: PostgresJsDatabase;
let ownerSql: postgres.Sql;
let ownerUserId: string;

const ownerContext: TenantContextData = {
  userId: '',
  organizationId: undefined,
  roles: [],
  permissions: [],
  locale: 'en',
};

/** Recording collector — stands in for a caller's UnitOfWork (ACC-15). */
const collectedEvents: Array<{ name: string; payload: Record<string, unknown>; aggregateId: string }> = [];
const collector: MovementEventCollector = {
  addEvent: (event) => {
    collectedEvents.push(event);
  },
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

  // Core + module migrations (includes accounting 0001–0004).
  await applyAllMigrations(ownerConnString);

  await ownerSql.unsafe(`
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${APP_ROLE};
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${APP_ROLE};
  `);

  ownerUserId = randomUUID();
  await ownerSql`
    INSERT INTO core_users (id, email, password_hash, name)
    VALUES (${ownerUserId}, ${'acc-owner@example.com'}, ${'hash'}, ${'Acc Owner'})
  `;

  db = drizzle(postgres(appConnString), { logger: false });
});

afterAll(async () => {
  if (ownerSql) await ownerSql.end();
  if (container) await container.stop();
});

/** Create an org as the owner (mirrors the other suites). */
async function createOrgForOwner(): Promise<{ orgId: string }> {
  const orgRepo = new DrizzleOrganizationRepository(db);
  const roleRepo = new DrizzleRoleRepository(db);
  const membershipRepo = new DrizzleMembershipRepository(db);
  const txManager = new TransactionManager(db);
  const createUseCase = new CreateOrganizationUseCase(orgRepo, roleRepo, membershipRepo, txManager);

  const slug = `acc-${randomUUID().slice(0, 8)}`;
  const result = await TenantContext.run({ ...ownerContext, userId: ownerUserId }, () =>
    createUseCase.execute({
      name: `Acc Org ${slug}`,
      slug,
      countryCode: 'US',
      baseCurrency: 'USD',
    }),
  );
  return { orgId: result.organization.id };
}

/**
 * ACC-16: in-memory entitlement store stub — the CreateAccountUseCase gates on
 * the advanced_coa feature (server-side, fail closed).
 */
class StubEntitlementStore implements IEntitlementStore {
  private readonly store = new Map<string, EntitlementEntry>();

  private key(organizationId: string, moduleKey: string): string {
    return `${organizationId}:${moduleKey}`;
  }

  async findByOrgAndModule(organizationId: string, moduleKey: string): Promise<EntitlementEntry | undefined> {
    return this.store.get(this.key(organizationId, moduleKey));
  }

  async findByOrg(organizationId: string): Promise<EntitlementEntry[]> {
    return [...this.store.values()].filter((e) => e.organizationId === organizationId);
  }

  async upsert(entry: EntitlementEntry): Promise<void> {
    this.store.set(this.key(entry.organizationId, entry.moduleKey), { ...entry });
  }

  async updateState(organizationId: string, moduleKey: string, state: EntitlementEntry['state']): Promise<void> {
    const existing = this.store.get(this.key(organizationId, moduleKey));
    if (existing) existing.state = state;
  }
}

/** CreateAccountUseCase with a stub store carrying the org's feature set. */
function buildCreateAccount(orgId: string, features: string[]): CreateAccountUseCase {
  const store = new StubEntitlementStore();
  const entitlement: EntitlementEntry = {
    moduleKey: 'accounting',
    organizationId: orgId,
    state: 'active',
    trialStartedAt: null,
    trialEndsAt: null,
    activatedAt: null,
    disabledAt: null,
    purgeAfter: null,
    features,
  };
  void store.upsert(entitlement);
  return new CreateAccountUseCase(
    new DrizzleAccountingRepository(db),
    new TransactionManager(db),
    new EntitlementService(store),
  );
}

/** Fresh accounting harness per test (each owns its TransactionManager). */
function buildAccounting() {
  const repo = new DrizzleAccountingRepository(db);
  const txManager = new TransactionManager(db);
  const recordingEventBus = {
    publish: async () => {},
    publishAll: async () => {},
    on: () => {},
    off: () => {},
  } as never;
  const unitOfWork = new UnitOfWork(recordingEventBus);
  const ensureCoa = new EnsureDefaultChartOfAccountsUseCase(repo, txManager);
  const postJournalEntry = new PostJournalEntryUseCase(repo, txManager, unitOfWork);
  const reverseJournalEntry = new ReverseJournalEntryUseCase(repo, txManager, unitOfWork);
  const issueInvoice = new IssueInvoiceUseCase(repo, txManager, unitOfWork, new PortRegistry(), postJournalEntry);
  const applyPayment = new ApplyPaymentUseCase(repo, txManager, unitOfWork, postJournalEntry);
  const issueCreditNote = new IssueCreditNoteUseCase(repo, txManager, unitOfWork, postJournalEntry);
  const generateFromPosSale = new GenerateInvoiceFromPosSaleUseCase(repo, txManager, unitOfWork, issueInvoice);
  return {
    repo,
    txManager,
    unitOfWork,
    ensureCoa,
    postJournalEntry,
    reverseJournalEntry,
    issueInvoice,
    applyPayment,
    issueCreditNote,
    generateFromPosSale,
  };
}

/** Build an inventory harness to seed products + run the movement port. */
function buildInventory() {
  const repo = new DrizzleInventoryRepository(db);
  const txManager = new TransactionManager(db);
  const movementPort = new InventoryMovementPortImpl(repo, txManager);
  const recordingEventBus = {
    publish: async () => {},
    publishAll: async () => {},
    on: () => {},
    off: () => {},
  } as never;
  const createProduct = new CreateProductUseCase(repo, txManager, new UnitOfWork(recordingEventBus));
  return { repo, txManager, movementPort, createProduct };
}

/** Run a callback in tenant context inside one TransactionManager transaction. */
function runInTx<T>(txManager: TransactionManager, orgId: string, fn: (tx: unknown) => Promise<T>): Promise<T> {
  return TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () => txManager.run(fn));
}

/** Ensure the default SME chart is seeded (ACC-5 lazy ensure). */
async function seedCoa(h: ReturnType<typeof buildAccounting>, orgId: string): Promise<void> {
  await runInTx(h.txManager, orgId, () => h.ensureCoa.execute());
}

/** Resolve an account id by code (must run inside a tenant-bound tx). */
async function accountIdByCode(h: ReturnType<typeof buildAccounting>, orgId: string, code: string): Promise<string> {
  return runInTx(h.txManager, orgId, async (tx) => {
    const accounts = await h.repo.listAccounts(tx);
    const found = accounts.find((a) => a.code === code);
    if (!found) throw new Error(`Account ${code} not seeded`);
    return found.id;
  });
}

/** Create a product + variant; returns both ids (inventory seeding). */
async function createProduct(
  orgId: string,
  opts: { name: string; sku: string; costMinor?: string } = { name: 'Goods', sku: 'GOODS-1' },
): Promise<{ productId: string; variantId: string }> {
  const inv = buildInventory();
  const { productId, variantId } = await TenantContext.run(
    { ...ownerContext, userId: ownerUserId, organizationId: orgId },
    () =>
      inv.createProduct.execute({
        nameI18n: { en: opts.name },
        sku: opts.sku,
        priceAmountMinor: '1000',
        priceCurrency: 'USD',
        costAmountMinor: opts.costMinor ?? '400',
        costCurrency: 'USD',
        reorderPoint: '5',
        reorderQuantity: '20',
      }),
  );
  return { productId, variantId };
}

/** Receipt stock via the movement port (joins the caller's tx). */
async function receiveStock(orgId: string, variantId: string, quantity: string, unitCostMinor: string): Promise<void> {
  const inv = buildInventory();
  await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
    inv.txManager.run(async (tx) => {
      await inv.movementPort.receive(
        {
          lines: [{ variantId, quantity, unitCostAmountMinor: unitCostMinor, unitCostCurrency: 'USD' }],
          referenceType: 'purchase_receipt',
          referenceId: randomUUID(),
        },
        inv.txManager.ref(tx),
        collector,
      );
    }),
  );
}

describe('accounting module (Phase 7, integration)', () => {
  it('ACC-5: the default SME chart seeds lazily and idempotently', async () => {
    const { orgId } = await createOrgForOwner();
    const h = buildAccounting();

    // First ensure seeds all 11 default accounts.
    const chart = await runInTx(h.txManager, orgId, () => h.ensureCoa.execute());
    expect(chart.length).toBeGreaterThanOrEqual(11);
    const codes = chart.map((a) => a.code);
    expect(codes).toContain('1200'); // AR
    expect(codes).toContain('4000'); // Revenue
    expect(codes).toContain('2100'); // VAT Payable
    expect(codes).toContain('1300'); // Inventory
    expect(codes).toContain('5000'); // COGS

    // ACC-5: idempotent — a second ensure never duplicates.
    const again = await runInTx(h.txManager, orgId, () => h.ensureCoa.execute());
    expect(again.length).toBe(chart.length);
  });

  it('ACC-1: an unbalanced entry is rejected by the domain AND the DB backstop', async () => {
    const { orgId } = await createOrgForOwner();
    const h = buildAccounting();
    await seedCoa(h, orgId);
    const arId = await accountIdByCode(h, orgId, '1200');
    const revenueId = await accountIdByCode(h, orgId, '4000');

    // Domain rejects before persistence.
    await expect(
      runInTx(h.txManager, orgId, () =>
        h.postJournalEntry.execute({
          entryDate: '2026-08-04',
          currency: 'USD',
          sourceType: 'manual',
          lines: [
            { accountId: arId, debitAmountMinor: '1000' },
            { accountId: revenueId, creditAmountMinor: '900' },
          ],
        }),
      ),
    ).rejects.toMatchObject({ code: 'ACCOUNTING_ENTRY_UNBALANCED' });

    // DB backstop: even a direct unbalanced insert fails at commit (ACC-1).
    await expect(
      runInTx(h.txManager, orgId, async (tx) => {
        const entryId = randomUUID();
        await tx.execute(sql`
          INSERT INTO acc_journal_entries
             (id, organization_id, entry_number, entry_date, description, currency, status, source_type, created_at, updated_at)
           VALUES (${entryId}, ${orgId}, 999, '2026-08-04', 'stray', 'USD', 'posted', 'manual', NOW(), NOW())
        `);
        await tx.execute(sql`
          INSERT INTO acc_journal_lines
             (id, organization_id, entry_id, account_id, debit_amount_minor, credit_amount_minor, created_at)
           VALUES
             (${randomUUID()}, ${orgId}, ${entryId}, ${arId}, 1000, 0, NOW()),
             (${randomUUID()}, ${orgId}, ${entryId}, ${revenueId}, 0, 900, NOW())
        `);
      }),
    ).rejects.toThrow(/unbalanced/i);
  });

  it('ACC-3: journal entry numbers are sequential and gap-free per org', async () => {
    const { orgId } = await createOrgForOwner();
    const h = buildAccounting();
    await seedCoa(h, orgId);
    const arId = await accountIdByCode(h, orgId, '1200');
    const revenueId = await accountIdByCode(h, orgId, '4000');

    const numbers: number[] = [];
    for (let i = 0; i < 3; i++) {
      const result = await runInTx(h.txManager, orgId, () =>
        h.postJournalEntry.execute({
          entryDate: '2026-08-04',
          currency: 'USD',
          sourceType: 'manual',
          lines: [
            { accountId: arId, debitAmountMinor: '100' },
            { accountId: revenueId, creditAmountMinor: '100' },
          ],
        }),
      );
      numbers.push(result.entryNumber);
    }
    expect(numbers).toEqual([1, 2, 3]);

    // A failed post must not consume a number (ACC-3) — the allocation rolls
    // back with the tx.
    await expect(
      runInTx(h.txManager, orgId, () =>
        h.postJournalEntry.execute({
          entryDate: '2026-08-04',
          currency: 'USD',
          sourceType: 'manual',
          lines: [
            { accountId: arId, debitAmountMinor: '10' },
            { accountId: revenueId, creditAmountMinor: '5' },
          ],
        }),
      ),
    ).rejects.toMatchObject({ code: 'ACCOUNTING_ENTRY_UNBALANCED' });

    const next = await runInTx(h.txManager, orgId, () =>
      h.postJournalEntry.execute({
        entryDate: '2026-08-04',
        currency: 'USD',
        sourceType: 'manual',
        lines: [
          { accountId: arId, debitAmountMinor: '100' },
          { accountId: revenueId, creditAmountMinor: '100' },
        ],
      }),
    );
    expect(next.entryNumber).toBe(4);
  });

  it('ACC-6: issuing an invoice posts the AR entry atomically (Dr AR / Cr Revenue / Cr VAT)', async () => {
    const { orgId } = await createOrgForOwner();
    const h = buildAccounting();
    await seedCoa(h, orgId);
    const arId = await accountIdByCode(h, orgId, '1200');
    const revenueId = await accountIdByCode(h, orgId, '4000');
    const vatId = await accountIdByCode(h, orgId, '2100');

    const result = await runInTx(h.txManager, orgId, () =>
      h.issueInvoice.execute({
        customerContactId: randomUUID(),
        customerNameSnapshot: 'Test Customer',
        dueDate: '2026-09-04',
        currency: 'USD',
        lines: [
          {
            itemNameSnapshot: 'Consulting',
            unitPriceAmountMinor: '10000',
            taxRateBpSnapshot: 1500, // 15% VAT → 1500 minor tax
          },
        ],
      }),
    );
    expect(result.invoiceNumber).toMatch(/^INV-\d{6}$/);

    // The invoice exists and is issued.
    const invoice = await runInTx(h.txManager, orgId, (tx) => h.repo.findInvoiceByNumber(result.invoiceNumber, tx));
    expect(invoice?.status).toBe('issued');
    expect(invoice?.totalAmountMinor).toBe('11500');

    // ACC-6: exactly one journal entry with the AR/Revenue/VAT lines, balanced.
    const entry = await runInTx(h.txManager, orgId, (tx) =>
      h.repo.findJournalEntryBySource('invoice_issuance', invoice!.id, tx),
    );
    expect(entry).toBeTruthy();
    expect(entry!.status).toBe('posted');
    const arLine = entry!.lines.find((l) => l.accountId === arId);
    const revenueLine = entry!.lines.find((l) => l.accountId === revenueId);
    const vatLine = entry!.lines.find((l) => l.accountId === vatId);
    expect(arLine?.debitAmountMinor).toBe('11500');
    expect(revenueLine?.creditAmountMinor).toBe('10000');
    expect(vatLine?.creditAmountMinor).toBe('1500');
  });

  it('ACC-9: partial payments are allowed; over-allocation is rejected', async () => {
    const { orgId } = await createOrgForOwner();
    const h = buildAccounting();
    await seedCoa(h, orgId);
    const invoiceId = randomUUID();

    const result = await runInTx(h.txManager, orgId, () =>
      h.issueInvoice.execute({
        customerContactId: randomUUID(),
        customerNameSnapshot: 'Partial Customer',
        dueDate: '2026-09-04',
        currency: 'USD',
        lines: [{ itemNameSnapshot: 'Service', unitPriceAmountMinor: '10000' }],
      }),
    );
    const issued = await runInTx(h.txManager, orgId, (tx) => h.repo.findInvoiceByNumber(result.invoiceNumber, tx));

    // Partial: 4000 of 10000.
    const payment = await runInTx(h.txManager, orgId, () =>
      h.applyPayment.execute({
        invoiceId: issued!.id,
        method: 'bank_transfer',
        amountMinor: '4000',
        currency: 'USD',
      }),
    );
    expect(payment.paymentId).toBeTruthy();
    const afterPartial = await runInTx(h.txManager, orgId, (tx) => h.repo.findInvoiceById(issued!.id, tx));
    expect(afterPartial?.status).toBe('partially_paid');
    expect(afterPartial?.paidAmountMinor).toBe('4000');

    // Over-allocation (7000 more > 10000 total) is rejected.
    await expect(
      runInTx(h.txManager, orgId, () =>
        h.applyPayment.execute({
          invoiceId: issued!.id,
          method: 'bank_transfer',
          amountMinor: '7000',
          currency: 'USD',
        }),
      ),
    ).rejects.toMatchObject({ code: 'ACCOUNTING_PAYMENT_OVER_ALLOCATED' });

    // The remaining 6000 flips the invoice to Paid (ACC-9).
    await runInTx(h.txManager, orgId, () =>
      h.applyPayment.execute({
        invoiceId: issued!.id,
        method: 'cash',
        amountMinor: '6000',
        currency: 'USD',
      }),
    );
    const paid = await runInTx(h.txManager, orgId, (tx) => h.repo.findInvoiceById(issued!.id, tx));
    expect(paid?.status).toBe('paid');
    expect(paid?.paidAmountMinor).toBe('10000');
    void invoiceId;
  });

  it('ACC-9: each payment allocates a receipt number and posts its receipt entry (Dr Bank/Cash, Cr AR)', async () => {
    const { orgId } = await createOrgForOwner();
    const h = buildAccounting();
    await seedCoa(h, orgId);

    const result = await runInTx(h.txManager, orgId, () =>
      h.issueInvoice.execute({
        customerContactId: randomUUID(),
        customerNameSnapshot: 'Receipt Customer',
        dueDate: '2026-09-04',
        currency: 'USD',
        lines: [{ itemNameSnapshot: 'Service', unitPriceAmountMinor: '10000' }],
      }),
    );
    const issued = await runInTx(h.txManager, orgId, (tx) => h.repo.findInvoiceByNumber(result.invoiceNumber, tx));

    // Cash receipt — Dr Cash (1000), Cr AR (1200).
    const payment = await runInTx(h.txManager, orgId, () =>
      h.applyPayment.execute({
        invoiceId: issued!.id,
        method: 'cash',
        amountMinor: '4000',
        currency: 'USD',
      }),
    );
    expect(payment.receiptNumber).toMatch(/^REC-\d{6}$/);

    const entry = await runInTx(h.txManager, orgId, (tx) =>
      h.repo.findJournalEntryBySource('payment', payment.paymentId, tx),
    );
    expect(entry?.status).toBe('posted');
    expect(entry?.description).toContain(payment.receiptNumber);
    const linesByAccount = new Map(entry!.lines.map((line) => [line.accountId, line] as const));
    const cashAccountId = (await runInTx(h.txManager, orgId, (tx) => h.repo.listAccounts(tx))).find(
      (account) => account.code === '1000',
    )!.id;
    const arAccountId = (await runInTx(h.txManager, orgId, (tx) => h.repo.listAccounts(tx))).find(
      (account) => account.code === '1200',
    )!.id;
    expect(linesByAccount.get(cashAccountId)?.debitAmountMinor).toBe('4000');
    expect(linesByAccount.get(arAccountId)?.creditAmountMinor).toBe('4000');

    // The payment detail exposes the receipt number + the GL entry link.
    const detail = await runInTx(h.txManager, orgId, () =>
      new GetPaymentDetailUseCase(h.repo, h.txManager).execute({ paymentId: payment.paymentId }),
    );
    expect(detail.payment.receiptNumber).toBe(payment.receiptNumber);
    expect(detail.journalEntry).toEqual({ id: entry!.id, entryNumber: entry!.entryNumber });

    // Gap-free: the next receipt number follows immediately.
    const second = await runInTx(h.txManager, orgId, () =>
      h.applyPayment.execute({
        invoiceId: issued!.id,
        method: 'bank_transfer',
        amountMinor: '6000',
        currency: 'USD',
      }),
    );
    expect(second.receiptNumber).toBe(`REC-${String(Number(payment.receiptNumber.slice(4)) + 1).padStart(6, '0')}`);
  });

  it('ACC-9: the payments list free-text search matches the customer or the invoice number', async () => {
    const { orgId } = await createOrgForOwner();
    const h = buildAccounting();
    await seedCoa(h, orgId);

    const issue = async (customer: string) => {
      const result = await runInTx(h.txManager, orgId, () =>
        h.issueInvoice.execute({
          customerContactId: randomUUID(),
          customerNameSnapshot: customer,
          dueDate: '2026-09-04',
          currency: 'USD',
          lines: [{ itemNameSnapshot: 'Service', unitPriceAmountMinor: '10000' }],
        }),
      );
      const invoice = await runInTx(h.txManager, orgId, (tx) => h.repo.findInvoiceByNumber(result.invoiceNumber, tx));
      await runInTx(h.txManager, orgId, () =>
        h.applyPayment.execute({
          invoiceId: invoice!.id,
          method: 'cash',
          amountMinor: '10000',
          currency: 'USD',
        }),
      );
      return invoice!;
    };
    const [alpha, beta] = await Promise.all([issue('Alpha Traders'), issue('Beta Works')]);

    const byCustomer = await runInTx(h.txManager, orgId, (tx) =>
      h.repo.listPayments({ q: 'alpha', page: 1, pageSize: 20 }, tx),
    );
    expect(byCustomer.total).toBe(1);
    expect(byCustomer.items[0]?.customerNameSnapshot).toBe('Alpha Traders');

    const byNumber = await runInTx(h.txManager, orgId, (tx) =>
      h.repo.listPayments({ q: beta.invoiceNumber.slice(-4), page: 1, pageSize: 20 }, tx),
    );
    expect(byNumber.total).toBe(1);
    expect(byNumber.items[0]?.invoiceNumber).toBe(beta.invoiceNumber);

    const noMatch = await runInTx(h.txManager, orgId, (tx) =>
      h.repo.listPayments({ q: 'no-such-customer', page: 1, pageSize: 20 }, tx),
    );
    expect(noMatch.total).toBe(0);
  });

  it('ACC-10: a credit note reverses an invoice; cumulative notes never exceed the net total', async () => {
    const { orgId } = await createOrgForOwner();
    const h = buildAccounting();
    await seedCoa(h, orgId);

    const result = await runInTx(h.txManager, orgId, () =>
      h.issueInvoice.execute({
        customerContactId: randomUUID(),
        customerNameSnapshot: 'CN Customer',
        dueDate: '2026-09-04',
        currency: 'USD',
        lines: [{ itemNameSnapshot: 'Service', unitPriceAmountMinor: '10000' }],
      }),
    );
    const issued = await runInTx(h.txManager, orgId, (tx) => h.repo.findInvoiceByNumber(result.invoiceNumber, tx));
    const invoiceLineId = issued!.lines[0]!.id;

    // A credit note for 3000.
    const cn = await runInTx(h.txManager, orgId, () =>
      h.issueCreditNote.execute({
        invoiceId: issued!.id,
        reasonCode: 'PARTIAL_REFUND',
        lines: [{ invoiceLineId, unitPriceAmountMinor: '3000' }],
      }),
    );
    expect(cn.creditNoteNumber).toMatch(/^CN-\d{6}$/);

    const credited = await runInTx(h.txManager, orgId, (tx) => h.repo.findInvoiceById(issued!.id, tx));
    expect(credited?.creditedAmountMinor).toBe('3000');

    // A second note pushing cumulative over the total (8000 more) is rejected.
    await expect(
      runInTx(h.txManager, orgId, () =>
        h.issueCreditNote.execute({
          invoiceId: issued!.id,
          reasonCode: 'PARTIAL_REFUND',
          lines: [{ invoiceLineId, unitPriceAmountMinor: '8000' }],
        }),
      ),
    ).rejects.toMatchObject({ code: 'ACCOUNTING_CREDIT_NOTE_EXCEEDS_INVOICE' });

    // The reversal journal entry was posted (Dr Revenue / Cr AR).
    const note = await runInTx(h.txManager, orgId, (tx) => h.repo.findCreditNoteById(cn.creditNoteId, tx));
    const reversal = await runInTx(h.txManager, orgId, (tx) =>
      h.repo.findJournalEntryBySource('credit_note', cn.creditNoteId, tx),
    );
    expect(note?.status).toBe('issued');
    expect(reversal?.status).toBe('posted');
    expect(reversal?.lines.find((l) => l.debitAmountMinor !== '0')?.debitAmountMinor).toBe('3000');
  });

  it('ACC-10: credit-note detail returns the reversed lines, the referenced invoice, and the reversal entry', async () => {
    const { orgId } = await createOrgForOwner();
    const h = buildAccounting();
    await seedCoa(h, orgId);

    const result = await runInTx(h.txManager, orgId, () =>
      h.issueInvoice.execute({
        customerContactId: randomUUID(),
        customerNameSnapshot: 'CN Detail Customer',
        dueDate: '2026-09-04',
        currency: 'USD',
        lines: [
          { itemNameSnapshot: 'Consulting', unitPriceAmountMinor: '8000' },
          { itemNameSnapshot: 'Setup', unitPriceAmountMinor: '2000' },
        ],
      }),
    );
    const issued = await runInTx(h.txManager, orgId, (tx) => h.repo.findInvoiceByNumber(result.invoiceNumber, tx));
    // Resolve the Consulting line by name — invoice line order is insertion-ordered
    // by id, not by item, so index 0 is not deterministic.
    const consultingLine = issued!.lines.find((line) => line.itemNameSnapshot === 'Consulting')!;
    const cn = await runInTx(h.txManager, orgId, () =>
      h.issueCreditNote.execute({
        invoiceId: issued!.id,
        reasonCode: 'CUSTOMER_RETURN',
        lines: [{ invoiceLineId: consultingLine.id, unitPriceAmountMinor: '3000' }],
      }),
    );

    const detail = await runInTx(h.txManager, orgId, () =>
      new GetCreditNoteDetailUseCase(h.repo, h.txManager).execute({ creditNoteId: cn.creditNoteId }),
    );
    expect(detail.creditNote.creditNoteNumber).toBe(cn.creditNoteNumber);
    expect(detail.creditNote.invoiceId).toBe(issued!.id);
    expect(detail.creditNote.invoiceNumber).toBe(issued!.invoiceNumber);
    expect(detail.creditNote.customerNameSnapshot).toBe('CN Detail Customer');
    expect(detail.creditNote.reasonCode).toBe('CUSTOMER_RETURN');
    expect(detail.creditNote.lines).toHaveLength(1);
    expect(detail.creditNote.lines[0]?.itemNameSnapshot).toBe('Consulting');
    expect(detail.creditNote.lines[0]?.lineTotalAmountMinor).toBe('3000');
    // The reversal entry (source_type 'credit_note') is exposed for the GL link.
    expect(detail.journalEntry).toEqual({ id: expect.any(String), entryNumber: expect.any(Number) });

    // The list exposes the same note with its customer snapshot + search.
    const list = await runInTx(h.txManager, orgId, (tx) => h.repo.listCreditNotes({ page: 1, pageSize: 20 }, tx));
    expect(list.total).toBe(1);
    expect(list.items[0]?.id).toBe(cn.creditNoteId);
    expect(list.items[0]?.customerNameSnapshot).toBe('CN Detail Customer');
    const bySearch = await runInTx(h.txManager, orgId, (tx) =>
      h.repo.listCreditNotes({ q: 'cn detail', page: 1, pageSize: 20 }, tx),
    );
    expect(bySearch.total).toBe(1);

    // Unknown credit note → 404.
    await expect(
      runInTx(h.txManager, orgId, () =>
        new GetCreditNoteDetailUseCase(h.repo, h.txManager).execute({ creditNoteId: randomUUID() }),
      ),
    ).rejects.toThrow('Credit note not found');
  });

  it('ACC-9: the payments list returns every receipt with its invoice, newest first', async () => {
    const { orgId } = await createOrgForOwner();
    const h = buildAccounting();
    await seedCoa(h, orgId);

    const issue = async (customer: string) => {
      const result = await runInTx(h.txManager, orgId, () =>
        h.issueInvoice.execute({
          customerContactId: randomUUID(),
          customerNameSnapshot: customer,
          dueDate: '2026-09-04',
          currency: 'USD',
          lines: [{ itemNameSnapshot: 'Service', unitPriceAmountMinor: '10000' }],
        }),
      );
      return runInTx(h.txManager, orgId, (tx) => h.repo.findInvoiceByNumber(result.invoiceNumber, tx));
    };

    const [first, second] = await Promise.all([issue('First Customer'), issue('Second Customer')]);
    await runInTx(h.txManager, orgId, () =>
      h.applyPayment.execute({ invoiceId: first!.id, method: 'cash', amountMinor: '4000', currency: 'USD' }),
    );
    await runInTx(h.txManager, orgId, () =>
      h.applyPayment.execute({ invoiceId: second!.id, method: 'bank_transfer', amountMinor: '10000', currency: 'USD' }),
    );

    const listPayments = new ListPaymentsUseCase(h.repo, h.txManager);
    const page = await runInTx(h.txManager, orgId, () => listPayments.execute({}));

    expect(page.total).toBe(2);
    // Newest first — the second payment (later received_at) leads.
    expect(page.items[0]!.customerNameSnapshot).toBe('Second Customer');
    expect(page.items[0]!.method).toBe('bank_transfer');
    expect(page.items[0]!.amountMinor).toBe('10000');
    expect(page.items[0]!.allocationAmountMinor).toBe('10000');
    expect(page.items[0]!.invoiceNumber).toBe(second!.invoiceNumber);
    expect(page.items[1]!.customerNameSnapshot).toBe('First Customer');
    expect(page.items[1]!.allocationAmountMinor).toBe('4000');

    // Method filter narrows the list.
    const cashOnly = await runInTx(h.txManager, orgId, () => listPayments.execute({ method: 'cash' }));
    expect(cashOnly.total).toBe(1);
    expect(cashOnly.items[0]!.customerNameSnapshot).toBe('First Customer');
  });

  it('ACC-9: payment detail returns the receipt with its allocation breakdown', async () => {
    const { orgId } = await createOrgForOwner();
    const h = buildAccounting();
    await seedCoa(h, orgId);

    const issue = async (customer: string) => {
      const result = await runInTx(h.txManager, orgId, () =>
        h.issueInvoice.execute({
          customerContactId: randomUUID(),
          customerNameSnapshot: customer,
          dueDate: '2026-09-04',
          currency: 'USD',
          lines: [{ itemNameSnapshot: 'Service', unitPriceAmountMinor: '10000' }],
        }),
      );
      return runInTx(h.txManager, orgId, (tx) => h.repo.findInvoiceByNumber(result.invoiceNumber, tx));
    };

    const [first, second] = await Promise.all([issue('First Customer'), issue('Second Customer')]);

    // One cash receipt split across the two invoices (partial payments).
    const paymentId = randomUUID();
    await runInTx(h.txManager, orgId, (tx) =>
      h.repo.insertPayment(
        {
          id: paymentId,
          organizationId: orgId,
          method: 'cash',
          receiptNumber: 'REC-000001',
          amountMinor: '6000',
          currency: 'USD',
          receivedAt: new Date('2026-08-06T08:00:00.000Z'),
          reference: 'TXN-SPLIT',
          idempotencyKey: null,
        },
        tx,
      ),
    );
    await runInTx(h.txManager, orgId, (tx) =>
      h.repo.insertPaymentAllocation(
        {
          id: randomUUID(),
          organizationId: orgId,
          paymentId,
          invoiceId: first!.id,
          amountMinor: '4000',
          currency: 'USD',
        },
        tx,
      ),
    );
    await runInTx(h.txManager, orgId, (tx) =>
      h.repo.insertPaymentAllocation(
        {
          id: randomUUID(),
          organizationId: orgId,
          paymentId,
          invoiceId: second!.id,
          amountMinor: '2000',
          currency: 'USD',
        },
        tx,
      ),
    );

    const getPaymentDetail = new GetPaymentDetailUseCase(h.repo, h.txManager);
    const detail = await runInTx(h.txManager, orgId, () => getPaymentDetail.execute({ paymentId }));

    expect(detail.payment.id).toBe(paymentId);
    expect(detail.payment.method).toBe('cash');
    expect(detail.payment.amountMinor).toBe('6000');
    expect(detail.payment.currency).toBe('USD');
    expect(detail.payment.reference).toBe('TXN-SPLIT');
    expect(detail.payment.receivedAt).toContain('2026-08-06');
    expect(detail.allocations).toHaveLength(2);

    const byInvoice = new Map(detail.allocations.map((allocation) => [allocation.invoiceNumber, allocation]));
    expect(byInvoice.get(first!.invoiceNumber)?.amountMinor).toBe('4000');
    expect(byInvoice.get(second!.invoiceNumber)?.amountMinor).toBe('2000');
    expect(byInvoice.get(first!.invoiceNumber)?.customerNameSnapshot).toBe('First Customer');
    expect(byInvoice.get(first!.invoiceNumber)?.invoiceStatus).toBe('issued');
    expect(byInvoice.get(first!.invoiceNumber)?.invoiceId).toBe(first!.id);

    // Unknown receipt → 404.
    await expect(
      runInTx(h.txManager, orgId, () => getPaymentDetail.execute({ paymentId: randomUUID() })),
    ).rejects.toThrow('Payment not found');
  });

  it('ACC-13: a replayed pos.sale.completed.v1 creates exactly one invoice', async () => {
    const { orgId } = await createOrgForOwner();
    const h = buildAccounting();
    await seedCoa(h, orgId);

    const saleId = randomUUID();
    const payload = {
      organizationId: orgId,
      saleId,
      shiftId: randomUUID(),
      registerId: randomUUID(),
      receiptNumber: 'R-000123',
      subtotalAmountMinor: '10000',
      discountAmountMinor: '0',
      taxAmountMinor: '1500',
      totalAmountMinor: '11500',
      currency: 'USD',
      lineCount: 1,
      customerContactId: randomUUID(),
      locale: 'en',
      soldAt: '2026-08-04T10:00:00.000Z',
      occurredAt: '2026-08-04T10:00:00.000Z',
    };

    // Replay the event twice — exactly one invoice must exist (ACC-13).
    const first = await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      h.generateFromPosSale.execute(payload as never),
    );
    const second = await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      h.generateFromPosSale.execute(payload as never),
    );

    expect(first).toBeTruthy();
    expect(second?.invoiceId).toBe(first?.invoiceId);

    const bySource = await runInTx(h.txManager, orgId, (tx) => h.repo.findInvoiceBySource('pos_sale', saleId, tx));
    expect(bySource).toBeTruthy();
    expect(bySource!.totalAmountMinor).toBe('11500');
    expect(bySource!.sourceId).toBe(saleId);
    expect(bySource!.idempotencyKey).toBe(saleId);

    // ACC-13 + POS sync: an invoice generated from a POS sale is ALREADY paid
    // (the cash was collected at the register) — it must default to Paid with
    // the full total allocated, never Issued/overdue.
    expect(bySource!.status).toBe('paid');
    expect(bySource!.paidAmountMinor).toBe('11500');
    const [alloc] = await ownerSql`
      SELECT COALESCE(SUM(amount_minor), 0)::text AS total
      FROM acc_payment_allocations WHERE invoice_id = ${bySource!.id}
    `;
    expect(alloc?.total).toBe('11500');

    const [count] = await ownerSql`
      SELECT COUNT(*)::int AS count FROM acc_invoices WHERE source_type = 'pos_sale' AND source_id = ${saleId}
    `;
    expect(count?.count).toBe(1);
  });

  it('ACC-14: goods-invoice issuance deducts stock atomically; a stock failure fails the invoice', async () => {
    const { orgId } = await createOrgForOwner();
    const h = buildAccounting();
    await seedCoa(h, orgId);
    const { variantId } = await createProduct(orgId, { name: 'Goods Line', sku: 'ACC-14-1', costMinor: '400' });
    await receiveStock(orgId, variantId, '10', '400');

    // Wire the movement port into the invoice use case (ACC-14). The port and
    // the use case MUST share ONE TransactionManager — the TransactionRef is
    // minted and resolved by the same manager instance (WeakMap-scoped), which
    // mirrors the single @Global instance at runtime.
    const h2 = buildAccounting();
    const invRepo = new DrizzleInventoryRepository(db);
    const movementPort = new InventoryMovementPortImpl(invRepo, h2.txManager);
    const portRegistry = new PortRegistry();
    portRegistry.register(INVENTORY_MOVEMENT_PORT, movementPort);
    const issueWithPort = new IssueInvoiceUseCase(
      h2.repo,
      h2.txManager,
      h2.unitOfWork,
      portRegistry,
      h2.postJournalEntry,
    );

    const customerId = randomUUID();
    const result = await runInTx(h2.txManager, orgId, () =>
      issueWithPort.execute({
        customerContactId: customerId,
        customerNameSnapshot: 'Goods Customer',
        dueDate: '2026-09-04',
        currency: 'USD',
        lines: [
          {
            variantId,
            itemNameSnapshot: 'Goods Line',
            quantity: '4',
            unitPriceAmountMinor: '1000',
            isGoods: true,
          },
        ],
      }),
    );

    // Stock went from 10 → 6 in the SAME transaction as the invoice.
    const [level] = await ownerSql`
      SELECT quantity_on_hand FROM inv_stock_levels WHERE variant_id = ${variantId}
    `;
    expect(String(level?.quantity_on_hand ?? '0').replace(/\.?0+$/, '')).toBe('6');

    // The sale movement references the invoice (ACC-15 event payload).
    const [movement] = await ownerSql`
      SELECT type, reference_type, reference_id FROM inv_stock_movements
      WHERE reference_type = 'sales_invoice' AND reference_id = ${result.invoiceId}
    `;
    expect(movement?.type).toBe('sale');

    // An over-issue (7 > 6 available) fails the whole transaction — the
    // invoice is never persisted.
    const failedCustomerId = randomUUID();
    await expect(
      runInTx(h2.txManager, orgId, () =>
        issueWithPort.execute({
          customerContactId: failedCustomerId,
          customerNameSnapshot: 'Over Customer',
          dueDate: '2026-09-04',
          currency: 'USD',
          lines: [
            {
              variantId,
              itemNameSnapshot: 'Goods Line',
              quantity: '7',
              unitPriceAmountMinor: '1000',
              isGoods: true,
            },
          ],
        }),
      ),
    ).rejects.toMatchObject({ code: 'INVENTORY_INSUFFICIENT_STOCK' });

    // The failed invoice is NOT there (atomic rollback, ACC-14); the first one
    // (customerId) is the only invoice in the org.
    const [failedCount] = await ownerSql`
      SELECT COUNT(*)::int AS count FROM acc_invoices WHERE customer_contact_id = ${failedCustomerId}
    `;
    const [firstCount] = await ownerSql`
      SELECT COUNT(*)::int AS count FROM acc_invoices WHERE customer_contact_id = ${customerId}
    `;
    expect(failedCount?.count).toBe(0);
    expect(firstCount?.count).toBe(1);

    // Stock is still 6 after the failed issuance.
    const [after] = await ownerSql`
      SELECT quantity_on_hand FROM inv_stock_levels WHERE variant_id = ${variantId}
    `;
    expect(String(after?.quantity_on_hand ?? '0').replace(/\.?0+$/, '')).toBe('6');
  });

  it('ACC-15: the movement GL handler posts idempotently keyed on the movement id', async () => {
    const { orgId } = await createOrgForOwner();
    const h = buildAccounting();
    await seedCoa(h, orgId);
    const { variantId } = await createProduct(orgId, { name: 'GL Costed', sku: 'ACC-15-1', costMinor: '400' });
    await receiveStock(orgId, variantId, '10', '400');

    // Receive again — this movement emits movement_recorded, and the GL
    // handler (simulated here with the post-entry use case + movement id key)
    // must post exactly once even when replayed.
    const inv = buildInventory();
    const movementId = randomUUID();
    const referenceId = randomUUID();

    // Insert the movement as the port would (sale, cost 400, qty 4 → COGS 1600).
    const saleRef = randomUUID();
    await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      inv.txManager.run(async (tx) => {
        await tx.execute(sql`
          INSERT INTO inv_stock_movements
             (id, organization_id, variant_id, warehouse_id, type, quantity, unit_cost_amount_minor,
              unit_cost_currency, reference_type, reference_id, reason_code, occurred_at, created_at, created_by)
           VALUES
             (${movementId}, ${orgId}, ${variantId},
              (SELECT id FROM inv_warehouses WHERE organization_id = ${orgId} AND is_default = true LIMIT 1),
              'sale', -4, 400, 'USD', 'sales_invoice', ${saleRef}, NULL, NOW(), NOW(), ${ownerUserId})
        `);
      }),
    );

    // Two replays of the movement → the GL entry posts once (ACC-15 idempotency).
    const arId = await accountIdByCode(h, orgId, '1300');
    const cogsId = await accountIdByCode(h, orgId, '5000');
    for (let i = 0; i < 2; i++) {
      await runInTx(h.txManager, orgId, () =>
        h.postJournalEntry.execute({
          entryDate: '2026-08-04',
          description: `Stock sale ${saleRef}`,
          currency: 'USD',
          sourceType: 'stock_movement',
          sourceId: movementId,
          idempotencyKey: movementId,
          lines: [
            { accountId: cogsId, debitAmountMinor: '1600' },
            { accountId: arId, creditAmountMinor: '1600' },
          ],
        }),
      );
    }

    const [count] = await ownerSql`
      SELECT COUNT(*)::int AS count FROM acc_journal_entries
      WHERE source_type = 'stock_movement' AND source_id = ${movementId}
    `;
    expect(count?.count).toBe(1);

    void referenceId;
  });

  it('ACC-15: a system-context GL write (userId "system") persists with NULL actor columns', async () => {
    // Regression: event handlers run under TenantContext with the non-UUID
    // `system` sentinel. Writing it into a uuid audit column threw
    // `invalid input syntax for type uuid`, failing the auto-invoice / GL
    // transactions (ACC-13/ACC-15). The repo must coerce it to NULL.
    const { orgId } = await createOrgForOwner();
    const h = buildAccounting();
    await seedCoa(h, orgId);
    const cashId = await accountIdByCode(h, orgId, '1000');
    const revenueId = await accountIdByCode(h, orgId, '4000');

    const result = await TenantContext.run({ ...ownerContext, userId: 'system', organizationId: orgId }, () =>
      h.postJournalEntry.execute({
        entryDate: '2026-08-04',
        description: 'System-context GL post',
        currency: 'USD',
        sourceType: 'stock_movement',
        sourceId: randomUUID(),
        lines: [
          { accountId: cashId, debitAmountMinor: '1000' },
          { accountId: revenueId, creditAmountMinor: '1000' },
        ],
      }),
    );

    expect(result.entryNumber).toBeGreaterThan(0);
    const [row] = await ownerSql`
      SELECT posted_by, created_by, updated_by
      FROM acc_journal_entries WHERE id = ${result.entryId}
    `;
    expect(row?.posted_by).toBeNull();
    expect(row?.created_by).toBeNull();
    expect(row?.updated_by).toBeNull();
  });

  it('ACC-2: a posted entry can only be reversed; the reversal is a new balanced entry', async () => {
    const { orgId } = await createOrgForOwner();
    const h = buildAccounting();
    await seedCoa(h, orgId);
    const arId = await accountIdByCode(h, orgId, '1200');
    const revenueId = await accountIdByCode(h, orgId, '4000');

    const posted = await runInTx(h.txManager, orgId, () =>
      h.postJournalEntry.execute({
        entryDate: '2026-08-04',
        currency: 'USD',
        sourceType: 'manual',
        lines: [
          { accountId: arId, debitAmountMinor: '5000' },
          { accountId: revenueId, creditAmountMinor: '5000' },
        ],
      }),
    );

    const { reversalEntryId } = await runInTx(h.txManager, orgId, () =>
      h.reverseJournalEntry.execute({ entryId: posted.entryId }),
    );

    // The original is marked reversed referencing the reversal (ACC-2).
    const original = await runInTx(h.txManager, orgId, (tx) => h.repo.findJournalEntryById(posted.entryId, tx));
    expect(original?.status).toBe('reversed');
    expect(original?.reversedByEntryId).toBe(reversalEntryId);

    // The reversal is a NEW entry with swapped sides, itself balanced.
    const reversal = await runInTx(h.txManager, orgId, (tx) => h.repo.findJournalEntryById(reversalEntryId, tx));
    expect(reversal?.status).toBe('posted');
    expect(reversal?.lines.find((l) => l.debitAmountMinor !== '0')?.accountId).toBe(revenueId);
    expect(reversal?.lines.find((l) => l.creditAmountMinor !== '0')?.accountId).toBe(arId);
  });

  it('TEN-1: cross-org reads fail closed (zero rows)', async () => {
    const { orgId: orgA } = await createOrgForOwner();
    const { orgId: orgB } = await createOrgForOwner();
    const hA = buildAccounting();
    const hB = buildAccounting();
    await seedCoa(hA, orgA);

    // Org A issues an invoice.
    const result = await runInTx(hA.txManager, orgA, () =>
      hA.issueInvoice.execute({
        customerContactId: randomUUID(),
        customerNameSnapshot: 'Isolation Customer',
        dueDate: '2026-09-04',
        currency: 'USD',
        lines: [{ itemNameSnapshot: 'Service', unitPriceAmountMinor: '1000' }],
      }),
    );

    // Org B cannot see it (RLS fail-closed).
    const hidden = await runInTx(hB.txManager, orgB, (tx) => hB.repo.findInvoiceByNumber(result.invoiceNumber, tx));
    expect(hidden).toBeUndefined();

    // Org B cannot read org A's accounts either.
    const bAccounts = await runInTx(hB.txManager, orgB, (tx) => hB.repo.listAccounts(tx));
    expect(bAccounts).toHaveLength(0);
  });

  // ─── ACC-16: custom accounts (advanced_coa plan feature) ────────────────

  it('ACC-16: creates a custom account when advanced_coa is enabled', async () => {
    const { orgId } = await createOrgForOwner();
    const h = buildAccounting();
    const createAccount = buildCreateAccount(orgId, ['advanced_coa']);
    await seedCoa(h, orgId);

    const { accountId, code } = await TenantContext.run(
      { ...ownerContext, userId: ownerUserId, organizationId: orgId },
      () => createAccount.execute({ code: '5200', name: 'Software subscriptions', type: 'expense' }),
    );

    expect(code).toBe('5200');
    const stored = await runInTx(h.txManager, orgId, (tx) => h.repo.findAccountById(accountId, tx));
    expect(stored).toBeDefined();
    expect(stored!.isSystem).toBe(false);
    expect(stored!.nameI18n.en).toBe('Software subscriptions');
  });

  it('ACC-16: rejects creating an account when advanced_coa is not entitled', async () => {
    const { orgId } = await createOrgForOwner();
    const h = buildAccounting();
    // Entitlement exists but the feature set is empty → fails closed.
    const createAccount = buildCreateAccount(orgId, []);
    await seedCoa(h, orgId);

    await expect(
      TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
        createAccount.execute({ code: '5200', name: 'Software subscriptions', type: 'expense' }),
      ),
    ).rejects.toMatchObject({ code: 'ACCOUNTING_COA_READ_ONLY' });
  });

  it('ACC-16: rejects a duplicate account code', async () => {
    const { orgId } = await createOrgForOwner();
    const h = buildAccounting();
    const createAccount = buildCreateAccount(orgId, ['advanced_coa']);
    await seedCoa(h, orgId);

    await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      createAccount.execute({ code: '5200', name: 'Software subscriptions', type: 'expense' }),
    );

    // The second account with the same code is a conflict (code unique per org).
    await expect(
      TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
        createAccount.execute({ code: '5200', name: 'Duplicate', type: 'expense' }),
      ),
    ).rejects.toMatchObject({ code: 'ACCOUNTING_ACCOUNT_CODE_EXISTS' });
  });

  // ─── Account detail / update (GL view + COA actions) ───────────────────

  it('ACC-5: account detail returns the balance and GL history with running balance', async () => {
    const { orgId } = await createOrgForOwner();
    const h = buildAccounting();
    await seedCoa(h, orgId);
    const arId = await accountIdByCode(h, orgId, '1200');
    const revenueId = await accountIdByCode(h, orgId, '4000');

    // Post two balanced entries touching AR (Dr) and Revenue (Cr).
    await runInTx(h.txManager, orgId, () =>
      h.postJournalEntry.execute({
        entryDate: '2026-08-01',
        currency: 'USD',
        sourceType: 'manual',
        description: 'First',
        lines: [
          { accountId: arId, debitAmountMinor: '1000' },
          { accountId: revenueId, creditAmountMinor: '1000' },
        ],
      }),
    );
    await runInTx(h.txManager, orgId, () =>
      h.postJournalEntry.execute({
        entryDate: '2026-08-02',
        currency: 'USD',
        sourceType: 'invoice_issuance',
        sourceId: '00000000-0000-4000-8000-0000000000aa',
        description: 'Second',
        lines: [
          { accountId: arId, debitAmountMinor: '2500' },
          { accountId: revenueId, creditAmountMinor: '2500' },
        ],
      }),
    );

    const getAccountDetail = new GetAccountDetailUseCase(h.repo, h.txManager);
    const detail = await runInTx(h.txManager, orgId, () => getAccountDetail.execute({ accountId: arId }));

    expect(detail.account.code).toBe('1200');
    expect(detail.balance.debitTotal).toBe('3500');
    expect(detail.balance.creditTotal).toBe('0');
    expect(detail.balance.netAmountMinor).toBe('3500');
    // Oldest first, running balance accumulates debit − credit.
    expect(detail.movements.total).toBe(2);
    expect(detail.movements.items).toHaveLength(2);
    expect(detail.movements.items[0]!.entryNumber).toBeLessThan(detail.movements.items[1]!.entryNumber);
    expect(detail.movements.items[0]!.runningBalanceMinor).toBe('1000');
    expect(detail.movements.items[1]!.runningBalanceMinor).toBe('3500');
    expect(detail.movements.items[0]!.description).toBe('First');
    // The GL rows carry the journal entry's source reference — movements
    // originating from an invoice expose the source id for a direct link back.
    expect(detail.movements.items[0]!.sourceType).toBe('manual');
    expect(detail.movements.items[0]!.sourceId).toBeNull();
    expect(detail.movements.items[1]!.sourceType).toBe('invoice_issuance');
    expect(detail.movements.items[1]!.sourceId).toBe('00000000-0000-4000-8000-0000000000aa');

    // Date-range filter restricts the GL to the period.
    const filtered = await runInTx(h.txManager, orgId, () =>
      getAccountDetail.execute({ accountId: arId, fromDate: '2026-08-02', toDate: '2026-08-02' }),
    );
    expect(filtered.movements.total).toBe(1);
    expect(filtered.movements.items[0]!.description).toBe('Second');
    // Running balance is computed over the WHOLE filtered set — the window
    // starts at the filtered range, so the single filtered row carries its
    // own cumulative balance (the 2026-08-01 entry is outside the range).
    expect(filtered.movements.items[0]!.runningBalanceMinor).toBe('2500');

    // Pagination slices after the cumulative window — page 2 of size 1.
    const paged = await runInTx(h.txManager, orgId, () =>
      getAccountDetail.execute({ accountId: arId, page: 2, pageSize: 1 }),
    );
    expect(paged.movements.total).toBe(2);
    expect(paged.movements.items).toHaveLength(1);
    expect(paged.movements.items[0]!.description).toBe('Second');
    expect(paged.movements.items[0]!.runningBalanceMinor).toBe('3500');
  });

  it('ACC-5/ACC-16: updates a custom account name and active flag', async () => {
    const { orgId } = await createOrgForOwner();
    const h = buildAccounting();
    const createAccount = buildCreateAccount(orgId, ['advanced_coa']);
    await seedCoa(h, orgId);

    const { accountId } = await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      createAccount.execute({ code: '5200', name: 'Software subscriptions', type: 'expense' }),
    );

    const store = new StubEntitlementStore();
    const entitlement: EntitlementEntry = {
      moduleKey: 'accounting',
      organizationId: orgId,
      state: 'active',
      trialStartedAt: null,
      trialEndsAt: null,
      activatedAt: null,
      disabledAt: null,
      purgeAfter: null,
      features: ['advanced_coa'],
    };
    void store.upsert(entitlement);
    const updateWithFeature = new UpdateAccountUseCase(h.repo, h.txManager, new EntitlementService(store));

    await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      updateWithFeature.execute({ accountId, name: 'Software & subscriptions', isActive: false }),
    );

    const stored = await runInTx(h.txManager, orgId, (tx) => h.repo.findAccountById(accountId, tx));
    expect(stored!.nameI18n.en).toBe('Software & subscriptions');
    expect(stored!.isActive).toBe(false);
  });

  it('ACC-5: a system account cannot be deactivated', async () => {
    const { orgId } = await createOrgForOwner();
    const h = buildAccounting();
    await seedCoa(h, orgId);
    const arId = await accountIdByCode(h, orgId, '1200');

    const store = new StubEntitlementStore();
    const entitlement: EntitlementEntry = {
      moduleKey: 'accounting',
      organizationId: orgId,
      state: 'active',
      trialStartedAt: null,
      trialEndsAt: null,
      activatedAt: null,
      disabledAt: null,
      purgeAfter: null,
      features: ['advanced_coa'],
    };
    void store.upsert(entitlement);
    const updateWithFeature = new UpdateAccountUseCase(h.repo, h.txManager, new EntitlementService(store));

    await expect(
      TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
        updateWithFeature.execute({ accountId: arId, isActive: false }),
      ),
    ).rejects.toMatchObject({ code: 'ACCOUNTING_SYSTEM_ACCOUNT_IMMUTABLE' });
  });

  it('ACC-9/ACC-10: invoice detail returns lines, the payment history, and the credit-note trail', async () => {
    const { orgId } = await createOrgForOwner();
    const h = buildAccounting();
    await seedCoa(h, orgId);

    const result = await runInTx(h.txManager, orgId, () =>
      h.issueInvoice.execute({
        customerContactId: randomUUID(),
        customerNameSnapshot: 'Detail Customer',
        customerTaxIdSnapshot: 'TAX-123',
        dueDate: '2026-09-04',
        currency: 'USD',
        lines: [{ itemNameSnapshot: 'Service', unitPriceAmountMinor: '10000', taxRateBpSnapshot: 1500 }],
      }),
    );
    const issued = await runInTx(h.txManager, orgId, (tx) => h.repo.findInvoiceByNumber(result.invoiceNumber, tx));
    const invoiceLineId = issued!.lines[0]!.id;

    // Apply a partial payment, then a credit note — both feed the detail view.
    await runInTx(h.txManager, orgId, () =>
      h.applyPayment.execute({
        invoiceId: issued!.id,
        method: 'bank_transfer',
        amountMinor: '4000',
        currency: 'USD',
        reference: 'TXN-REF-1',
      }),
    );
    await runInTx(h.txManager, orgId, () =>
      h.issueCreditNote.execute({
        invoiceId: issued!.id,
        reasonCode: 'PARTIAL_REFUND',
        lines: [{ invoiceLineId, unitPriceAmountMinor: '2000' }],
      }),
    );

    const getInvoiceDetail = new GetInvoiceDetailUseCase(h.repo, h.txManager);
    const detail = await runInTx(h.txManager, orgId, () => getInvoiceDetail.execute({ invoiceId: issued!.id }));

    expect(detail.invoice.invoiceNumber).toBe(result.invoiceNumber);
    expect(detail.invoice.customerNameSnapshot).toBe('Detail Customer');
    expect(detail.invoice.customerTaxIdSnapshot).toBe('TAX-123');
    expect(detail.invoice.lines).toHaveLength(1);
    expect(detail.invoice.lines[0]!.lineTotalAmountMinor).toBe('10000');
    expect(detail.invoice.lines[0]!.taxAmountMinor).toBe('1500');
    expect(detail.invoice.paidAmountMinor).toBe('4000');
    expect(detail.invoice.creditedAmountMinor).toBe('2000');
    expect(detail.payments).toHaveLength(1);
    expect(detail.payments[0]!.method).toBe('bank_transfer');
    expect(detail.payments[0]!.allocationAmountMinor).toBe('4000');
    expect(detail.payments[0]!.reference).toBe('TXN-REF-1');
    expect(detail.creditNotes).toHaveLength(1);
    expect(detail.creditNotes[0]!.creditNoteNumber).toBeDefined();
    expect(detail.creditNotes[0]!.reasonCode).toBe('PARTIAL_REFUND');
    expect(detail.creditNotes[0]!.amountMinor).toBe('2000');
  });

  it('ACC-6: invoice detail links the AR journal entry and falls back to the org seller tax id', async () => {
    const { orgId } = await createOrgForOwner();
    const h = buildAccounting();
    await seedCoa(h, orgId);

    const result = await runInTx(h.txManager, orgId, () =>
      h.issueInvoice.execute({
        customerContactId: randomUUID(),
        customerNameSnapshot: 'Tax Customer',
        dueDate: '2026-09-04',
        currency: 'USD',
        lines: [{ itemNameSnapshot: 'Service', unitPriceAmountMinor: '5000' }],
      }),
    );
    const issued = await runInTx(h.txManager, orgId, (tx) => h.repo.findInvoiceByNumber(result.invoiceNumber, tx));
    const getInvoiceDetail = new GetInvoiceDetailUseCase(h.repo, h.txManager);

    // Issuance always produces the AR entry — the detail links straight to it.
    const before = await runInTx(h.txManager, orgId, () => getInvoiceDetail.execute({ invoiceId: issued!.id }));
    expect(before.journalEntry?.id).toBeDefined();
    expect(before.journalEntry?.entryNumber).toBeGreaterThan(0);
    // No org-level setting yet → no fallback.
    expect(before.orgSellerTaxId).toBeNull();

    // Once the org sets its seller tax id, the detail falls back to it.
    await ownerSql.unsafe(
      `UPDATE core_organization_settings SET seller_tax_id = 'ORG-VAT-999' WHERE organization_id = '${orgId}'`,
    );
    const after = await runInTx(h.txManager, orgId, () => getInvoiceDetail.execute({ invoiceId: issued!.id }));
    expect(after.orgSellerTaxId).toBe('ORG-VAT-999');
  });

  it('ACC-8: the invoice list searches by invoice number or customer name', async () => {
    const { orgId } = await createOrgForOwner();
    const h = buildAccounting();
    await seedCoa(h, orgId);
    const listInvoices = new ListInvoicesUseCase(h.repo, h.txManager);

    const issue = (customer: string) =>
      runInTx(h.txManager, orgId, () =>
        h.issueInvoice.execute({
          customerContactId: randomUUID(),
          customerNameSnapshot: customer,
          dueDate: '2026-09-04',
          currency: 'USD',
          lines: [{ itemNameSnapshot: 'Service', unitPriceAmountMinor: '1000' }],
        }),
      );
    const first = await issue('Nile Traders');
    await issue('Delta Supplies');

    // By customer name (case-insensitive).
    const byName = await runInTx(h.txManager, orgId, () => listInvoices.execute({ q: 'nile' }));
    expect(byName.total).toBe(1);
    expect(byName.items[0]!.customerNameSnapshot).toBe('Nile Traders');

    // By invoice number (INV-xxxxxx).
    const byNumber = await runInTx(h.txManager, orgId, () => listInvoices.execute({ q: first.invoiceNumber }));
    expect(byNumber.total).toBe(1);
    expect(byNumber.items[0]!.invoiceNumber).toBe(first.invoiceNumber);

    // No match → empty page.
    const none = await runInTx(h.txManager, orgId, () => listInvoices.execute({ q: 'zzz-no-such' }));
    expect(none.total).toBe(0);
  });

  it('ACC-2/ACC-4: journal entry detail returns resolved lines, actor metadata, and the source reference', async () => {
    const { orgId } = await createOrgForOwner();
    const h = buildAccounting();
    await seedCoa(h, orgId);
    const arId = await accountIdByCode(h, orgId, '1200');
    const revenueId = await accountIdByCode(h, orgId, '4000');
    const getJournalEntryDetail = new GetJournalEntryDetailUseCase(h.repo, h.txManager);

    // A manual entry — lines resolve to account code + name; the actor is the
    // user who posted it.
    const { entryId } = await runInTx(h.txManager, orgId, () =>
      h.postJournalEntry.execute({
        entryDate: '2026-08-05',
        currency: 'USD',
        sourceType: 'manual',
        description: 'Manual GL test',
        lines: [
          { accountId: arId, debitAmountMinor: '5000' },
          { accountId: revenueId, creditAmountMinor: '5000' },
        ],
      }),
    );
    const detail = await runInTx(h.txManager, orgId, () => getJournalEntryDetail.execute({ entryId }));
    expect(detail.entry.entryNumber).toBeGreaterThan(0);
    expect(detail.entry.description).toBe('Manual GL test');
    expect(detail.entry.status).toBe('posted');
    expect(detail.entry.createdBy).toBe(ownerUserId);
    expect(detail.entry.postedBy).toBe(ownerUserId);
    expect(detail.entry.lines).toHaveLength(2);
    const arLine = detail.entry.lines.find((l) => l.debitAmountMinor === '5000');
    expect(arLine?.accountCode).toBe('1200');
    expect(arLine?.accountNameI18n?.en).toBe('coa.accounts_receivable');
    const revenueLine = detail.entry.lines.find((l) => l.creditAmountMinor === '5000');
    expect(revenueLine?.accountCode).toBe('4000');

    // An invoice-issuance entry carries the source invoice id (the detail link).
    const issued = await runInTx(h.txManager, orgId, () =>
      h.issueInvoice.execute({
        customerContactId: randomUUID(),
        customerNameSnapshot: 'Source Customer',
        dueDate: '2026-09-04',
        currency: 'USD',
        lines: [{ itemNameSnapshot: 'Service', unitPriceAmountMinor: '1000' }],
      }),
    );
    const invoice = await runInTx(h.txManager, orgId, (tx) => h.repo.findInvoiceByNumber(issued.invoiceNumber, tx));
    const sourceEntry = await runInTx(h.txManager, orgId, (tx) =>
      h.repo.findJournalEntryBySource('invoice_issuance', invoice!.id, tx),
    );
    const sourceDetail = await runInTx(h.txManager, orgId, () =>
      getJournalEntryDetail.execute({ entryId: sourceEntry!.id }),
    );
    expect(sourceDetail.entry.sourceType).toBe('invoice_issuance');
    expect(sourceDetail.entry.sourceId).toBe(invoice!.id);
  });

  it('ACC-2: journal detail resolves the reversing entry for a reversed entry', async () => {
    const { orgId } = await createOrgForOwner();
    const h = buildAccounting();
    await seedCoa(h, orgId);
    const arId = await accountIdByCode(h, orgId, '1200');
    const revenueId = await accountIdByCode(h, orgId, '4000');
    const getJournalEntryDetail = new GetJournalEntryDetailUseCase(h.repo, h.txManager);

    const { entryId } = await runInTx(h.txManager, orgId, () =>
      h.postJournalEntry.execute({
        entryDate: '2026-08-05',
        currency: 'USD',
        sourceType: 'manual',
        description: 'Entry to reverse',
        lines: [
          { accountId: arId, debitAmountMinor: '5000' },
          { accountId: revenueId, creditAmountMinor: '5000' },
        ],
      }),
    );
    const { reversalEntryId } = await runInTx(h.txManager, orgId, () => h.reverseJournalEntry.execute({ entryId }));

    const detail = await runInTx(h.txManager, orgId, () => getJournalEntryDetail.execute({ entryId }));
    expect(detail.entry.status).toBe('reversed');
    expect(detail.entry.reversedByEntryId).toBe(reversalEntryId);
    expect(detail.entry.reversedBy?.id).toBe(reversalEntryId);
    expect(detail.entry.reversedBy?.entryNumber).toBeGreaterThan(0);

    // The reversal itself is a fresh posted entry with no reversing reference.
    const reversalDetail = await runInTx(h.txManager, orgId, () =>
      getJournalEntryDetail.execute({ entryId: reversalEntryId }),
    );
    expect(reversalDetail.entry.status).toBe('posted');
    expect(reversalDetail.entry.reversedBy).toBeNull();
  });

  it('ACC-3: the journal list searches by description or entry number', async () => {
    const { orgId } = await createOrgForOwner();
    const h = buildAccounting();
    await seedCoa(h, orgId);
    const arId = await accountIdByCode(h, orgId, '1200');
    const revenueId = await accountIdByCode(h, orgId, '4000');
    const listJournalEntries = new ListJournalEntriesUseCase(h.repo, h.txManager);

    const post = (description: string) =>
      runInTx(h.txManager, orgId, () =>
        h.postJournalEntry.execute({
          entryDate: '2026-08-06',
          currency: 'USD',
          sourceType: 'manual',
          description,
          lines: [
            { accountId: arId, debitAmountMinor: '3000' },
            { accountId: revenueId, creditAmountMinor: '3000' },
          ],
        }),
      );
    await post('Rent payment');
    const second = await post('Consulting invoice');

    // Case-insensitive description search.
    const rent = await runInTx(h.txManager, orgId, () => listJournalEntries.execute({ q: 'rent' }));
    expect(rent.total).toBe(1);
    expect(rent.items[0]!.description).toBe('Rent payment');

    // Entry-number search — the formatted JE-xxxx reference.
    const formatted = `JE-${String(second.entryNumber).padStart(4, '0')}`;
    const byFormatted = await runInTx(h.txManager, orgId, () => listJournalEntries.execute({ q: formatted }));
    expect(byFormatted.total).toBe(1);
    expect(byFormatted.items[0]!.entryNumber).toBe(second.entryNumber);

    // A bare number matches the same entry.
    const byBare = await runInTx(h.txManager, orgId, () =>
      listJournalEntries.execute({ q: String(second.entryNumber) }),
    );
    expect(byBare.total).toBe(1);
    expect(byBare.items[0]!.entryNumber).toBe(second.entryNumber);

    // No match → empty page.
    const none = await runInTx(h.txManager, orgId, () => listJournalEntries.execute({ q: 'zzz-no-such' }));
    expect(none.total).toBe(0);
  });

  // ─── Reports (ACC-1/ACC-8/ACC-9) ───────────────────────────────────────

  it('ACC-1: the trial balance lists every account and balances (Σdebit = Σcredit)', async () => {
    const { orgId } = await createOrgForOwner();
    const h = buildAccounting();
    await seedCoa(h, orgId);
    const arId = await accountIdByCode(h, orgId, '1200');
    const revenueId = await accountIdByCode(h, orgId, '4000');
    const expenseId = await accountIdByCode(h, orgId, '5000');

    await runInTx(h.txManager, orgId, () =>
      h.postJournalEntry.execute({
        entryDate: '2026-08-01',
        currency: 'USD',
        sourceType: 'manual',
        description: 'Sale',
        lines: [
          { accountId: arId, debitAmountMinor: '5000' },
          { accountId: revenueId, creditAmountMinor: '5000' },
        ],
      }),
    );
    await runInTx(h.txManager, orgId, () =>
      h.postJournalEntry.execute({
        entryDate: '2026-08-02',
        currency: 'USD',
        sourceType: 'manual',
        description: 'Expense',
        lines: [
          { accountId: expenseId, debitAmountMinor: '2000' },
          { accountId: arId, creditAmountMinor: '2000' },
        ],
      }),
    );

    const trialBalance = new GetTrialBalanceUseCase(h.repo, h.txManager);
    const report = await runInTx(h.txManager, orgId, () => trialBalance.execute({}));

    expect(report.balanced).toBe(true);
    expect(report.totals.debitTotalMinor).toBe('7000');
    expect(report.totals.creditTotalMinor).toBe('7000');
    // Every account in the chart has a row (zero-balance accounts included).
    expect(report.rows.length).toBeGreaterThanOrEqual(11);
    const ar = report.rows.find((r) => r.code === '1200')!;
    const revenue = report.rows.find((r) => r.code === '4000')!;
    const expense = report.rows.find((r) => r.code === '5000')!;
    expect(ar.debitTotalMinor).toBe('5000');
    expect(ar.creditTotalMinor).toBe('2000');
    expect(ar.netMinor).toBe('3000'); // debit-normal
    expect(revenue.netMinor).toBe('5000'); // credit-normal
    expect(expense.netMinor).toBe('2000'); // debit-normal

    // Period filter restricts the rows to the given range.
    const july = await runInTx(h.txManager, orgId, () =>
      trialBalance.execute({ fromDate: '2026-07-01', toDate: '2026-07-31' }),
    );
    expect(july.totals.debitTotalMinor).toBe('0');
    expect(july.totals.creditTotalMinor).toBe('0');
  });

  it('ACC-1: the income statement nets revenue against expenses for a period', async () => {
    const { orgId } = await createOrgForOwner();
    const h = buildAccounting();
    await seedCoa(h, orgId);
    const arId = await accountIdByCode(h, orgId, '1200');
    const revenueId = await accountIdByCode(h, orgId, '4000');
    const expenseId = await accountIdByCode(h, orgId, '5000');

    await runInTx(h.txManager, orgId, () =>
      h.postJournalEntry.execute({
        entryDate: '2026-08-01',
        currency: 'USD',
        sourceType: 'manual',
        description: 'Sale',
        lines: [
          { accountId: arId, debitAmountMinor: '5000' },
          { accountId: revenueId, creditAmountMinor: '5000' },
        ],
      }),
    );
    await runInTx(h.txManager, orgId, () =>
      h.postJournalEntry.execute({
        entryDate: '2026-08-02',
        currency: 'USD',
        sourceType: 'manual',
        description: 'Rent',
        lines: [
          { accountId: expenseId, debitAmountMinor: '1200' },
          { accountId: arId, creditAmountMinor: '1200' },
        ],
      }),
    );

    const incomeStatement = new GetIncomeStatementUseCase(h.repo, h.txManager);
    const report = await runInTx(h.txManager, orgId, () => incomeStatement.execute({}));

    expect(report.revenue).toHaveLength(1);
    expect(report.revenue[0]!.code).toBe('4000');
    expect(report.revenue[0]!.netMinor).toBe('5000');
    expect(report.expenses).toHaveLength(1);
    expect(report.expenses[0]!.code).toBe('5000');
    expect(report.expenses[0]!.netMinor).toBe('1200');
    expect(report.revenueTotalMinor).toBe('5000');
    expect(report.expenseTotalMinor).toBe('1200');
    expect(report.netIncomeMinor).toBe('3800');
  });

  it('ACC-1: the balance sheet reports assets, liabilities, and equity as of a date', async () => {
    const { orgId } = await createOrgForOwner();
    const h = buildAccounting();
    await seedCoa(h, orgId);
    const cashId = await accountIdByCode(h, orgId, '1000');
    const revenueId = await accountIdByCode(h, orgId, '4000');
    const vatId = await accountIdByCode(h, orgId, '2100');

    // Sale: Dr Cash 1100 / Cr Revenue 1000 / Cr VAT payable 100.
    await runInTx(h.txManager, orgId, () =>
      h.postJournalEntry.execute({
        entryDate: '2026-08-01',
        currency: 'USD',
        sourceType: 'manual',
        description: 'Sale with VAT',
        lines: [
          { accountId: cashId, debitAmountMinor: '1100' },
          { accountId: revenueId, creditAmountMinor: '1000' },
          { accountId: vatId, creditAmountMinor: '100' },
        ],
      }),
    );

    const balanceSheet = new GetBalanceSheetUseCase(h.repo, h.txManager);
    const report = await runInTx(h.txManager, orgId, () => balanceSheet.execute({ asOfDate: '2026-08-31' }));

    expect(report.asOfDate).toBe('2026-08-31');
    expect(report.assets).toHaveLength(1);
    expect(report.assets[0]!.code).toBe('1000');
    expect(report.assets[0]!.balanceMinor).toBe('1100');
    expect(report.assetTotalMinor).toBe('1100');
    expect(report.liabilities).toHaveLength(1);
    expect(report.liabilities[0]!.code).toBe('2100');
    expect(report.liabilities[0]!.balanceMinor).toBe('100');
    expect(report.liabilityTotalMinor).toBe('100');

    // Equity is untouched by the sale (revenue is a P&L account), so it is
    // absent — the balance sheet sections are account-type scoped.
    expect(report.equity).toHaveLength(0);
    expect(report.equityTotalMinor).toBe('0');
  });

  it('ACC-8/ACC-9: AR aging buckets open invoices by days past due', async () => {
    const { orgId } = await createOrgForOwner();
    const h = buildAccounting();
    await seedCoa(h, orgId);

    // Invoice due 2026-08-01, as-of 2026-08-15 → 14 days past → 1-30 bucket.
    const result = await runInTx(h.txManager, orgId, () =>
      h.issueInvoice.execute({
        customerContactId: randomUUID(),
        customerNameSnapshot: 'Aging Customer',
        dueDate: '2026-08-01',
        currency: 'USD',
        lines: [{ itemNameSnapshot: 'Service', unitPriceAmountMinor: '10000' }],
      }),
    );
    const issued = await runInTx(h.txManager, orgId, (tx) => h.repo.findInvoiceByNumber(result.invoiceNumber, tx));

    // A second invoice fully paid — must NOT appear.
    const paidResult = await runInTx(h.txManager, orgId, () =>
      h.issueInvoice.execute({
        customerContactId: randomUUID(),
        customerNameSnapshot: 'Paid Customer',
        dueDate: '2026-08-10',
        currency: 'USD',
        lines: [{ itemNameSnapshot: 'Service', unitPriceAmountMinor: '5000' }],
      }),
    );
    const paidInvoice = await runInTx(h.txManager, orgId, (tx) =>
      h.repo.findInvoiceByNumber(paidResult.invoiceNumber, tx),
    );
    await runInTx(h.txManager, orgId, () =>
      h.applyPayment.execute({ invoiceId: paidInvoice!.id, method: 'cash', amountMinor: '5000', currency: 'USD' }),
    );

    const arAging = new GetArAgingUseCase(h.repo, h.txManager);
    const report = await runInTx(h.txManager, orgId, () => arAging.execute({ asOfDate: '2026-08-15' }));

    expect(report.asOfDate).toBe('2026-08-15');
    const bucket = report.buckets.find((b) => b.key === '1_30')!;
    expect(bucket.invoices).toHaveLength(1);
    expect(bucket.invoices[0]!.invoiceNumber).toBe(issued!.invoiceNumber);
    expect(bucket.invoices[0]!.balanceDueMinor).toBe('10000');
    expect(bucket.invoices[0]!.daysPastDue).toBe(14);
    expect(bucket.totalMinor).toBe('10000');
    expect(report.totalOutstandingMinor).toBe('10000');
    // The paid invoice is absent from every bucket.
    const all = report.buckets.flatMap((b) => b.invoices);
    expect(all.map((i) => i.invoiceNumber)).not.toContain(paidInvoice!.invoiceNumber);
  });
});
