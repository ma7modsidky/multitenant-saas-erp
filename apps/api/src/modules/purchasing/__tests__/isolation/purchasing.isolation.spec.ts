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
import { PurchasingController } from '../../api/purchasing.controller.js';
import {
  ApproveBillUseCase,
  ApprovePurchaseOrderUseCase,
  ApproveSupplierReturnUseCase,
  CreateBillUseCase,
  CreatePurchaseOrderUseCase,
  CreateSupplierReturnUseCase,
  CreateSupplierUseCase,
  ListBillsUseCase,
  ListPurchaseOrdersUseCase,
  ListSuppliersUseCase,
  ReceiveGrnUseCase,
  RecordSupplierPaymentUseCase,
  UpdateSupplierUseCase,
} from '../../application/index.js';
import { DrizzlePurchasingRepository } from '../../infrastructure/repositories/drizzle-purchasing.repository.js';
import { DrizzleInventoryRepository } from '../../../../modules/inventory/infrastructure/repositories/drizzle-inventory.repository.js';
import { InventoryMovementPortImpl } from '../../../../modules/inventory/infrastructure/ports/inventory-movement.port.impl.js';
import { INVENTORY_MOVEMENT_PORT } from '@modubiz/contracts';

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
let repo: DrizzlePurchasingRepository;
let createSupplier: CreateSupplierUseCase;
let updateSupplier: UpdateSupplierUseCase;
let createPo: CreatePurchaseOrderUseCase;
let listSuppliers: ListSuppliersUseCase;
let listPos: ListPurchaseOrdersUseCase;
let listBills: ListBillsUseCase;

function context(organizationId: string, userId: string): TenantContextData {
  return {
    userId,
    sessionId: undefined,
    organizationId,
    roles: ['OWNER'],
    permissions: [
      'purchasing:supplier:read',
      'purchasing:supplier:write',
      'purchasing:requisition:write',
      'purchasing:po:write',
      'purchasing:grn:receive',
      'purchasing:bill:approve',
      'purchasing:payment:record',
      'purchasing:return:create',
      'purchasing:report:view',
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
  repo = new DrizzlePurchasingRepository(db);
  const unitOfWork = new UnitOfWork(noopEventBus);
  const portRegistry = new PortRegistry();
  const invRepo = new DrizzleInventoryRepository(db);
  portRegistry.register(INVENTORY_MOVEMENT_PORT, new InventoryMovementPortImpl(invRepo, txManager));
  createSupplier = new CreateSupplierUseCase(repo, txManager, unitOfWork);
  updateSupplier = new UpdateSupplierUseCase(repo, txManager);
  createPo = new CreatePurchaseOrderUseCase(repo, txManager);
  listSuppliers = new ListSuppliersUseCase(repo, txManager);
  listPos = new ListPurchaseOrdersUseCase(repo, txManager);
  listBills = new ListBillsUseCase(repo, txManager);
  void new ApprovePurchaseOrderUseCase(repo, txManager, unitOfWork);
  void new ReceiveGrnUseCase(repo, txManager, unitOfWork, portRegistry);
  void new CreateBillUseCase(repo, txManager);
  void new ApproveBillUseCase(repo, txManager, unitOfWork, portRegistry);
  void new RecordSupplierPaymentUseCase(repo, txManager, unitOfWork);
  void new CreateSupplierReturnUseCase(repo, txManager);
  void new ApproveSupplierReturnUseCase(repo, txManager, unitOfWork, portRegistry);
}, 180_000);

beforeEach(async () =>
  ownerSql.unsafe(
    'TRUNCATE TABLE pur_suppliers, pur_vendor_ledger, pur_requisitions, pur_requisition_lines, pur_purchase_orders, pur_po_lines, pur_grns, pur_grn_lines, pur_bills, pur_bill_lines, pur_supplier_payments, pur_payment_allocations, pur_supplier_returns, pur_supplier_return_lines, pur_org_settings CASCADE',
  ),
);

afterAll(async () => {
  if (appSql) await appSql.end();
  if (ownerSql) await ownerSql.end();
  if (container) await container.stop();
});

/** Seed a supplier + approved PO + bill in org B directly (bypasses RLS). */
async function seedOrgB(): Promise<{ supplierId: string; poId: string; billId: string }> {
  const supplierId = randomUUID();
  const poId = randomUUID();
  const poLineId = randomUUID();
  const billId = randomUUID();
  await ownerSql`
    INSERT INTO pur_suppliers (id, organization_id, code, name, tax_id, currency)
    VALUES (${supplierId}, ${ORG_B_ID}, 'SUP-B-1', 'Org B Supplier', 'B-TAX', 'USD')
  `;
  await ownerSql`
    INSERT INTO pur_purchase_orders (id, organization_id, number, supplier_id, status, currency, subtotal_minor, total_minor)
    VALUES (${poId}, ${ORG_B_ID}, 'PO-B-1', ${supplierId}, 'approved', 'USD', 1000, 1000)
  `;
  await ownerSql`
    INSERT INTO pur_po_lines (id, organization_id, po_id, item_name_snapshot, quantity, unit_cost_minor, line_total_minor)
    VALUES (${poLineId}, ${ORG_B_ID}, ${poId}, 'B Item', 1, 1000, 1000)
  `;
  await ownerSql`
    INSERT INTO pur_bills (id, organization_id, number, supplier_id, status, currency, subtotal_minor, total_minor, paid_minor)
    VALUES (${billId}, ${ORG_B_ID}, 'BILL-B-1', ${supplierId}, 'approved', 'USD', 1000, 1000, 0)
  `;
  return { supplierId, poId, billId };
}

/** Seed an org A supplier via the use case; returns its id. */
async function seedSupplierA(): Promise<string> {
  const result = await TenantContext.run(orgAContext, () =>
    createSupplier.execute({ name: 'Org A Supplier', taxId: 'A-TAX' }),
  );
  return result.supplierId;
}

describe('purchasing tenant isolation', () => {
  it('TEN-1: org A cannot read an org B supplier', async () => {
    const { supplierId } = await seedOrgB();
    const result = await TenantContext.run(orgAContext, () =>
      txManager.run((tx) => repo.findSupplierById(supplierId, tx)),
    );
    expect(result).toBeUndefined();
  });

  it('TEN-1: org A cannot read an org B purchase order', async () => {
    const { poId } = await seedOrgB();
    const result = await TenantContext.run(orgAContext, () =>
      txManager.run((tx) => repo.findPurchaseOrderById(poId, tx)),
    );
    expect(result).toBeUndefined();
  });

  it('TEN-1: org A cannot read an org B bill', async () => {
    const { billId } = await seedOrgB();
    const result = await TenantContext.run(orgAContext, () => txManager.run((tx) => repo.findBillById(billId, tx)));
    expect(result).toBeUndefined();
  });

  it('TEN-1: org A supplier/PO/bill lists exclude org B rows', async () => {
    await seedOrgB();
    const suppliers = await TenantContext.run(orgAContext, () => listSuppliers.execute({}));
    expect(suppliers.items).toHaveLength(0);
    expect(suppliers.total).toBe(0);
    const pos = await TenantContext.run(orgAContext, () => listPos.execute({}));
    expect(pos.items).toHaveLength(0);
    const bills = await TenantContext.run(orgAContext, () => listBills.execute({}));
    expect(bills.items).toHaveLength(0);
  });

  it('TEN-1: org A cannot update an org B supplier (PURCHASING_SUPPLIER_NOT_FOUND)', async () => {
    const { supplierId } = await seedOrgB();
    await expect(
      TenantContext.run(orgAContext, () => updateSupplier.execute({ supplierId, name: 'Hijacked' })),
    ).rejects.toMatchObject({ message: 'PURCHASING_SUPPLIER_NOT_FOUND' });
  });

  it('TEN-1: org A cannot create a PO for an org B supplier', async () => {
    const { supplierId } = await seedOrgB();
    await expect(
      TenantContext.run(orgAContext, () =>
        createPo.execute({
          supplierId,
          currency: 'USD',
          lines: [{ itemNameSnapshot: 'Item', unitCostMinor: '100' }],
        }),
      ),
    ).rejects.toMatchObject({ message: 'PURCHASING_SUPPLIER_NOT_FOUND' });
  });

  it('TEN-2: an injected organizationId cannot override the session organization', async () => {
    await seedSupplierA();
    const input = {
      name: 'Injected Org Supplier',
      taxId: 'INJ-TAX',
      // Passed as an extra field so TS excess-property checks do not apply —
      // the use case ignores it; RLS + TenantContext decide the real org (TEN-2).
      organizationId: ORG_B_ID,
    };
    const result = await TenantContext.run(orgAContext, () => createSupplier.execute(input));
    const rows = await ownerSql`SELECT organization_id FROM pur_suppliers WHERE id = ${result.supplierId}`;
    expect(rows[0]?.organization_id).toBe(ORG_A_ID);
  });

  it('TEN-3: no tenant context exposes zero purchasing rows', async () => {
    await seedOrgB();
    // NO TenantContext: RLS is unset, so every read fails closed.
    await withoutTenantContext(async () => {
      const suppliers = await db.execute(sql`SELECT id FROM pur_suppliers`);
      expect(suppliers).toHaveLength(0);
      const pos = await db.execute(sql`SELECT id FROM pur_purchase_orders`);
      expect(pos).toHaveLength(0);
      const bills = await db.execute(sql`SELECT id FROM pur_bills`);
      expect(bills).toHaveLength(0);
    });
  });

  it('AUTHZ-6: an OWNER receives MODULE_NOT_ENTITLED when purchasing is disabled', async () => {
    const store = new InMemoryEntitlementStore();
    await store.upsert({
      organizationId: ORG_A_ID,
      moduleKey: 'purchasing',
      state: 'disabled',
      trialStartedAt: null,
      trialEndsAt: null,
      activatedAt: null,
      disabledAt: '2026-01-01T00:00:00Z',
      purgeAfter: null,
      features: [],
    });
    const guard = new EntitlementGuard(new Reflector(), new EntitlementService(store));
    await expect(guard.canActivate(guardContext(['purchasing:supplier:read']))).rejects.toThrow('MODULE_NOT_ENTITLED');
  });

  it('AUTHZ-5: an entitled user without purchasing:supplier:write is denied', () => {
    const guard = new PermissionGuard(new Reflector());
    // `createSupplierRoute` requires purchasing:supplier:write; the user holds
    // only supplier:read, so the guard must deny (AUTHZ-5).
    expect(() => guard.canActivate(createGuardContext(['purchasing:supplier:read']))).toThrow(ForbiddenException);
  });
});

/**
 * Guard execution context for the AUTHZ-5/6 checks — `getHandler` points at a
 * REAL controller route method so the guards read @RequiresModule /
 * @RequiresPermission metadata off it.
 */
function guardContext(permissions: string[]): Parameters<EntitlementGuard['canActivate']>[0] {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user: { sub: USER_A_ID, organizationId: ORG_A_ID, roles: ['OWNER'], permissions } }),
    }),
    getHandler: () => PurchasingController.prototype.listSuppliersRoute,
    getClass: () => PurchasingController,
  } as never;
}

/** Guard context pointed at the CREATE route (requires supplier:write). */
function createGuardContext(permissions: string[]): Parameters<PermissionGuard['canActivate']>[0] {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user: { sub: USER_A_ID, organizationId: ORG_A_ID, roles: ['OWNER'], permissions } }),
    }),
    getHandler: () => PurchasingController.prototype.createSupplierRoute,
    getClass: () => PurchasingController,
  } as never;
}
