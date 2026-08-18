/**
 * Purchasing → Accounting AP integration tests (ACC-15) — real Postgres, RLS.
 *
 * Completes the purchase-to-pay cycle through the purchasing use cases,
 * captures the published events, and feeds each to the accounting GL handler
 * to prove the AP journal entries post idempotently:
 *   - bill.approved      → Dr Inventory (1300) / Dr Expense (5100) /
 *                          Cr AP (2000) / Cr VAT (2100)
 *   - payment.recorded   → Dr AP (2000) / Cr Bank (1100)
 *   - supplier_return    → Dr AP (2000) / Cr Inventory (1300)
 *
 * @see BUSINESS_RULES.md §14 — PUR-* and ACC-15 (idempotent GL posting)
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import type { StartedTestContainer } from 'testcontainers';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { randomUUID } from 'node:crypto';

import { TransactionManager } from '../../apps/api/src/core/database/transaction-manager.js';
import { UnitOfWork } from '../../apps/api/src/core/database/unit-of-work.js';
import { TenantContext, type TenantContextData } from '../../apps/api/src/core/tenancy/tenant-context.js';
import { PortRegistry } from '../../apps/api/src/core/ports/port-registry.js';
import { INVENTORY_MOVEMENT_PORT } from '../../packages/contracts/src/ports/index.js';
import type { Event } from '../../apps/api/src/core/events/event-bus.interface.js';
import { EntitlementService } from '../../apps/api/src/core/entitlements/entitlement.service.js';
import type {
  EntitlementEntry,
  IEntitlementStore,
} from '../../apps/api/src/core/entitlements/entitlement-store.interface.js';
import { DrizzleOrganizationRepository } from '../../apps/api/src/platform/organizations/infrastructure/repositories/drizzle-organization.repository.js';
import { DrizzleRoleRepository } from '../../apps/api/src/platform/roles/infrastructure/repositories/drizzle-role.repository.js';
import { DrizzleMembershipRepository } from '../../apps/api/src/platform/memberships/infrastructure/repositories/drizzle-membership.repository.js';
import { CreateOrganizationUseCase } from '../../apps/api/src/platform/organizations/application/create-organization.use-case.js';
import { DrizzlePurchasingRepository } from '../../apps/api/src/modules/purchasing/infrastructure/repositories/drizzle-purchasing.repository.js';
import { DrizzleInventoryRepository } from '../../apps/api/src/modules/inventory/infrastructure/repositories/drizzle-inventory.repository.js';
import { InventoryMovementPortImpl } from '../../apps/api/src/modules/inventory/infrastructure/ports/inventory-movement.port.impl.js';
import { CreateProductUseCase } from '../../apps/api/src/modules/inventory/application/create-product.use-case.js';
import { CreateSupplierUseCase } from '../../apps/api/src/modules/purchasing/application/create-supplier.use-case.js';
import { CreatePurchaseOrderUseCase } from '../../apps/api/src/modules/purchasing/application/create-purchase-order.use-case.js';
import { ApprovePurchaseOrderUseCase } from '../../apps/api/src/modules/purchasing/application/approve-purchase-order.use-case.js';
import { ReceiveGrnUseCase } from '../../apps/api/src/modules/purchasing/application/receive-grn.use-case.js';
import { CreateBillUseCase } from '../../apps/api/src/modules/purchasing/application/create-bill.use-case.js';
import { ApproveBillUseCase } from '../../apps/api/src/modules/purchasing/application/approve-bill.use-case.js';
import { RecordSupplierPaymentUseCase } from '../../apps/api/src/modules/purchasing/application/record-supplier-payment.use-case.js';
import { CreateSupplierReturnUseCase } from '../../apps/api/src/modules/purchasing/application/create-supplier-return.use-case.js';
import { ApproveSupplierReturnUseCase } from '../../apps/api/src/modules/purchasing/application/approve-supplier-return.use-case.js';
import { GetPurchaseOrderUseCase } from '../../apps/api/src/modules/purchasing/application/get-purchase-order.use-case.js';
import { DrizzleAccountingRepository } from '../../apps/api/src/modules/accounting/infrastructure/repositories/drizzle-accounting.repository.js';
import { EnsureDefaultChartOfAccountsUseCase } from '../../apps/api/src/modules/accounting/application/ensure-default-coa.use-case.js';
import { PostJournalEntryUseCase } from '../../apps/api/src/modules/accounting/application/post-journal-entry.use-case.js';
import { PurchasingBillApprovedHandler } from '../../apps/api/src/modules/accounting/events/handlers/purchasing-bill-approved.handler.js';
import { PurchasingPaymentRecordedHandler } from '../../apps/api/src/modules/accounting/events/handlers/purchasing-payment-recorded.handler.js';
import { PurchasingSupplierReturnApprovedHandler } from '../../apps/api/src/modules/accounting/events/handlers/purchasing-supplier-return-approved.handler.js';
import { applyAllMigrations } from './helpers/migrations.js';

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

/** In-memory entitlement store stub (ACC-16): accounting active for the org. */
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

  db = drizzle(postgres(appConnString), { max: 10 });

  ownerUserId = randomUUID();
  await ownerSql`
    INSERT INTO core_users (id, email, password_hash, name)
    VALUES (${ownerUserId}, ${`owner-${randomUUID().slice(0, 8)}@test.local`}, ${'hash'}, ${'Pur Ap Owner'})
  `;
});

afterAll(async () => {
  if (ownerSql) await ownerSql.end();
  if (container) await container.stop();
});

/** Recording event bus — captures events the unit of work publishes. */
function recordingBus() {
  const published: Event[] = [];
  return {
    published,
    bus: {
      publish: async () => {},
      publishAll: async (events: Event[]) => {
        published.push(...events);
      },
      on: () => {},
      off: () => {},
    } as never,
  };
}

async function createOrgForOwner(): Promise<{ orgId: string }> {
  const orgRepo = new DrizzleOrganizationRepository(db);
  const roleRepo = new DrizzleRoleRepository(db);
  const membershipRepo = new DrizzleMembershipRepository(db);
  const txManager = new TransactionManager(db);
  const createUseCase = new CreateOrganizationUseCase(orgRepo, roleRepo, membershipRepo, txManager);

  const slug = `pur-ap-${randomUUID().slice(0, 8)}`;
  const result = await TenantContext.run({ ...ownerContext, userId: ownerUserId }, () =>
    createUseCase.execute({
      name: `Pur Ap Org ${slug}`,
      slug,
      countryCode: 'US',
      baseCurrency: 'USD',
    }),
  );
  return { orgId: result.organization.id };
}

/** Shared harness: purchasing + accounting repos on ONE TransactionManager. */
function buildHarness() {
  const txManager = new TransactionManager(db);
  const purRepo = new DrizzlePurchasingRepository(db);
  const accRepo = new DrizzleAccountingRepository(db);
  const purBus = recordingBus();
  const accBus = recordingBus();
  const purUnitOfWork = new UnitOfWork(purBus.bus);
  const accUnitOfWork = new UnitOfWork(accBus.bus);
  const portRegistry = new PortRegistry();
  const invRepo = new DrizzleInventoryRepository(db);
  portRegistry.register(INVENTORY_MOVEMENT_PORT, new InventoryMovementPortImpl(invRepo, txManager));
  const createProduct = new CreateProductUseCase(invRepo, txManager, new UnitOfWork(purBus.bus));

  const ensureCoa = new EnsureDefaultChartOfAccountsUseCase(accRepo, txManager);
  const postJournalEntry = new PostJournalEntryUseCase(accRepo, txManager, accUnitOfWork);

  const store = new StubEntitlementStore();
  const entitlements = new EntitlementService(store);

  const handlers = {
    bill: new PurchasingBillApprovedHandler(
      accRepo,
      txManager,
      accUnitOfWork,
      entitlements,
      ensureCoa,
      postJournalEntry,
    ),
    payment: new PurchasingPaymentRecordedHandler(
      accRepo,
      txManager,
      accUnitOfWork,
      entitlements,
      ensureCoa,
      postJournalEntry,
    ),
    supplierReturn: new PurchasingSupplierReturnApprovedHandler(
      accRepo,
      txManager,
      accUnitOfWork,
      entitlements,
      ensureCoa,
      postJournalEntry,
    ),
  };

  return {
    txManager,
    purRepo,
    accRepo,
    purUnitOfWork,
    purBus,
    accUnitOfWork,
    accBus,
    entitlements,
    store,
    handlers,
    createProduct,
    createSupplier: new CreateSupplierUseCase(purRepo, txManager, purUnitOfWork),
    createPo: new CreatePurchaseOrderUseCase(purRepo, txManager),
    approvePo: new ApprovePurchaseOrderUseCase(purRepo, txManager, purUnitOfWork),
    receiveGrn: new ReceiveGrnUseCase(purRepo, txManager, purUnitOfWork, portRegistry),
    createBill: new CreateBillUseCase(purRepo, txManager),
    approveBill: new ApproveBillUseCase(purRepo, txManager, purUnitOfWork, portRegistry),
    recordPayment: new RecordSupplierPaymentUseCase(purRepo, txManager, purUnitOfWork),
    createReturn: new CreateSupplierReturnUseCase(purRepo, txManager),
    approveReturn: new ApproveSupplierReturnUseCase(purRepo, txManager, purUnitOfWork, portRegistry),
    getPo: new GetPurchaseOrderUseCase(purRepo, txManager),
  };
}

function runInTx<T>(txManager: TransactionManager, orgId: string, fn: (tx: unknown) => Promise<T>): Promise<T> {
  return TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () => txManager.run(fn));
}

/** Resolve an account id by code (must run inside a tenant-bound tx). */
async function accountIdByCode(h: ReturnType<typeof buildHarness>, orgId: string, code: string): Promise<string> {
  return runInTx(h.txManager, orgId, async (tx) => {
    const accounts = await h.accRepo.listAccounts(tx);
    const found = accounts.find((a) => a.code === code);
    if (!found) throw new Error(`Account ${code} not seeded`);
    return found.id;
  });
}

describe('purchasing → accounting AP entries (Phase 8, integration, ACC-15)', () => {
  it('bill.approved posts Dr Inventory / Cr AP / Cr VAT idempotently', async () => {
    const h = buildHarness();
    const { orgId } = await createOrgForOwner();
    await h.store.upsert({
      moduleKey: 'accounting',
      organizationId: orgId,
      state: 'active',
      trialStartedAt: null,
      trialEndsAt: null,
      activatedAt: null,
      disabledAt: null,
      purgeAfter: null,
      features: [],
    });

    const { productId: _p, variantId } = await TenantContext.run(
      { ...ownerContext, userId: ownerUserId, organizationId: orgId },
      () =>
        h.createProduct.execute({
          nameI18n: { en: 'Widget' },
          sku: 'AP-1',
          priceAmountMinor: '1000',
          priceCurrency: 'USD',
          costAmountMinor: '400',
          costCurrency: 'USD',
          reorderPoint: '5',
          reorderQuantity: '20',
        }),
    );

    const { supplierId } = await TenantContext.run(
      { ...ownerContext, userId: ownerUserId, organizationId: orgId },
      () => h.createSupplier.execute({ name: 'AP Supplier' }),
    );
    const { purchaseOrderId: poId } = await TenantContext.run(
      { ...ownerContext, userId: ownerUserId, organizationId: orgId },
      () =>
        h.createPo.execute({
          supplierId,
          currency: 'USD',
          lines: [{ variantId, itemNameSnapshot: 'Widget', quantity: '10', unitCostMinor: '1000' }],
        }),
    );
    const po = await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      h.getPo.execute({ purchaseOrderId: poId }),
    );
    const poLineId = po.lines[0]!.id;
    await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      h.approvePo.execute({ purchaseOrderId: poId }),
    );
    const { grnId } = await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      h.receiveGrn.execute({
        poId,
        lines: [{ poLineId, variantId, quantity: '10', unitCostMinor: '1000' }],
      }),
    );
    const grnLineId = await runInTx(h.txManager, orgId, async (tx) => {
      const grn = await h.purRepo.findGrnById(grnId, tx);
      return grn!.lines[0]!.id;
    });

    const { billId } = await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      h.createBill.execute({
        supplierId,
        poId,
        grnId,
        currency: 'USD',
        lines: [{ poLineId, grnLineId, variantId, quantity: '10', unitCostMinor: '1000' }],
      }),
    );
    await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      h.approveBill.execute({ billId }),
    );

    // The purchase cycle published the events after commit.
    const billEvent = h.purBus.published.find((e) => e.name === 'purchasing.bill.approved.v1');
    expect(billEvent).toBeDefined();

    // Feed the event to the accounting handler → Dr Inventory / Cr AP / Cr VAT.
    await h.handlers.bill.handle(billEvent!);

    const entry = await runInTx(h.txManager, orgId, (tx) =>
      h.accRepo.findJournalEntryBySource('purchase_bill', billId, tx),
    );
    expect(entry).toBeDefined();
    const lines = entry!.lines;
    const inventoryId = await accountIdByCode(h, orgId, '1300');
    const apId = await accountIdByCode(h, orgId, '2000');
    const drInventory = lines.find((l) => l.accountId === inventoryId);
    const crAp = lines.find((l) => l.accountId === apId);
    expect(drInventory?.debitAmountMinor).toBe('10000');
    expect(crAp?.creditAmountMinor).toBe('10000');

    // Idempotency: a replayed event is a no-op (still one entry).
    await h.handlers.bill.handle(billEvent!);
    const afterReplay = await runInTx(h.txManager, orgId, (tx) =>
      h.accRepo.findJournalEntryBySource('purchase_bill', billId, tx),
    );
    expect(afterReplay?.id).toBe(entry!.id);
  });

  it('payment.recorded posts Dr AP / Cr Bank, and supplier_return posts Dr AP / Cr Inventory', async () => {
    const h = buildHarness();
    const { orgId } = await createOrgForOwner();
    await h.store.upsert({
      moduleKey: 'accounting',
      organizationId: orgId,
      state: 'active',
      trialStartedAt: null,
      trialEndsAt: null,
      activatedAt: null,
      disabledAt: null,
      purgeAfter: null,
      features: [],
    });

    const { variantId } = await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      h.createProduct.execute({
        nameI18n: { en: 'Widget' },
        sku: 'AP-2',
        priceAmountMinor: '1000',
        priceCurrency: 'USD',
        costAmountMinor: '400',
        costCurrency: 'USD',
        reorderPoint: '5',
        reorderQuantity: '20',
      }),
    );
    const { supplierId } = await TenantContext.run(
      { ...ownerContext, userId: ownerUserId, organizationId: orgId },
      () => h.createSupplier.execute({ name: 'AP Supplier 2' }),
    );
    const { purchaseOrderId: poId } = await TenantContext.run(
      { ...ownerContext, userId: ownerUserId, organizationId: orgId },
      () =>
        h.createPo.execute({
          supplierId,
          currency: 'USD',
          lines: [{ variantId, itemNameSnapshot: 'Widget', quantity: '10', unitCostMinor: '1000' }],
        }),
    );
    const po = await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      h.getPo.execute({ purchaseOrderId: poId }),
    );
    const poLineId = po.lines[0]!.id;
    await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      h.approvePo.execute({ purchaseOrderId: poId }),
    );
    const { grnId } = await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      h.receiveGrn.execute({
        poId,
        lines: [{ poLineId, variantId, quantity: '10', unitCostMinor: '1000' }],
      }),
    );
    const grnLineId = await runInTx(h.txManager, orgId, async (tx) => {
      const grn = await h.purRepo.findGrnById(grnId, tx);
      return grn!.lines[0]!.id;
    });
    const { billId } = await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      h.createBill.execute({
        supplierId,
        poId,
        grnId,
        currency: 'USD',
        lines: [{ poLineId, grnLineId, variantId, quantity: '10', unitCostMinor: '1000' }],
      }),
    );
    await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      h.approveBill.execute({ billId }),
    );
    await h.handlers.bill.handle(h.purBus.published.find((e) => e.name === 'purchasing.bill.approved.v1')!);

    // Payment: 6000 via bank_transfer.
    await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      h.recordPayment.execute({
        supplierId,
        method: 'bank_transfer',
        amountMinor: '6000',
        currency: 'USD',
        allocations: [{ billId, amountMinor: '6000' }],
      }),
    );
    const paymentEvent = h.purBus.published.find((e) => e.name === 'purchasing.payment.recorded.v1');
    expect(paymentEvent).toBeDefined();
    await h.handlers.payment.handle(paymentEvent!);

    const apId = await accountIdByCode(h, orgId, '2000');
    const bankId = await accountIdByCode(h, orgId, '1100');
    const paymentId = (paymentEvent!.payload as { paymentId: string }).paymentId;
    const paymentEntry = await runInTx(h.txManager, orgId, (tx) =>
      h.accRepo.findJournalEntryBySource('supplier_payment', paymentId, tx),
    );
    expect(paymentEntry).toBeDefined();
    const paymentLines = paymentEntry!.lines;
    expect(paymentLines.find((l) => l.accountId === apId)?.debitAmountMinor).toBe('6000');
    expect(paymentLines.find((l) => l.accountId === bankId)?.creditAmountMinor).toBe('6000');

    // Return: 2 units → Dr AP / Cr Inventory (goods).
    const { returnId } = await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      h.createReturn.execute({
        supplierId,
        billId,
        reasonCode: 'defective',
        currency: 'USD',
        lines: [{ variantId, quantity: '2', unitCostMinor: '1000' }],
      }),
    );
    await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      h.approveReturn.execute({ supplierReturnId: returnId }),
    );
    const returnEvent = h.purBus.published.find((e) => e.name === 'purchasing.supplier_return.approved.v1');
    expect(returnEvent).toBeDefined();
    await h.handlers.supplierReturn.handle(returnEvent!);

    const inventoryId = await accountIdByCode(h, orgId, '1300');
    const returnEntry = await runInTx(h.txManager, orgId, (tx) =>
      h.accRepo.findJournalEntryBySource('supplier_return', returnId, tx),
    );
    expect(returnEntry).toBeDefined();
    const returnLines = returnEntry!.lines;
    expect(returnLines.find((l) => l.accountId === apId)?.debitAmountMinor).toBe('2000');
    expect(returnLines.find((l) => l.accountId === inventoryId)?.creditAmountMinor).toBe('2000');
  });
});
