/**
 * InventoryMovementPort integration tests — real Postgres, RLS active
 * (Phase 7.0).
 *
 * Exercises the Level 3 movement port (INVENTORY_MOVEMENT_PORT) end-to-end
 * against the real inventory schema with the `modubiz_app` role:
 *   - PUR-4/INV-12: `receive` joins the caller's transaction, writes a
 *     `receipt` movement, updates the projection, and recalculates the moving
 *     average exactly.
 *   - ACC-14/INV-5: `issue` deducts stock against AVAILABLE; an over-issue
 *     throws INVENTORY_INSUFFICIENT_STOCK and fails the whole caller
 *     transaction (atomic — nothing persisted).
 *   - PUR-11: `returnToSupplier` removes stock, requires a reason code, and
 *     can never return more than is available.
 *   - PUR-9: `adjustCost` revalues on-hand (moving average) without changing
 *     quantity and is rejected on empty stock.
 *   - ACC-15: every port-created movement emits a schema-valid
 *     `inventory.stock.movement_recorded.v1` on the caller's collector.
 *   - TEN-1: a cross-org port call fails closed (VARIANT_NOT_FOUND).
 *   - INV-16: a retried receive with the same idempotency key never
 *     double-counts.
 *
 * @see PLAN.md §7.0.2 — Inventory: movement port + movement-recorded event
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
import type { TransactionRef } from '../../packages/contracts/src/ports/index.js';
import { applyAllMigrations } from './helpers/migrations.js';
import { DrizzleOrganizationRepository } from '../../apps/api/src/platform/organizations/infrastructure/repositories/drizzle-organization.repository.js';
import { DrizzleRoleRepository } from '../../apps/api/src/platform/roles/infrastructure/repositories/drizzle-role.repository.js';
import { DrizzleMembershipRepository } from '../../apps/api/src/platform/memberships/infrastructure/repositories/drizzle-membership.repository.js';
import { CreateOrganizationUseCase } from '../../apps/api/src/platform/organizations/application/create-organization.use-case.js';
import { DrizzleInventoryRepository } from '../../apps/api/src/modules/inventory/infrastructure/repositories/drizzle-inventory.repository.js';
import { InventoryMovementPortImpl } from '../../apps/api/src/modules/inventory/infrastructure/ports/inventory-movement.port.impl.js';
import { CreateProductUseCase } from '../../apps/api/src/modules/inventory/application/create-product.use-case.js';
import { INVENTORY_ERROR_CODE } from '../../apps/api/src/modules/inventory/domain/index.js';
import { inventoryStockMovementRecordedV1Schema } from '../../packages/contracts/src/events/index.js';
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

  // Core + module migrations (includes inventory 0004_movement_types.sql).
  await applyAllMigrations(ownerConnString);

  await ownerSql.unsafe(`
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${APP_ROLE};
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${APP_ROLE};
  `);

  ownerUserId = randomUUID();
  await ownerSql`
    INSERT INTO core_users (id, email, password_hash, name)
    VALUES (${ownerUserId}, ${'inv-movement-owner@example.com'}, ${'hash'}, ${'Inv Movement Owner'})
  `;

  db = drizzle(postgres(appConnString), { logger: false });
});

afterAll(async () => {
  if (ownerSql) await ownerSql.end();
  if (container) await container.stop();
});

/** Create an org as the owner (mirrors the inventory suite seeding). */
async function createOrgForOwner(): Promise<{ orgId: string }> {
  const orgRepo = new DrizzleOrganizationRepository(db);
  const roleRepo = new DrizzleRoleRepository(db);
  const membershipRepo = new DrizzleMembershipRepository(db);
  const txManager = new TransactionManager(db);
  const createUseCase = new CreateOrganizationUseCase(orgRepo, roleRepo, membershipRepo, txManager);

  const slug = `inv-mv-${randomUUID().slice(0, 8)}`;

  const result = await TenantContext.run({ ...ownerContext, userId: ownerUserId }, () =>
    createUseCase.execute({
      name: `Inv Movement Org ${slug}`,
      slug,
      countryCode: 'US',
      baseCurrency: 'USD',
    }),
  );

  return { orgId: result.organization.id };
}

/**
 * Fresh harness per test. The TransactionManager is shared by the port
 * implementation — `TransactionManager.ref()`/`resolveRef()` is instance-
 * scoped (a WeakMap), exactly like the single @Global instance at runtime.
 */
function buildPort() {
  const repo = new DrizzleInventoryRepository(db);
  const txManager = new TransactionManager(db);
  const movementPort = new InventoryMovementPortImpl(repo, txManager);
  return { repo, txManager, movementPort };
}

/**
 * Resolve the org's default warehouse id (created lazily by the first receipt).
 * Must run inside a TransactionManager transaction (RLS fail-closed).
 */
async function defaultWarehouseId(orgId: string): Promise<string> {
  const { repo, txManager } = buildPort();
  return TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
    txManager.run(async (tx) => {
      const warehouses = await repo.listWarehouses(tx);
      const found = warehouses.find((w) => w.isDefault);
      if (!found) throw new Error(`No default warehouse for org ${orgId}`);
      return found.id;
    }),
  );
}

/** numeric(18,4) reads back as '10.0000' — plain-decimal helper for asserts. */
function plain(value: unknown): string {
  const raw = String(value ?? '');
  if (!raw.includes('.')) return raw;
  return raw.replace(/\.?0+$/, '') || '0';
}

/** Create a product with a variant; returns both ids. */
async function createProduct(
  orgId: string,
  opts: { name: string; sku: string; costMinor?: string } = { name: 'Espresso', sku: 'ESP-001' },
): Promise<{ productId: string; variantId: string }> {
  const { repo, txManager } = buildPort();
  // Recording EventBus — mirrors the inventory suite (create emits product.created).
  const recordingEventBus = {
    publish: async () => {},
    publishAll: async () => {},
    on: () => {},
    off: () => {},
  } as never;
  const unitOfWork = new UnitOfWork(recordingEventBus);
  const create = new CreateProductUseCase(repo, txManager, unitOfWork);
  const { productId, variantId } = await TenantContext.run(
    { ...ownerContext, userId: ownerUserId, organizationId: orgId },
    () =>
      create.execute({
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

/**
 * Run one port call inside a tenant-bound tx, minting the TransactionRef from
 * the SAME harness's TransactionManager the port was built with (the ref must
 * resolve in the port impl's manager).
 */
function runInTx<T>(
  harness: ReturnType<typeof buildPort>,
  orgId: string,
  fn: (ref: TransactionRef) => Promise<T>,
): Promise<T> {
  return TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
    harness.txManager.run(async (tx) => fn(harness.txManager.ref(tx))),
  );
}

describe('inventory movement port (Phase 7.0, integration)', () => {
  it('PUR-4/INV-12: receive joins the caller tx, ups stock, recalcs moving average, emits movement_recorded', async () => {
    const { orgId } = await createOrgForOwner();
    const { variantId } = await createProduct(orgId, { name: 'Bean', sku: 'RCPT-1', costMinor: '400' });
    const h = buildPort();
    const referenceId = randomUUID();

    collectedEvents.length = 0;
    await runInTx(h, orgId, (ref) =>
      h.movementPort.receive(
        {
          lines: [{ variantId, quantity: '10', unitCostAmountMinor: '500', unitCostCurrency: 'USD' }],
          referenceType: 'purchase_receipt',
          referenceId,
        },
        ref,
        collector,
      ),
    );

    // Projection follows the ledger (INV-2).
    const [level] = await ownerSql`
      SELECT quantity_on_hand FROM inv_stock_levels WHERE variant_id = ${variantId}
    `;
    expect(plain(level?.quantity_on_hand)).toBe('10');

    // Moving average: (0×400 + 10×500) / 10 = 500 (INV-12).
    const [variant] = await ownerSql`
      SELECT cost_amount_minor FROM inv_product_variants WHERE id = ${variantId}
    `;
    expect(variant?.cost_amount_minor).toBe('500');

    // ACC-15: exactly one schema-valid movement_recorded, keyed on the movement.
    const recorded = collectedEvents.filter((e) => e.name === 'inventory.stock.movement_recorded.v1');
    expect(recorded).toHaveLength(1);
    const parsed = inventoryStockMovementRecordedV1Schema.parse(recorded[0]?.payload);
    expect(parsed).toMatchObject({
      variantId,
      movementType: 'receipt',
      quantity: '10',
      unitCostAmountMinor: '500',
      unitCostCurrency: 'USD',
      referenceType: 'purchase_receipt',
      referenceId,
    });
    expect(parsed.movementId).toBeTruthy();
  });

  it('INV-16: a retried receive with the same idempotency key never double-counts', async () => {
    const { orgId } = await createOrgForOwner();
    const { variantId } = await createProduct(orgId, { name: 'Idem', sku: 'IDEM-1' });
    const h = buildPort();
    const idempotencyKey = randomUUID();

    for (let i = 0; i < 2; i++) {
      await runInTx(h, orgId, (ref) =>
        h.movementPort.receive(
          {
            lines: [{ variantId, quantity: '7', unitCostAmountMinor: '500', unitCostCurrency: 'USD' }],
            referenceType: 'purchase_receipt',
            referenceId: randomUUID(),
            idempotencyKey,
          },
          ref,
          collector,
        ),
      );
    }

    const [count] = await ownerSql`
      SELECT COUNT(*)::int AS count FROM inv_stock_movements WHERE variant_id = ${variantId}
    `;
    expect(count?.count).toBe(1);

    const [level] = await ownerSql`
      SELECT quantity_on_hand FROM inv_stock_levels WHERE variant_id = ${variantId}
    `;
    expect(plain(level?.quantity_on_hand)).toBe('7');
  });

  it('ACC-14/INV-5: issue deducts stock and snapshots the current cost; an over-issue fails the whole tx', async () => {
    const { orgId } = await createOrgForOwner();
    const { variantId } = await createProduct(orgId, { name: 'Goods', sku: 'ISS-1', costMinor: '400' });
    const h = buildPort();

    // 10 in, then issue 4 against the invoice.
    await runInTx(h, orgId, (ref) =>
      h.movementPort.receive(
        {
          lines: [{ variantId, quantity: '10', unitCostAmountMinor: '400', unitCostCurrency: 'USD' }],
          referenceType: 'purchase_receipt',
          referenceId: randomUUID(),
        },
        ref,
        collector,
      ),
    );

    const invoiceId = randomUUID();
    await runInTx(h, orgId, (ref) =>
      h.movementPort.issue(
        {
          lines: [{ variantId, quantity: '4', unitCostAmountMinor: '400', unitCostCurrency: 'USD' }],
          referenceType: 'sales_invoice',
          referenceId: invoiceId,
        },
        ref,
        collector,
      ),
    );

    const [level] = await ownerSql`
      SELECT quantity_on_hand FROM inv_stock_levels WHERE variant_id = ${variantId}
    `;
    expect(plain(level?.quantity_on_hand)).toBe('6');

    // The issue movement carries the CURRENT moving-average cost for the GL's
    // COGS entry (cost never changes on outbound — INV-12).
    const [movement] = await ownerSql`
      SELECT type, quantity, unit_cost_amount_minor FROM inv_stock_movements
      WHERE reference_type = 'sales_invoice' AND reference_id = ${invoiceId}
    `;
    expect(movement?.type).toBe('sale');
    expect(plain(movement?.quantity)).toBe('-4');
    expect(movement?.unit_cost_amount_minor).toBe('400');

    // ACC-14: an over-issue (7 > 6 available) throws and rolls back the ENTIRE
    // caller transaction — no movement, no projection change.
    await expect(
      runInTx(h, orgId, (ref) =>
        h.movementPort.issue(
          {
            lines: [{ variantId, quantity: '7', unitCostAmountMinor: '400', unitCostCurrency: 'USD' }],
            referenceType: 'sales_invoice',
            referenceId: randomUUID(),
          },
          ref,
          collector,
        ),
      ),
    ).rejects.toMatchObject({ code: INVENTORY_ERROR_CODE.INSUFFICIENT_STOCK });

    const [after] = await ownerSql`
      SELECT quantity_on_hand FROM inv_stock_levels WHERE variant_id = ${variantId}
    `;
    expect(plain(after?.quantity_on_hand)).toBe('6');

    const [saleCount] = await ownerSql`
      SELECT COUNT(*)::int AS count FROM inv_stock_movements
      WHERE variant_id = ${variantId} AND type = 'sale'
    `;
    expect(saleCount?.count).toBe(1);
  });

  it('PUR-11: returnToSupplier removes stock, requires a reason, and respects availability', async () => {
    const { orgId } = await createOrgForOwner();
    const { variantId } = await createProduct(orgId, { name: 'Damaged', sku: 'RTS-1', costMinor: '400' });
    const h = buildPort();

    await runInTx(h, orgId, (ref) =>
      h.movementPort.receive(
        {
          lines: [{ variantId, quantity: '10', unitCostAmountMinor: '400', unitCostCurrency: 'USD' }],
          referenceType: 'purchase_receipt',
          referenceId: randomUUID(),
        },
        ref,
        collector,
      ),
    );

    // Missing reason → domain rejection (PUR-11).
    await expect(
      runInTx(h, orgId, (ref) =>
        h.movementPort.returnToSupplier(
          {
            lines: [{ variantId, quantity: '3' }],
            reasonCode: '',
            referenceType: 'supplier_return',
            referenceId: randomUUID(),
          },
          ref,
          collector,
        ),
      ),
    ).rejects.toMatchObject({ code: INVENTORY_ERROR_CODE.SUPPLIER_RETURN_REQUIRES_REASON });

    // A valid return removes stock and emits the movement.
    collectedEvents.length = 0;
    const returnId = randomUUID();
    await runInTx(h, orgId, (ref) =>
      h.movementPort.returnToSupplier(
        {
          lines: [{ variantId, quantity: '3' }],
          reasonCode: 'DAMAGED_GOODS',
          referenceType: 'supplier_return',
          referenceId: returnId,
        },
        ref,
        collector,
      ),
    );

    const [level] = await ownerSql`
      SELECT quantity_on_hand FROM inv_stock_levels WHERE variant_id = ${variantId}
    `;
    expect(plain(level?.quantity_on_hand)).toBe('7');

    const recorded = inventoryStockMovementRecordedV1Schema.parse(
      collectedEvents.find((e) => e.name === 'inventory.stock.movement_recorded.v1')?.payload,
    );
    expect(recorded).toMatchObject({
      movementType: 'supplier_return',
      quantity: '-3',
      reasonCode: 'DAMAGED_GOODS',
      referenceType: 'supplier_return',
      referenceId: returnId,
    });

    // You cannot return more than you still hold (INV-5 availability gate).
    await expect(
      runInTx(h, orgId, (ref) =>
        h.movementPort.returnToSupplier(
          {
            lines: [{ variantId, quantity: '999' }],
            reasonCode: 'DAMAGED_GOODS',
            referenceType: 'supplier_return',
            referenceId: randomUUID(),
          },
          ref,
          collector,
        ),
      ),
    ).rejects.toMatchObject({ code: INVENTORY_ERROR_CODE.INSUFFICIENT_STOCK });
  });

  it('PUR-9: adjustCost revalues on-hand without changing quantity; empty stock is rejected', async () => {
    const { orgId } = await createOrgForOwner();
    const { variantId } = await createProduct(orgId, { name: 'Costed', sku: 'CST-1', costMinor: '400' });
    const h = buildPort();

    await runInTx(h, orgId, (ref) =>
      h.movementPort.receive(
        {
          lines: [{ variantId, quantity: '10', unitCostAmountMinor: '400', unitCostCurrency: 'USD' }],
          referenceType: 'purchase_receipt',
          referenceId: randomUUID(),
        },
        ref,
        collector,
      ),
    );

    // The bill priced the receipt 5.00 (500 minor) BELOW the GRN cost → −500.
    collectedEvents.length = 0;
    const billId = randomUUID();
    await runInTx(h, orgId, (ref) =>
      h.movementPort.adjustCost(
        {
          variantId,
          costDeltaAmountMinor: '-500',
          currency: 'USD',
          referenceType: 'purchase_bill',
          referenceId: billId,
        },
        ref,
        collector,
      ),
    );

    // Moving average: (10×400 − 500) / 10 = 350; quantity untouched (INV-2).
    const [level] = await ownerSql`
      SELECT sl.quantity_on_hand, v.cost_amount_minor
      FROM inv_stock_levels sl JOIN inv_product_variants v ON v.id = sl.variant_id
      WHERE sl.variant_id = ${variantId}
    `;
    expect(plain(level?.quantity_on_hand)).toBe('10');
    expect(level?.cost_amount_minor).toBe('350');

    const [movement] = await ownerSql`
      SELECT type, quantity, unit_cost_amount_minor, unit_cost_currency FROM inv_stock_movements
      WHERE reference_type = 'purchase_bill' AND reference_id = ${billId}
    `;
    expect(movement?.type).toBe('cost_adjustment');
    expect(plain(movement?.quantity)).toBe('0');
    expect(movement?.unit_cost_amount_minor).toBe('-500');
    expect(movement?.unit_cost_currency).toBe('USD');

    // The zero-quantity movement still parses through the event schema.
    const recorded = inventoryStockMovementRecordedV1Schema.parse(
      collectedEvents.find((e) => e.name === 'inventory.stock.movement_recorded.v1')?.payload,
    );
    expect(recorded.movementType).toBe('cost_adjustment');
    expect(recorded.quantity).toBe('0');
    expect(recorded.unitCostAmountMinor).toBe('-500');

    // PUR-9: a cost adjustment on a pair with no stock is rejected.
    const { variantId: emptyId } = await createProduct(orgId, { name: 'Empty', sku: 'CST-2' });
    await expect(
      runInTx(h, orgId, (ref) =>
        h.movementPort.adjustCost(
          {
            variantId: emptyId,
            costDeltaAmountMinor: '500',
            currency: 'USD',
            referenceType: 'purchase_bill',
            referenceId: randomUUID(),
          },
          ref,
          collector,
        ),
      ),
    ).rejects.toMatchObject({ code: INVENTORY_ERROR_CODE.COST_ADJUSTMENT_EMPTY_STOCK });
  });

  it('TEN-1: a cross-org port call fails closed (no rows leak through RLS)', async () => {
    const { orgId: orgA } = await createOrgForOwner();
    const { variantId } = await createProduct(orgA, { name: 'Isolated', sku: 'ISO-1' });

    // Org B exists, but org A's variant is invisible to it.
    const { orgId: orgB } = await createOrgForOwner();
    const h = buildPort();
    await expect(
      runInTx(h, orgB, (ref) =>
        h.movementPort.receive(
          {
            lines: [{ variantId, quantity: '1', unitCostAmountMinor: '100', unitCostCurrency: 'USD' }],
            referenceType: 'purchase_receipt',
            referenceId: randomUUID(),
          },
          ref,
          collector,
        ),
      ),
    ).rejects.toMatchObject({ message: 'VARIANT_NOT_FOUND' });

    // Org A's ledger is untouched.
    const [count] = await ownerSql`
      SELECT COUNT(*)::int AS count FROM inv_stock_movements WHERE variant_id = ${variantId}
    `;
    expect(count?.count).toBe(0);
  });

  it('INV-1: port-created movements are append-only — the trigger blocks UPDATE/DELETE', async () => {
    const { orgId } = await createOrgForOwner();
    const { variantId } = await createProduct(orgId, { name: 'Ledger', sku: 'APT-1' });
    const h = buildPort();

    await runInTx(h, orgId, (ref) =>
      h.movementPort.receive(
        {
          lines: [{ variantId, quantity: '5', unitCostAmountMinor: '300', unitCostCurrency: 'USD' }],
          referenceType: 'purchase_receipt',
          referenceId: randomUUID(),
        },
        ref,
        collector,
      ),
    );

    const [movement] = await ownerSql`
      SELECT id FROM inv_stock_movements WHERE variant_id = ${variantId}
    `;
    await expect(
      ownerSql`UPDATE inv_stock_movements SET quantity = quantity + 1 WHERE id = ${movement?.id as string}`,
    ).rejects.toThrow(/append-only/i);
  });
});
