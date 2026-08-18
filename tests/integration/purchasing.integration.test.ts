/**
 * Purchasing & Suppliers integration tests — real Postgres, RLS active
 * (Phase 8).
 *
 * Exercises the purchase-to-pay cycle end-to-end against the real `pur_`
 * schema with the `modubiz_app` role:
 *   - PUR-1: supplier directory — name required, tax id unique per org.
 *   - PUR-3: PO lifecycle — draft must be approved before receiving.
 *   - PUR-4: GRN receiving raises stock atomically through the inventory
 *            movement port; overshoot past the PO line is rejected.
 *   - PUR-6: three-way match — a bill's goods line needs a received GRN.
 *   - PUR-7: payments allocate across bills; over-allocation is rejected.
 *   - PUR-2: the vendor balance is the signed sum of ledger entries.
 *   - PUR-11: an approved supplier return posts the negative AP entry.
 *   - PUR-13: replayed approvals are idempotent (at-most-once effect).
 *   - TEN-1: cross-org reads fail closed (zero rows).
 *
 * @see PLAN.md §8.5 — Application layer integration tests
 * @see AGENTS.md §9 — Definition of done (integration tests)
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
import { GetSupplierUseCase } from '../../apps/api/src/modules/purchasing/application/get-supplier.use-case.js';
import { GetPurchaseOrderUseCase } from '../../apps/api/src/modules/purchasing/application/get-purchase-order.use-case.js';
import { ListSuppliersUseCase } from '../../apps/api/src/modules/purchasing/application/list-suppliers.use-case.js';
import { GetBillUseCase } from '../../apps/api/src/modules/purchasing/application/get-bill.use-case.js';
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

  // Apply core + module migrations (purchasing included) as the owner.
  await applyAllMigrations(ownerConnString);

  await ownerSql.unsafe(`
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${APP_ROLE};
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${APP_ROLE};
  `);

  const appSql = postgres(appConnString, { max: 10 });
  db = drizzle(appSql);

  // A real user row (id only is enough for the tenant context + created_by).
  ownerUserId = randomUUID();
  await ownerSql`
    INSERT INTO core_users (id, email, password_hash, name)
    VALUES (${ownerUserId}, ${`owner-${randomUUID().slice(0, 8)}@test.local`}, ${'hash'}, ${'Pur Owner'})
  `;
});

afterAll(async () => {
  if (ownerSql) await ownerSql.end();
  if (container) await container.stop();
});

/** Create an org for the owner; returns its id (TEN-1 context). */
async function createOrgForOwner(): Promise<{ orgId: string }> {
  const orgRepo = new DrizzleOrganizationRepository(db);
  const roleRepo = new DrizzleRoleRepository(db);
  const membershipRepo = new DrizzleMembershipRepository(db);
  const txManager = new TransactionManager(db);
  const createUseCase = new CreateOrganizationUseCase(orgRepo, roleRepo, membershipRepo, txManager);

  const slug = `pur-${randomUUID().slice(0, 8)}`;
  const result = await TenantContext.run({ ...ownerContext, userId: ownerUserId }, () =>
    createUseCase.execute({
      name: `Pur Org ${slug}`,
      slug,
      countryCode: 'US',
      baseCurrency: 'USD',
    }),
  );
  return { orgId: result.organization.id };
}

/** Fresh purchasing harness per test (each owns its TransactionManager). */
function buildPurchasing() {
  const repo = new DrizzlePurchasingRepository(db);
  const txManager = new TransactionManager(db);
  const recordingEventBus = {
    publish: async () => {},
    publishAll: async () => {},
    on: () => {},
    off: () => {},
  } as never;
  const unitOfWork = new UnitOfWork(recordingEventBus);
  const portRegistry = new PortRegistry();
  const invRepo = new DrizzleInventoryRepository(db);
  // The movement port MUST share this TransactionManager: a TransactionRef is
  // minted and resolved by the same manager instance (WeakMap-scoped), which
  // mirrors the single @Global instance at runtime.
  portRegistry.register(INVENTORY_MOVEMENT_PORT, new InventoryMovementPortImpl(invRepo, txManager));
  const createProduct = new CreateProductUseCase(invRepo, txManager, new UnitOfWork(recordingEventBus));
  const createSupplier = new CreateSupplierUseCase(repo, txManager, unitOfWork);
  const createPo = new CreatePurchaseOrderUseCase(repo, txManager);
  const approvePo = new ApprovePurchaseOrderUseCase(repo, txManager, unitOfWork);
  const receiveGrn = new ReceiveGrnUseCase(repo, txManager, unitOfWork, portRegistry);
  const createBill = new CreateBillUseCase(repo, txManager);
  const approveBill = new ApproveBillUseCase(repo, txManager, unitOfWork, portRegistry);
  const recordPayment = new RecordSupplierPaymentUseCase(repo, txManager, unitOfWork);
  const createReturn = new CreateSupplierReturnUseCase(repo, txManager);
  const approveReturn = new ApproveSupplierReturnUseCase(repo, txManager, unitOfWork, portRegistry);
  const getSupplier = new GetSupplierUseCase(repo, txManager);
  const getPo = new GetPurchaseOrderUseCase(repo, txManager);
  const getBill = new GetBillUseCase(repo, txManager);
  const listSuppliers = new ListSuppliersUseCase(repo, txManager);
  return {
    repo,
    txManager,
    unitOfWork,
    portRegistry,
    invRepo,
    createProduct,
    createSupplier,
    createPo,
    approvePo,
    receiveGrn,
    createBill,
    approveBill,
    recordPayment,
    createReturn,
    approveReturn,
    getSupplier,
    getPo,
    getBill,
    listSuppliers,
  };
}

/** Run a callback in tenant context inside one TransactionManager transaction. */
function runInTx<T>(txManager: TransactionManager, orgId: string, fn: (tx: unknown) => Promise<T>): Promise<T> {
  return TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () => txManager.run(fn));
}

/** Create a product + variant; returns both ids (inventory seeding). */
async function createProduct(
  h: ReturnType<typeof buildPurchasing>,
  orgId: string,
  opts: { name: string; sku: string; costMinor?: string } = { name: 'Goods', sku: 'GOODS-1' },
): Promise<{ productId: string; variantId: string }> {
  const { productId, variantId } = await TenantContext.run(
    { ...ownerContext, userId: ownerUserId, organizationId: orgId },
    () =>
      h.createProduct.execute({
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

/** The org's default warehouse id (movement port resolves it on receive). */
async function defaultWarehouseId(h: ReturnType<typeof buildPurchasing>, orgId: string): Promise<string> {
  return runInTx(h.txManager, orgId, async (tx) => {
    const warehouses = await h.invRepo.listWarehouses(tx);
    const warehouse = warehouses[0];
    if (!warehouse) throw new Error('no warehouse seeded');
    return warehouse.id;
  });
}

/** Stock level for a variant in the default warehouse. */
async function stockLevel(h: ReturnType<typeof buildPurchasing>, orgId: string, variantId: string): Promise<string> {
  const warehouseId = await defaultWarehouseId(h, orgId);
  return runInTx(h.txManager, orgId, async (tx) => {
    const level = await h.invRepo.getStockLevel(variantId, warehouseId, tx);
    return level?.quantityOnHand ?? '0';
  });
}

/** The received GRN line id for a GRN (PUR-6 three-way match reference). */
async function grnLineId(h: ReturnType<typeof buildPurchasing>, orgId: string, grnId: string): Promise<string> {
  return runInTx(h.txManager, orgId, async (tx) => {
    const grn = await h.repo.findGrnById(grnId, tx);
    const line = grn?.lines[0];
    if (!line) throw new Error('GRN has no lines');
    return line.id;
  });
}

/** Seed a supplier + an approved PO for one variant; returns the ids. */
async function seedApprovedPo(
  h: ReturnType<typeof buildPurchasing>,
  orgId: string,
  variantId: string,
  opts: { quantity?: string; unitCostMinor?: string } = {},
): Promise<{ supplierId: string; poId: string; poLineId: string }> {
  const { supplierId } = await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
    h.createSupplier.execute({ name: `Supplier ${randomUUID().slice(0, 6)}` }),
  );
  const { purchaseOrderId: poId } = await TenantContext.run(
    { ...ownerContext, userId: ownerUserId, organizationId: orgId },
    () =>
      h.createPo.execute({
        supplierId,
        currency: 'USD',
        lines: [
          {
            variantId,
            itemNameSnapshot: 'Widget',
            quantity: opts.quantity ?? '10',
            unitCostMinor: opts.unitCostMinor ?? '1000',
          },
        ],
      }),
  );
  const po = await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
    h.getPo.execute({ purchaseOrderId: poId }),
  );
  await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
    h.approvePo.execute({ purchaseOrderId: poId }),
  );
  return { supplierId, poId, poLineId: po.lines[0]!.id };
}

describe('purchasing module (Phase 8, integration)', () => {
  it('PUR-1: creates a supplier and rejects a duplicate tax id per org', async () => {
    const h = buildPurchasing();
    const { orgId } = await createOrgForOwner();

    const { supplierId } = await TenantContext.run(
      { ...ownerContext, userId: ownerUserId, organizationId: orgId },
      () => h.createSupplier.execute({ name: 'Acme Supplies', taxId: 'TAX-1' }),
    );
    const supplier = await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      h.getSupplier.execute({ supplierId }),
    );
    expect(supplier.supplier.name).toBe('Acme Supplies');
    expect(supplier.balanceMinor).toBe('0');

    await expect(
      TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
        h.createSupplier.execute({ name: 'Other Co', taxId: 'TAX-1' }),
      ),
    ).rejects.toThrow(/already exists/i);
  });

  it('PUR-3/PUR-4: PO must be approved before a GRN can be received', async () => {
    const h = buildPurchasing();
    const { orgId } = await createOrgForOwner();
    const { variantId } = await createProduct(h, orgId, { name: 'Widget', sku: 'WIDGET-1' });

    const { supplierId } = await TenantContext.run(
      { ...ownerContext, userId: ownerUserId, organizationId: orgId },
      () => h.createSupplier.execute({ name: 'Supplier A' }),
    );
    const { purchaseOrderId: poId } = await TenantContext.run(
      { ...ownerContext, userId: ownerUserId, organizationId: orgId },
      () =>
        h.createPo.execute({
          supplierId,
          currency: 'USD',
          lines: [{ variantId, itemNameSnapshot: 'Widget', quantity: '10', unitCostMinor: '500' }],
        }),
    );
    const po = await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      h.getPo.execute({ purchaseOrderId: poId }),
    );
    const poLineId = po.lines[0]!.id;

    // A draft PO cannot be received (PUR-3 → PUR-4 gate).
    await expect(
      TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
        h.receiveGrn.execute({
          poId,
          lines: [{ poLineId, variantId, quantity: '10', unitCostMinor: '500' }],
        }),
      ),
    ).rejects.toThrow(/PURCHASING_PO_NOT_APPROVED/);

    // Approve, then receiving works and raises stock atomically.
    await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      h.approvePo.execute({ purchaseOrderId: poId }),
    );
    const { grnId } = await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      h.receiveGrn.execute({
        poId,
        lines: [{ poLineId, variantId, quantity: '10', unitCostMinor: '500' }],
      }),
    );
    expect(grnId).toBeTruthy();
    expect(await stockLevel(h, orgId, variantId)).toBe('10');
  });

  it('PUR-4: a GRN cannot overshoot the PO line ordered quantity', async () => {
    const h = buildPurchasing();
    const { orgId } = await createOrgForOwner();
    const { variantId } = await createProduct(h, orgId, { name: 'Widget', sku: 'WIDGET-2' });

    const { supplierId, poId, poLineId } = await seedApprovedPo(h, orgId, variantId, { quantity: '5' });

    await expect(
      TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
        h.receiveGrn.execute({
          poId,
          lines: [{ poLineId, variantId, quantity: '6', unitCostMinor: '500' }],
        }),
      ),
    ).rejects.toThrow(/GRN.*exceed|past ordered/i);
    expect(supplierId).toBeTruthy();
  });

  it('PUR-6/PUR-7/PUR-2: full purchase-to-pay cycle books the ledger and settles the bill', async () => {
    const h = buildPurchasing();
    const { orgId } = await createOrgForOwner();
    const { variantId } = await createProduct(h, orgId, { name: 'Widget', sku: 'WIDGET-3', costMinor: '400' });

    const { supplierId, poId, poLineId } = await seedApprovedPo(h, orgId, variantId);
    const { grnId } = await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      h.receiveGrn.execute({
        poId,
        lines: [{ poLineId, variantId, quantity: '10', unitCostMinor: '1000' }],
      }),
    );
    const billGrnLineId = await grnLineId(h, orgId, grnId);

    // PUR-6: a bill whose goods line has NO received GRN reference is rejected
    // at approval (the three-way match).
    const badBill = await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      h.createBill.execute({
        supplierId,
        currency: 'USD',
        lines: [{ variantId, quantity: '10', unitCostMinor: '1000' }],
      }),
    );
    await expect(
      TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
        h.approveBill.execute({ billId: badBill.billId }),
      ),
    ).rejects.toThrow(/no received GRN|PURCHASING_BILL_MISSING_GRN/i);

    // PUR-6: with the GRN line reference the bill approves; the ledger records it.
    const { billId } = await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      h.createBill.execute({
        supplierId,
        poId,
        grnId,
        currency: 'USD',
        lines: [{ poLineId, grnLineId: billGrnLineId, variantId, quantity: '10', unitCostMinor: '1000' }],
      }),
    );
    await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      h.approveBill.execute({ billId }),
    );
    const bill = await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      h.getBill.execute({ billId }),
    );
    expect(bill.status).toBe('approved');
    expect(bill.totalMinor).toBe('10000');

    // PUR-2: balance after the bill is +10000.
    const afterBill = await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      h.getSupplier.execute({ supplierId }),
    );
    expect(afterBill.balanceMinor).toBe('10000');

    // PUR-7: partial payment → partially_paid; over-allocation rejected.
    await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      h.recordPayment.execute({
        supplierId,
        method: 'bank_transfer',
        amountMinor: '6000',
        currency: 'USD',
        allocations: [{ billId, amountMinor: '6000' }],
      }),
    );
    const afterPayment = await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      h.getBill.execute({ billId }),
    );
    expect(afterPayment.status).toBe('partially_paid');

    await expect(
      TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
        h.recordPayment.execute({
          supplierId,
          method: 'bank_transfer',
          amountMinor: '5000',
          currency: 'USD',
          allocations: [{ billId, amountMinor: '5000' }],
        }),
      ),
    ).rejects.toThrow(/exceed|PUR-7/i);

    // PUR-7: settle the remainder → paid; PUR-2: balance 0.
    await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      h.recordPayment.execute({
        supplierId,
        method: 'bank_transfer',
        amountMinor: '4000',
        currency: 'USD',
        allocations: [{ billId, amountMinor: '4000' }],
      }),
    );
    const settled = await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      h.getBill.execute({ billId }),
    );
    expect(settled.status).toBe('paid');
    const balanced = await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      h.getSupplier.execute({ supplierId }),
    );
    expect(balanced.balanceMinor).toBe('0');
  });

  it('PUR-11: an approved supplier return posts the negative AP entry and removes stock', async () => {
    const h = buildPurchasing();
    const { orgId } = await createOrgForOwner();
    const { variantId } = await createProduct(h, orgId, { name: 'Widget', sku: 'WIDGET-4', costMinor: '400' });

    const { supplierId, poId, poLineId } = await seedApprovedPo(h, orgId, variantId);
    const { grnId } = await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      h.receiveGrn.execute({
        poId,
        lines: [{ poLineId, variantId, quantity: '10', unitCostMinor: '1000' }],
      }),
    );
    const billGrnLineId = await grnLineId(h, orgId, grnId);
    const { billId } = await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      h.createBill.execute({
        supplierId,
        poId,
        grnId,
        currency: 'USD',
        lines: [{ poLineId, grnLineId: billGrnLineId, variantId, quantity: '10', unitCostMinor: '1000' }],
      }),
    );
    await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      h.approveBill.execute({ billId }),
    );

    // PUR-11: return 2 of the 10 units → negative AP entry, stock reduced.
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

    // PUR-2: balance = +10000 (bill) − 2000 (debit note) = 8000.
    const afterReturn = await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      h.getSupplier.execute({ supplierId }),
    );
    expect(afterReturn.balanceMinor).toBe('8000');
    // PUR-11: stock went back to the supplier (10 − 2 = 8).
    expect(await stockLevel(h, orgId, variantId)).toBe('8');
  });

  it('PUR-13: a replayed bill approval is a no-op (at-most-once)', async () => {
    const h = buildPurchasing();
    const { orgId } = await createOrgForOwner();
    const { variantId } = await createProduct(h, orgId, { name: 'Widget', sku: 'WIDGET-5' });

    const { supplierId, poId, poLineId } = await seedApprovedPo(h, orgId, variantId, { quantity: '3' });
    const { grnId } = await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      h.receiveGrn.execute({
        poId,
        lines: [{ poLineId, variantId, quantity: '3', unitCostMinor: '1000' }],
      }),
    );
    const billGrnLineId = await grnLineId(h, orgId, grnId);
    const { billId } = await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      h.createBill.execute({
        supplierId,
        poId,
        grnId,
        currency: 'USD',
        lines: [{ poLineId, grnLineId: billGrnLineId, variantId, quantity: '3', unitCostMinor: '1000' }],
      }),
    );

    const idempotencyKey = randomUUID();
    await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      h.approveBill.execute({ billId, idempotencyKey }),
    );
    // Replay with the same key — same result, no duplicate ledger entry.
    await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      h.approveBill.execute({ billId, idempotencyKey }),
    );
    const ledger = await runInTx(h.txManager, orgId, (tx) => h.repo.listLedgerEntries(supplierId, tx));
    const billEntries = ledger.filter((e) => e.referenceType === 'bill' && e.referenceId === billId);
    expect(billEntries).toHaveLength(1);
  });

  it('TEN-1: cross-org reads fail closed (zero rows)', async () => {
    const h = buildPurchasing();
    const orgA = await createOrgForOwner();
    const orgB = await createOrgForOwner();

    await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgA.orgId }, () =>
      h.createSupplier.execute({ name: 'Org A Supplier' }),
    );

    // Org B cannot see Org A's suppliers.
    const listB = await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgB.orgId }, () =>
      h.listSuppliers.execute({}),
    );
    expect(listB.items).toHaveLength(0);
  });
});
