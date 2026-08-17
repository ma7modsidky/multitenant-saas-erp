/**
 * POS application-layer integration tests — real Postgres, RLS active.
 *
 * Exercises the POS use cases end-to-end against the real POS schema
 * (apps/api/src/modules/pos/db/migrations) with the `modubiz_app` role,
 * consuming the real InventoryStockPort (Level 3) for transactional stock:
 *   - POS-2: a second open shift on the same register is rejected.
 *   - POS-3: checkout without an open shift fails.
 *   - POS-5/POS-6: closing computes expected cash + variance and locks the shift.
 *   - POS-9: receipt numbers are sequential and gap-free; a failed checkout
 *     does not consume a number.
 *   - POS-15: stock deduction happens in the SAME transaction as the sale; an
 *     over-available checkout fails the whole sale.
 *   - POS-20/21/22: refunds reference the completed sale, respect the
 *     cumulative caps, and restock per line (return vs write_off movement).
 *   - POS-23: a refund requires an open shift and a reason code.
 *   - POS-26/27/29: offline sync is idempotent (replay returns the original),
 *     the server assigns the authoritative receipt, and every attempt lands in
 *     pos_sync_log (accepted / duplicate / rejected — POS-28).
 *   - POS-13: pos_payments is append-only (trigger rejects UPDATE/DELETE).
 *   - OPS-3: events are published only after commit.
 *
 * @see PLAN.md §6.5 — Application layer (tests)
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
import { PortRegistry } from '../../apps/api/src/core/ports/port-registry.js';
import { TenantContext, type TenantContextData } from '../../apps/api/src/core/tenancy/tenant-context.js';
import { INVENTORY_STOCK_PORT } from '../../packages/contracts/src/index.js';
import { applyAllMigrations } from './helpers/migrations.js';
import { DrizzleOrganizationRepository } from '../../apps/api/src/platform/organizations/infrastructure/repositories/drizzle-organization.repository.js';
import { DrizzleRoleRepository } from '../../apps/api/src/platform/roles/infrastructure/repositories/drizzle-role.repository.js';
import { DrizzleMembershipRepository } from '../../apps/api/src/platform/memberships/infrastructure/repositories/drizzle-membership.repository.js';
import { CreateOrganizationUseCase } from '../../apps/api/src/platform/organizations/application/create-organization.use-case.js';
import { DrizzleInventoryRepository } from '../../apps/api/src/modules/inventory/infrastructure/repositories/drizzle-inventory.repository.js';
import { InventoryStockPortImpl } from '../../apps/api/src/modules/inventory/infrastructure/ports/inventory-stock.port.impl.js';
import { CreateProductUseCase } from '../../apps/api/src/modules/inventory/application/create-product.use-case.js';
import { ReceiveStockUseCase } from '../../apps/api/src/modules/inventory/application/receive-stock.use-case.js';
import { DrizzlePosRepository } from '../../apps/api/src/modules/pos/infrastructure/repositories/drizzle-pos.repository.js';
import {
  CheckoutUseCase,
  CloseShiftUseCase,
  CreateRegisterUseCase,
  GetSaleUseCase,
  ListSalesUseCase,
  ListShiftsUseCase,
  OpenShiftUseCase,
  ProcessRefundUseCase,
  SyncOfflineSaleUseCase,
} from '../../apps/api/src/modules/pos/application/index.js';
import { SALE_STATUS } from '../../apps/api/src/modules/pos/domain/index.js';
import {
  inventoryStockMovementRecordedV1Schema,
  posSaleCompletedV1Schema,
  posSaleRefundedV1Schema,
  posShiftOpenedV1Schema,
  posShiftClosedV1Schema,
} from '../../packages/contracts/src/events/index.js';

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

// Recording EventBus — mirrors the CRM/inventory suites (OPS-3 checks).
const observedEvents: Array<{ name: string; payload: Record<string, unknown> }> = [];
const recordingEventBus = {
  publish: async (e: { name: string; payload: Record<string, unknown> }) => {
    observedEvents.push({ name: e.name, payload: e.payload });
  },
  publishAll: async (events: Array<{ name: string; payload: Record<string, unknown> }>) => {
    for (const e of events) observedEvents.push({ name: e.name, payload: e.payload });
  },
  on: () => {},
  off: () => {},
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

  // Create the non-owner app role that RLS applies to (mirrors docker init.sql).
  await ownerSql.unsafe(`
    CREATE ROLE ${APP_ROLE} LOGIN PASSWORD '${APP_PASSWORD}' NOBYPASSRLS;
    GRANT USAGE ON SCHEMA public TO ${APP_ROLE};
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${APP_ROLE};
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      GRANT USAGE, SELECT ON SEQUENCES TO ${APP_ROLE};
  `);

  // Apply the real core + module migrations as the owner role (POS included).
  await applyAllMigrations(ownerConnString);

  await ownerSql.unsafe(`
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${APP_ROLE};
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${APP_ROLE};
  `);

  // A real user row is required (core_organizations.created_by FK).
  ownerUserId = randomUUID();
  await ownerSql`
    INSERT INTO core_users (id, email, password_hash, name)
    VALUES (${ownerUserId}, ${'pos-owner@example.com'}, ${'hash'}, ${'Pos Owner'})
  `;

  db = drizzle(postgres(appConnString), { logger: false });
});

afterAll(async () => {
  if (ownerSql) await ownerSql.end();
  if (container) await container.stop();
});

/** Create an org as the owner (mirrors memberships suite seeding). */
async function createOrgForOwner(): Promise<{ orgId: string }> {
  const orgRepo = new DrizzleOrganizationRepository(db);
  const roleRepo = new DrizzleRoleRepository(db);
  const membershipRepo = new DrizzleMembershipRepository(db);
  const txManager = new TransactionManager(db);
  const createUseCase = new CreateOrganizationUseCase(orgRepo, roleRepo, membershipRepo, txManager);

  const slug = `pos-${randomUUID().slice(0, 8)}`;

  const result = await TenantContext.run({ ...ownerContext, userId: ownerUserId }, () =>
    createUseCase.execute({
      name: `Pos Org ${slug}`,
      slug,
      countryCode: 'US',
      baseCurrency: 'USD',
    }),
  );

  return { orgId: result.organization.id };
}

/** numeric(18,4) reads back as '10.0000' — plain-decimal helper for asserts. */
function plain(value: unknown): string {
  const raw = String(value ?? '');
  if (!raw.includes('.')) return raw;
  return raw.replace(/\.?0+$/, '') || '0';
}

/** Inventory repos + services (fresh per test). */
function buildInv() {
  const repo = new DrizzleInventoryRepository(db);
  const txManager = new TransactionManager(db);
  const unitOfWork = new UnitOfWork(recordingEventBus as never);
  return { repo, txManager, unitOfWork };
}

/**
 * Resolve the org's default warehouse id. The first receipt lazily creates it,
 * so POS tests seed stock before creating the register (POS-1 binds it).
 */
async function defaultWarehouseId(orgId: string): Promise<string> {
  const { repo, txManager } = buildInv();
  return TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
    txManager.run(async (tx) => {
      const warehouses = await repo.listWarehouses(tx);
      const found = warehouses.find((w) => w.isDefault);
      if (!found) throw new Error(`No default warehouse for org ${orgId}`);
      return found.id;
    }),
  );
}

/** Create a product with a variant and receive stock; returns ids + the warehouse. */
async function seedInventory(
  orgId: string,
  opts: { name?: string; sku?: string; receiveQuantity?: string } = {},
): Promise<{ variantId: string; warehouseId: string }> {
  const { repo, txManager, unitOfWork } = buildInv();
  const create = new CreateProductUseCase(repo, txManager, unitOfWork);
  const { variantId } = await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
    create.execute({
      nameI18n: { en: opts.name ?? 'Espresso' },
      sku: opts.sku ?? 'POS-ESP-001',
      priceAmountMinor: '1000',
      priceCurrency: 'USD',
      costAmountMinor: '400',
      costCurrency: 'USD',
      reorderPoint: '5',
      reorderQuantity: '20',
    }),
  );

  const receive = new ReceiveStockUseCase(repo, txManager, unitOfWork);
  await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
    receive.execute({
      variantId,
      quantity: opts.receiveQuantity ?? '10',
      unitCostAmountMinor: '400',
      unitCostCurrency: 'USD',
      referenceType: 'purchase_order',
      referenceId: randomUUID(),
    }),
  );

  const warehouseId = await defaultWarehouseId(orgId);
  return { variantId, warehouseId };
}

/** POS repos + services + stock port (fresh per test). */
function buildPos(orgId: string) {
  const repo = new DrizzlePosRepository(db);
  const txManager = new TransactionManager(db);
  const unitOfWork = new UnitOfWork(recordingEventBus as never);

  // Level 3 port wiring (POS-15): the real inventory port joins the caller's
  // transaction via TransactionRef.
  const invRepo = new DrizzleInventoryRepository(db);
  const stockPort = new InventoryStockPortImpl(invRepo, txManager);
  const portRegistry = new PortRegistry();
  portRegistry.register(INVENTORY_STOCK_PORT, stockPort);

  return { repo, txManager, unitOfWork, portRegistry, stockPort };
}

/** Create a register bound to the org's default warehouse (POS-1). */
async function createRegister(orgId: string, warehouseId: string, code = 'TILL-1'): Promise<string> {
  const { repo, txManager } = buildPos(orgId);
  const create = new CreateRegisterUseCase(repo, txManager);
  const { id } = await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
    create.execute({ name: `Till ${code}`, code, warehouseId }),
  );
  return id;
}

/** Open a shift with a float (POS-4). */
async function openShift(orgId: string, registerId: string, floatMinor = '2000'): Promise<string> {
  const { repo, txManager, unitOfWork } = buildPos(orgId);
  const open = new OpenShiftUseCase(repo, txManager, unitOfWork);
  const { shiftId } = await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
    open.execute({ registerId, openingFloatAmountMinor: floatMinor, currency: 'USD' }),
  );
  return shiftId;
}

/** Checkout one line of qty at a unit price, cash exact (POS-10). */
async function checkout(
  orgId: string,
  registerId: string,
  variantId: string,
  opts: { qty?: string; unitPriceMinor?: string; taxRateBp?: number; idempotencyKey?: string } = {},
): Promise<{ saleId: string; receiptNumber: string }> {
  const { repo, txManager, unitOfWork, portRegistry } = buildPos(orgId);
  const checkoutUseCase = new CheckoutUseCase(repo, txManager, unitOfWork, portRegistry);
  const qty = opts.qty ?? '1';
  const unitPrice = opts.unitPriceMinor ?? '1000';
  const taxRateBp = opts.taxRateBp ?? 0;
  // Line total = unitPrice × qty (POS-12); tax per line at bp/10000 half-up (POS-17).
  const lineTotal = Number(unitPrice) * Number(qty);
  const tax = Math.floor((lineTotal * taxRateBp + 5000) / 10000);
  const total = lineTotal + tax;

  return TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
    checkoutUseCase.execute({
      registerId,
      currency: 'USD',
      locale: 'en',
      lines: [
        {
          variantId,
          sku: 'POS-ESP-001',
          nameI18n: { en: 'Espresso' },
          quantity: qty,
          unitPriceAmountMinor: unitPrice,
          lineDiscountAmountMinor: '0',
          taxRateBp,
          currency: 'USD',
        },
      ],
      payments: [
        {
          method: 'cash',
          amountMinor: String(total),
          currency: 'USD',
          tenderedAmountMinor: String(total),
          changeAmountMinor: '0',
        },
      ],
      ...(opts.idempotencyKey !== undefined ? { idempotencyKey: opts.idempotencyKey } : {}),
    }),
  );
}

describe('POS application layer (integration)', () => {
  it('POS-2: rejects opening a second shift on the same register', async () => {
    const { orgId } = await createOrgForOwner();
    const { variantId, warehouseId } = await seedInventory(orgId);
    const registerId = await createRegister(orgId, warehouseId);
    await openShift(orgId, registerId);

    const { repo, txManager, unitOfWork } = buildPos(orgId);
    const open = new OpenShiftUseCase(repo, txManager, unitOfWork);
    await expect(
      TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
        open.execute({ registerId, openingFloatAmountMinor: '0', currency: 'USD' }),
      ),
    ).rejects.toMatchObject({ code: 'POS_SHIFT_ALREADY_OPEN' });
  });

  it('POS-3: checkout without an open shift fails', async () => {
    const { orgId } = await createOrgForOwner();
    const { variantId, warehouseId } = await seedInventory(orgId);
    const registerId = await createRegister(orgId, warehouseId);

    await expect(checkout(orgId, registerId, variantId)).rejects.toMatchObject({ code: 'POS_NO_OPEN_SHIFT' });
  });

  it('POS-9: receipt numbers are sequential and gap-free per register', async () => {
    const { orgId } = await createOrgForOwner();
    const { variantId, warehouseId } = await seedInventory(orgId, { receiveQuantity: '30' });
    const registerId = await createRegister(orgId, warehouseId);
    await openShift(orgId, registerId);

    const first = await checkout(orgId, registerId, variantId);
    const second = await checkout(orgId, registerId, variantId);

    expect(first.receiptNumber).toBe('R-0001');
    expect(second.receiptNumber).toBe('R-0002');

    // A failed checkout must NOT consume a number (POS-9 "a failed sale does
    // not consume a number"). Over-available by 999 units → the whole sale
    // rolls back (POS-15) and the next receipt is still R-0003.
    const { repo, txManager, unitOfWork, portRegistry } = buildPos(orgId);
    const checkoutUseCase = new CheckoutUseCase(repo, txManager, unitOfWork, portRegistry);
    await expect(
      TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
        checkoutUseCase.execute({
          registerId,
          currency: 'USD',
          locale: 'en',
          lines: [
            {
              variantId,
              sku: 'POS-ESP-001',
              nameI18n: { en: 'Espresso' },
              quantity: '999',
              unitPriceAmountMinor: '1000',
              lineDiscountAmountMinor: '0',
              taxRateBp: 0,
              currency: 'USD',
            },
          ],
          payments: [
            {
              method: 'cash',
              amountMinor: '999000',
              currency: 'USD',
              tenderedAmountMinor: '999000',
              changeAmountMinor: '0',
            },
          ],
        }),
      ),
    ).rejects.toMatchObject({ code: 'INVENTORY_INSUFFICIENT_STOCK' });

    const third = await checkout(orgId, registerId, variantId);
    expect(third.receiptNumber).toBe('R-0003');
  });

  it('POS-15: stock deduction happens in the same transaction as sale creation', async () => {
    const { orgId } = await createOrgForOwner();
    const { variantId, warehouseId } = await seedInventory(orgId, { receiveQuantity: '10' });
    const registerId = await createRegister(orgId, warehouseId);
    await openShift(orgId, registerId);

    observedEvents.length = 0;
    const { saleId, receiptNumber } = await checkout(orgId, registerId, variantId, { qty: '2' });
    expect(receiptNumber).toBe('R-0001');

    // The sale row exists with the stock effect already applied.
    const [level] = await ownerSql`
      SELECT quantity_on_hand, quantity_reserved FROM inv_stock_levels WHERE variant_id = ${variantId}
    `;
    expect(plain(level?.quantity_on_hand)).toBe('8');
    expect(plain(level?.quantity_reserved)).toBe('0');

    // And a completed-sale event is published after commit (OPS-3).
    const event = observedEvents.find((e) => e.name === 'pos.sale.completed.v1');
    expect(event).toBeDefined();
    expect(posSaleCompletedV1Schema.parse(event?.payload)).toMatchObject({
      saleId,
      receiptNumber,
      totalAmountMinor: '2000',
      currency: 'USD',
      lineCount: 1,
      locale: 'en',
    });

    // ACC-15 (Phase 7.0): the sale movement reaches the GL stream too —
    // inventory registers movement_recorded on POS's unit of work, published
    // after commit alongside pos.sale.completed.
    const recorded = observedEvents.find((e) => e.name === 'inventory.stock.movement_recorded.v1');
    expect(recorded).toBeDefined();
    expect(inventoryStockMovementRecordedV1Schema.parse(recorded?.payload)).toMatchObject({
      variantId,
      movementType: 'sale',
      quantity: '-2',
      referenceType: 'pos_sale',
      referenceId: saleId,
    });
  });

  it('POS-15: if the stock operation fails, the entire sale fails', async () => {
    const { orgId } = await createOrgForOwner();
    const { variantId, warehouseId } = await seedInventory(orgId, { receiveQuantity: '3' });
    const registerId = await createRegister(orgId, warehouseId);
    await openShift(orgId, registerId);

    observedEvents.length = 0;
    await expect(checkout(orgId, registerId, variantId, { qty: '5' })).rejects.toMatchObject({
      code: 'INVENTORY_INSUFFICIENT_STOCK',
    });

    // No sale row, no payment row, no receipt consumed, no event.
    const [saleCount] = await ownerSql`SELECT count(*)::int AS n FROM pos_sales WHERE organization_id = ${orgId}`;
    expect(saleCount?.n).toBe(0);
    const [paymentCount] = await ownerSql`SELECT count(*)::int AS n FROM pos_payments WHERE organization_id = ${orgId}`;
    expect(paymentCount?.n).toBe(0);
    expect(observedEvents.find((e) => e.name === 'pos.sale.completed.v1')).toBeUndefined();

    // Stock untouched.
    const [level] = await ownerSql`
      SELECT quantity_on_hand FROM inv_stock_levels WHERE variant_id = ${variantId}
    `;
    expect(plain(level?.quantity_on_hand)).toBe('3');
  });

  it('POS-5/POS-6: closing computes expected cash + variance and locks the shift', async () => {
    const { orgId } = await createOrgForOwner();
    const { variantId, warehouseId } = await seedInventory(orgId, { receiveQuantity: '10' });
    const registerId = await createRegister(orgId, warehouseId);
    const shiftId = await openShift(orgId, registerId, '2000');

    // One cash sale of 1000.
    await checkout(orgId, registerId, variantId, { unitPriceMinor: '1000' });

    observedEvents.length = 0;
    const { repo, txManager, unitOfWork } = buildPos(orgId);
    const close = new CloseShiftUseCase(repo, txManager, unitOfWork);
    const result = await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      close.execute({ shiftId, countedCashAmountMinor: '2500' }),
    );

    // POS-5: expected = 2000 float + 1000 cash sales − 0 refunds = 3000.
    expect(result.expectedCashAmountMinor).toBe('3000');
    // variance = counted − expected = 2500 − 3000 = −500 (shortage).
    expect(result.varianceAmountMinor).toBe('-500');

    const event = observedEvents.find((e) => e.name === 'pos.shift.closed.v1');
    expect(event).toBeDefined();
    expect(posShiftClosedV1Schema.parse(event?.payload)).toMatchObject({
      shiftId,
      expectedCashAmountMinor: '3000',
      countedCashAmountMinor: '2500',
      varianceAmountMinor: '-500',
    });

    // POS-6: a closed shift is immutable — closing again throws.
    await expect(
      TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
        close.execute({ shiftId, countedCashAmountMinor: '2500' }),
      ),
    ).rejects.toMatchObject({ code: 'POS_SHIFT_CLOSED_IMMUTABLE' });
  });

  it('POS-20/21/22/23: refund references the completed sale, caps cumulative refunds, restocks per line', async () => {
    const { orgId } = await createOrgForOwner();
    const { variantId, warehouseId } = await seedInventory(orgId, { receiveQuantity: '10' });
    const registerId = await createRegister(orgId, warehouseId);
    await openShift(orgId, registerId);

    // Sell 3 units (total 3000) so a partial refund has headroom.
    const { saleId } = await checkout(orgId, registerId, variantId, { qty: '3' });

    // Grab the ORIGINAL sale line id (the refund must reference it — POS-20/21).
    const { repo: posRepo, txManager } = buildPos(orgId);
    const getSale = new GetSaleUseCase(posRepo, txManager);
    const sale = await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      getSale.execute(saleId),
    );
    const saleLineId = sale.lines[0].id;

    // Refund 1 unit as restocked + 1 unit as damaged (write_off) — POS-22.
    observedEvents.length = 0;
    const { repo, txManager: tx2, unitOfWork, portRegistry } = buildPos(orgId);
    const refund = new ProcessRefundUseCase(repo, tx2, unitOfWork, portRegistry);
    const result = await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      refund.execute({
        originalSaleId: saleId,
        registerId,
        reasonCode: 'customer_return',
        currency: 'USD',
        lines: [
          { saleLineId, variantId, quantity: '1', restock: true, amountMinor: '1000', currency: 'USD' },
          { saleLineId, variantId, quantity: '1', restock: false, amountMinor: '1000', currency: 'USD' },
        ],
      }),
    );
    expect(result.amountMinor).toBe('2000');

    // POS-22: restocked → `return` movement (+1), damaged → `write_off` (−1).
    const [returned] = await ownerSql`
      SELECT quantity FROM inv_stock_movements
      WHERE reference_type = 'pos_refund' AND variant_id = ${variantId} AND type = 'return'
    `;
    expect(plain(returned?.quantity)).toBe('1');
    const [writtenOff] = await ownerSql`
      SELECT quantity FROM inv_stock_movements
      WHERE reference_type = 'pos_refund' AND variant_id = ${variantId} AND type = 'write_off'
    `;
    expect(plain(writtenOff?.quantity)).toBe('-1');

    // Net: 10 − 3 (sold) + 1 (returned) − 1 (written off) = 7.
    const [level] = await ownerSql`
      SELECT quantity_on_hand FROM inv_stock_levels WHERE variant_id = ${variantId}
    `;
    expect(plain(level?.quantity_on_hand)).toBe('7');

    // Sale flips to partially_refunded (2000 of 3000 refunded).
    const [saleRow] = await ownerSql`SELECT status FROM pos_sales WHERE id = ${saleId}`;
    expect(saleRow?.status).toBe(SALE_STATUS.PARTIALLY_REFUNDED);

    // POS-21: refunding the remaining 2 units (total would be 4000 > 3000) fails.
    await expect(
      TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
        refund.execute({
          originalSaleId: saleId,
          registerId,
          reasonCode: 'customer_return',
          currency: 'USD',
          lines: [
            { saleLineId, variantId, quantity: '1', restock: true, amountMinor: '1000', currency: 'USD' },
            { saleLineId, variantId, quantity: '1', restock: true, amountMinor: '1000', currency: 'USD' },
          ],
        }),
      ),
    ).rejects.toMatchObject({ code: 'POS_REFUND_EXCEEDS_SALE' });

    // Refunded event validated (POS-20 → POS-24 contract).
    const event = observedEvents.find((e) => e.name === 'pos.sale.refunded.v1');
    expect(event).toBeDefined();
    expect(posSaleRefundedV1Schema.parse(event?.payload)).toMatchObject({
      originalSaleId: saleId,
      refundedAmountMinor: '2000',
      currency: 'USD',
    });
  });

  it('POS-26/27/29: offline sync is idempotent and every attempt is recorded', async () => {
    const { orgId } = await createOrgForOwner();
    const { variantId, warehouseId } = await seedInventory(orgId, { receiveQuantity: '10' });
    const registerId = await createRegister(orgId, warehouseId);
    await openShift(orgId, registerId);

    const idempotencyKey = randomUUID();
    const buildSync = () => {
      const { repo, txManager, unitOfWork, portRegistry } = buildPos(orgId);
      return new SyncOfflineSaleUseCase(repo, txManager, unitOfWork, portRegistry);
    };

    observedEvents.length = 0;
    // First sync: accepted, server assigns the authoritative receipt.
    const first = await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      buildSync().execute({
        clientDeviceId: 'device-1',
        idempotencyKey,
        registerId,
        currency: 'USD',
        locale: 'en',
        soldAt: new Date().toISOString(),
        lines: [
          {
            variantId,
            sku: 'POS-ESP-001',
            nameI18n: { en: 'Espresso' },
            quantity: '2',
            unitPriceAmountMinor: '1000',
            lineDiscountAmountMinor: '0',
            taxRateBp: 0,
            currency: 'USD',
          },
        ],
        payments: [
          { method: 'cash', amountMinor: '2000', currency: 'USD', tenderedAmountMinor: '2000', changeAmountMinor: '0' },
        ],
      }),
    );
    expect(first.replay).toBe(false);
    expect(first.rejected).toBe(false);
    expect(first.receiptNumber).toBe('R-0001');

    // POS-26: the replay returns the SAME sale, never a duplicate.
    const replay = await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      buildSync().execute({
        clientDeviceId: 'device-1',
        idempotencyKey,
        registerId,
        currency: 'USD',
        locale: 'en',
        soldAt: new Date().toISOString(),
        lines: [
          {
            variantId,
            sku: 'POS-ESP-001',
            nameI18n: { en: 'Espresso' },
            quantity: '2',
            unitPriceAmountMinor: '1000',
            lineDiscountAmountMinor: '0',
            taxRateBp: 0,
            currency: 'USD',
          },
        ],
        payments: [
          { method: 'cash', amountMinor: '2000', currency: 'USD', tenderedAmountMinor: '2000', changeAmountMinor: '0' },
        ],
      }),
    );
    expect(replay.replay).toBe(true);
    expect(replay.saleId).toBe(first.saleId);
    expect(replay.receiptNumber).toBe(first.receiptNumber);

    // POS-29: one `accepted` and one `duplicate` row, same idempotency key.
    const logRows = await ownerSql`
      SELECT result, error_code, idempotency_key FROM pos_sync_log
      WHERE idempotency_key = ${idempotencyKey} ORDER BY received_at
    `;
    expect(logRows).toHaveLength(2);
    expect(logRows.map((r) => r.result).sort()).toEqual(['accepted', 'duplicate']);
    expect(logRows.every((r) => r.error_code === null)).toBe(true);

    // Stock deducted exactly once (2 units).
    const [level] = await ownerSql`
      SELECT quantity_on_hand FROM inv_stock_levels WHERE variant_id = ${variantId}
    `;
    expect(plain(level?.quantity_on_hand)).toBe('8');
  });

  it('POS-28/POS-29: an over-available sync is rejected and RECORDED in pos_sync_log', async () => {
    const { orgId } = await createOrgForOwner();
    // Only 3 units on hand, sync sells 5 — an oversold condition.
    const { variantId, warehouseId } = await seedInventory(orgId, { receiveQuantity: '3' });
    const registerId = await createRegister(orgId, warehouseId);
    await openShift(orgId, registerId);

    const idempotencyKey = randomUUID();
    const { repo, txManager, unitOfWork, portRegistry } = buildPos(orgId);
    const sync = new SyncOfflineSaleUseCase(repo, txManager, unitOfWork, portRegistry);

    const result = await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      sync.execute({
        clientDeviceId: 'device-1',
        idempotencyKey,
        registerId,
        currency: 'USD',
        locale: 'en',
        soldAt: new Date().toISOString(),
        lines: [
          {
            variantId,
            sku: 'POS-ESP-001',
            nameI18n: { en: 'Espresso' },
            quantity: '5',
            unitPriceAmountMinor: '1000',
            lineDiscountAmountMinor: '0',
            taxRateBp: 0,
            currency: 'USD',
          },
        ],
        payments: [
          { method: 'cash', amountMinor: '5000', currency: 'USD', tenderedAmountMinor: '5000', changeAmountMinor: '0' },
        ],
      }),
    );

    // POS-28: rejected, never a partial sale — and NO receipt number consumed.
    expect(result.rejected).toBe(true);
    expect(result.errorCode).toBe('INVENTORY_INSUFFICIENT_STOCK');
    expect(result.saleId).toBeNull();

    const [saleCount] = await ownerSql`SELECT count(*)::int AS n FROM pos_sales WHERE organization_id = ${orgId}`;
    expect(saleCount?.n).toBe(0);

    // POS-29: the attempt is recorded as `rejected`.
    const [logRow] = await ownerSql`
      SELECT result, error_code FROM pos_sync_log WHERE idempotency_key = ${idempotencyKey}
    `;
    expect(logRow?.result).toBe('rejected');
    expect(logRow?.error_code).toBe('INVENTORY_INSUFFICIENT_STOCK');

    // Stock untouched, and the next legitimate sync still gets R-0001.
    const [level] = await ownerSql`
      SELECT quantity_on_hand FROM inv_stock_levels WHERE variant_id = ${variantId}
    `;
    expect(plain(level?.quantity_on_hand)).toBe('3');

    const again = await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      sync.execute({
        clientDeviceId: 'device-1',
        idempotencyKey: randomUUID(),
        registerId,
        currency: 'USD',
        locale: 'en',
        soldAt: new Date().toISOString(),
        lines: [
          {
            variantId,
            sku: 'POS-ESP-001',
            nameI18n: { en: 'Espresso' },
            quantity: '1',
            unitPriceAmountMinor: '1000',
            lineDiscountAmountMinor: '0',
            taxRateBp: 0,
            currency: 'USD',
          },
        ],
        payments: [
          { method: 'cash', amountMinor: '1000', currency: 'USD', tenderedAmountMinor: '1000', changeAmountMinor: '0' },
        ],
      }),
    );
    expect(again.rejected).toBe(false);
    expect(again.receiptNumber).toBe('R-0001');
  });

  it('POS-15/POS-28: a multi-line rejected sync rolls back EARLIER lines stock effects too', async () => {
    const { orgId } = await createOrgForOwner();
    // Two products: one with 10 on hand, one with only 1 on hand.
    const { variantId: inStockVariant, warehouseId } = await seedInventory(orgId, {
      name: 'In Stock',
      sku: 'POS-INSTOCK-1',
      receiveQuantity: '10',
    });
    const { variantId: scarceVariant } = await seedInventory(orgId, {
      name: 'Scarce',
      sku: 'POS-SCARCE-1',
      receiveQuantity: '1',
    });
    const registerId = await createRegister(orgId, warehouseId);
    await openShift(orgId, registerId);

    const idempotencyKey = randomUUID();
    const { repo, txManager, unitOfWork, portRegistry } = buildPos(orgId);
    const sync = new SyncOfflineSaleUseCase(repo, txManager, unitOfWork, portRegistry);

    const result = await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      sync.execute({
        clientDeviceId: 'device-1',
        idempotencyKey,
        registerId,
        currency: 'USD',
        locale: 'en',
        soldAt: new Date().toISOString(),
        lines: [
          {
            variantId: inStockVariant,
            sku: 'POS-INSTOCK-1',
            nameI18n: { en: 'In Stock' },
            quantity: '2', // this line's reserve+commit succeeds first
            unitPriceAmountMinor: '1000',
            lineDiscountAmountMinor: '0',
            taxRateBp: 0,
            currency: 'USD',
          },
          {
            variantId: scarceVariant,
            sku: 'POS-SCARCE-1',
            nameI18n: { en: 'Scarce' },
            quantity: '5', // over-available → the whole sync rejects
            unitPriceAmountMinor: '1000',
            lineDiscountAmountMinor: '0',
            taxRateBp: 0,
            currency: 'USD',
          },
        ],
        payments: [
          { method: 'cash', amountMinor: '7000', currency: 'USD', tenderedAmountMinor: '7000', changeAmountMinor: '0' },
        ],
      }),
    );

    expect(result.rejected).toBe(true);
    expect(result.errorCode).toBe('INVENTORY_INSUFFICIENT_STOCK');

    // POS-15 atomicity in the rejected direction: line 1's stock deduction
    // (2 units) must NOT persist — the whole transaction rolled back.
    const [inStock] = await ownerSql`
      SELECT quantity_on_hand FROM inv_stock_levels WHERE variant_id = ${inStockVariant}
    `;
    expect(plain(inStock?.quantity_on_hand)).toBe('10');
    const [scarce] = await ownerSql`
      SELECT quantity_on_hand FROM inv_stock_levels WHERE variant_id = ${scarceVariant}
    `;
    expect(plain(scarce?.quantity_on_hand)).toBe('1');

    // POS-29: the attempt is still recorded as rejected — exactly one row (no
    // double-record from the two-phase rejection path).
    const logRows = await ownerSql`
      SELECT result, error_code FROM pos_sync_log WHERE idempotency_key = ${idempotencyKey}
    `;
    expect(logRows).toHaveLength(1);
    expect(logRows[0]?.result).toBe('rejected');
    expect(logRows[0]?.error_code).toBe('INVENTORY_INSUFFICIENT_STOCK');
  });

  it('POS-13: pos_payments is append-only (trigger rejects UPDATE/DELETE)', async () => {
    const { orgId } = await createOrgForOwner();
    const { variantId, warehouseId } = await seedInventory(orgId, { receiveQuantity: '5' });
    const registerId = await createRegister(orgId, warehouseId);
    await openShift(orgId, registerId);
    await checkout(orgId, registerId, variantId);

    const [payment] = await ownerSql`SELECT id, amount_minor FROM pos_payments LIMIT 1`;

    await expect(ownerSql`UPDATE pos_payments SET amount_minor = 0 WHERE id = ${payment?.id}`).rejects.toThrow();
    await expect(ownerSql`DELETE FROM pos_payments WHERE id = ${payment?.id}`).rejects.toThrow();

    const [stillThere] = await ownerSql`SELECT count(*)::int AS n FROM pos_payments WHERE id = ${payment?.id}`;
    expect(stillThere?.n).toBe(1);
  });

  it('OPS-3: shift-opened event is published after commit with the float', async () => {
    const { orgId } = await createOrgForOwner();
    const { warehouseId } = await seedInventory(orgId, { receiveQuantity: '1' });
    const registerId = await createRegister(orgId, warehouseId);

    observedEvents.length = 0;
    const shiftId = await openShift(orgId, registerId, '5000');

    const event = observedEvents.find((e) => e.name === 'pos.shift.opened.v1');
    expect(event).toBeDefined();
    expect(posShiftOpenedV1Schema.parse(event?.payload)).toMatchObject({
      shiftId,
      registerId,
      openingFloatAmountMinor: '5000',
      currency: 'USD',
    });
  });

  it('POS-4: the shifts list filters by opened_at date range and carries sales/refund aggregates', async () => {
    const { orgId } = await createOrgForOwner();
    const { variantId, warehouseId } = await seedInventory(orgId, { receiveQuantity: '10' });
    const registerId = await createRegister(orgId, warehouseId);
    const shiftId = await openShift(orgId, registerId);
    // One sale of 2 units at 1000 → total 2000 (so the aggregates are non-zero).
    await checkout(orgId, registerId, variantId, { qty: '2' });

    const { repo, txManager } = buildPos(orgId);
    const listShifts = new ListShiftsUseCase(repo, txManager);
    const list = (filter: Parameters<typeof listShifts.execute>[0] = {}) =>
      TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
        listShifts.execute(filter),
      );

    const today = new Date().toISOString().slice(0, 10);

    // Unfiltered: the shift is listed with its aggregates (POS-8 semantics).
    const all = await list();
    const shift = all.find((s) => s.id === shiftId);
    expect(shift).toBeDefined();
    expect(shift?.salesCount).toBe(1);
    expect(shift?.salesAmountMinor).toBe('2000');
    expect(shift?.refundsAmountMinor).toBe('0');

    // today → today: the shift opened today is included (toDate is inclusive).
    const inRange = await list({ fromDate: today, toDate: today });
    expect(inRange.map((s) => s.id)).toContain(shiftId);

    // A past or future range excludes it.
    const past = await list({ fromDate: '2020-01-01', toDate: '2020-01-31' });
    expect(past).toHaveLength(0);
    const future = await list({ fromDate: '2099-01-01', toDate: '2099-12-31' });
    expect(future).toHaveLength(0);
  });

  it('POS-9: the sales list filters by sold-at date range (inclusive toDate)', async () => {
    const { orgId } = await createOrgForOwner();
    const { variantId, warehouseId } = await seedInventory(orgId, { receiveQuantity: '10' });
    const registerId = await createRegister(orgId, warehouseId);
    await openShift(orgId, registerId);
    const { saleId } = await checkout(orgId, registerId, variantId);

    const { repo, txManager } = buildPos(orgId);
    const listSales = new ListSalesUseCase(repo, txManager);
    const list = (filter: Parameters<typeof listSales.execute>[0] = {}) =>
      TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
        listSales.execute(filter),
      );

    const today = new Date().toISOString().slice(0, 10);

    // Unfiltered: the sale is listed, and the page carries the exact Σ of the
    // matching set (1000 = the single $10.00 sale).
    const all = await list({ pageSize: 50 });
    expect(all.items.some((s) => s.id === saleId)).toBe(true);
    expect(all.totalAmountMinor).toBe('1000');
    // No refunds exist — the net-revenue refund Σ is 0.
    expect(all.refundsAmountMinor).toBe('0');

    // today → today: the sale sold today is included (toDate is inclusive).
    const inRange = await list({ fromDate: today, toDate: today });
    expect(inRange.items.map((s) => s.id)).toContain(saleId);
    expect(inRange.totalAmountMinor).toBe('1000');
    expect(inRange.refundsAmountMinor).toBe('0');

    // A past or future range excludes it — and the Σ is 0.
    const past = await list({ fromDate: '2020-01-01', toDate: '2020-01-31' });
    expect(past.items).toHaveLength(0);
    expect(past.totalAmountMinor).toBe('0');
    expect(past.refundsAmountMinor).toBe('0');
    const future = await list({ fromDate: '2099-01-01', toDate: '2099-12-31' });
    expect(future.items).toHaveLength(0);
    expect(future.totalAmountMinor).toBe('0');
    expect(future.refundsAmountMinor).toBe('0');
  });

  it('POS-13: the sales list statuses filter sums completed+partially_refunded and excludes voided', async () => {
    const { orgId } = await createOrgForOwner();
    const { variantId, warehouseId } = await seedInventory(orgId, { receiveQuantity: '20' });
    const registerId = await createRegister(orgId, warehouseId);
    await openShift(orgId, registerId);

    // A completed sale (1000) and a partially_refunded one (3000 − 1000 refund).
    const completed = await checkout(orgId, registerId, variantId);
    const { saleId: refundedId } = await checkout(orgId, registerId, variantId, { qty: '3' });

    // Grab the refunded sale's line id, then refund 1 unit (POS-20 → POS-21).
    const { repo: posRepo, txManager: getTx } = buildPos(orgId);
    const getSale = new GetSaleUseCase(posRepo, getTx);
    const sale = await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      getSale.execute(refundedId),
    );
    const saleLineId = sale.lines[0].id;

    const { repo, txManager: refundTx, unitOfWork, portRegistry } = buildPos(orgId);
    const refund = new ProcessRefundUseCase(repo, refundTx, unitOfWork, portRegistry);
    await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      refund.execute({
        originalSaleId: refundedId,
        registerId,
        reasonCode: 'customer_return',
        currency: 'USD',
        lines: [{ saleLineId, variantId, quantity: '1', restock: true, amountMinor: '1000', currency: 'USD' }],
      }),
    );

    const listSales = new ListSalesUseCase(repo, refundTx);
    const list = (filter: Parameters<typeof listSales.execute>[0] = {}) =>
      TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
        listSales.execute(filter),
      );

    // Revenue semantics: completed + partially_refunded only — BOTH sales count
    // and the exact Σ is their sale totals (4000 = 1000 + 3000; the refund is
    // a separate record, matching the shift-report sales total). The refund Σ
    // carries the 1000 refunded against the partially_refunded sale — so
    // Net Revenue = 4000 − 1000 = 3000.
    const today = new Date().toISOString().slice(0, 10);
    const revenue = await list({ statuses: ['completed', 'partially_refunded'], pageSize: 50 });
    expect(revenue.items.map((s) => s.id).sort()).toEqual([completed.saleId, refundedId].sort());
    expect(revenue.totalAmountMinor).toBe('4000');
    expect(revenue.refundsAmountMinor).toBe('1000');

    // The refund Σ honors the same inclusive date window (on refunded_at).
    const revenueToday = await list({
      statuses: ['completed', 'partially_refunded'],
      fromDate: today,
      toDate: today,
      pageSize: 50,
    });
    expect(revenueToday.totalAmountMinor).toBe('4000');
    expect(revenueToday.refundsAmountMinor).toBe('1000');

    // A past window excludes both the sales and the refund Σ.
    const past = await list({
      statuses: ['completed', 'partially_refunded'],
      fromDate: '2020-01-01',
      toDate: '2020-01-31',
      pageSize: 50,
    });
    expect(past.totalAmountMinor).toBe('0');
    expect(past.refundsAmountMinor).toBe('0');

    // A single-status filter narrows to that status only — and its refund Σ.
    const completedOnly = await list({ statuses: ['completed'], pageSize: 50 });
    expect(completedOnly.items.map((s) => s.id)).toEqual([completed.saleId]);
    expect(completedOnly.totalAmountMinor).toBe('1000');
    expect(completedOnly.refundsAmountMinor).toBe('0');

    // Voided sales never count toward revenue. (POS-14 forbids voiding a sale
    // with a captured payment via the app layer, so the status is flipped
    // directly — the read path only cares about the persisted status.)
    await ownerSql`UPDATE pos_sales SET status = 'voided' WHERE id = ${completed.saleId}`;

    const afterVoid = await list({ statuses: ['completed', 'partially_refunded'], pageSize: 50 });
    expect(afterVoid.items.map((s) => s.id)).toEqual([refundedId]);
    expect(afterVoid.totalAmountMinor).toBe('3000');
    // The refund stays in the Σ — its sale is still partially_refunded.
    expect(afterVoid.refundsAmountMinor).toBe('1000');

    // The voided-only filter still sees it (reports/audit need the row).
    const voided = await list({ statuses: ['voided'], pageSize: 50 });
    expect(voided.items.map((s) => s.id)).toEqual([completed.saleId]);
    expect(voided.totalAmountMinor).toBe('1000');
    // No refunds belong to a voided sale (POS-14) — the refund Σ is 0.
    expect(voided.refundsAmountMinor).toBe('0');
  });
});
