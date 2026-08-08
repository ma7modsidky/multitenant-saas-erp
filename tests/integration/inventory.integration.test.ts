/**
 * Inventory application-layer integration tests — real Postgres, RLS active.
 *
 * Exercises the inventory use cases end-to-end against the real inventory
 * schema (apps/api/src/modules/inventory/db/migrations) with the `modubiz_app`
 * role:
 *   - INV-10: a duplicate SKU is rejected; a retried receipt with the same
 *     idempotency key never double-counts (INV-16).
 *   - INV-2/INV-12: receipts write ledger rows and update the projection;
 *     the moving-average cost is recomputed exactly.
 *   - INV-5/INV-7/INV-8: reservations validate against *available* stock;
 *     held → committed deducts on-hand; held → released returns to available.
 *   - INV-9: a transfer between warehouses is atomic — two movements in one
 *     transaction.
 *   - INV-11: a variant with movement history archives, never hard-deletes.
 *   - INV-14: applying a stock count generates count_correction movements.
 *   - OPS-3: events are published only after commit.
 *
 * @see PLAN.md §5.5 — Application layer (tests)
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
import { applyAllMigrations } from './helpers/migrations.js';
import { DrizzleOrganizationRepository } from '../../apps/api/src/platform/organizations/infrastructure/repositories/drizzle-organization.repository.js';
import { DrizzleRoleRepository } from '../../apps/api/src/platform/roles/infrastructure/repositories/drizzle-role.repository.js';
import { DrizzleMembershipRepository } from '../../apps/api/src/platform/memberships/infrastructure/repositories/drizzle-membership.repository.js';
import { CreateOrganizationUseCase } from '../../apps/api/src/platform/organizations/application/create-organization.use-case.js';
import { DrizzleInventoryRepository } from '../../apps/api/src/modules/inventory/infrastructure/repositories/drizzle-inventory.repository.js';
import { InventoryStockPortImpl } from '../../apps/api/src/modules/inventory/infrastructure/ports/inventory-stock.port.impl.js';
import { CreateProductUseCase } from '../../apps/api/src/modules/inventory/application/create-product.use-case.js';
import { UpdateProductUseCase } from '../../apps/api/src/modules/inventory/application/update-product.use-case.js';
import { UpdateVariantUseCase } from '../../apps/api/src/modules/inventory/application/update-variant.use-case.js';
import { ArchiveProductUseCase } from '../../apps/api/src/modules/inventory/application/archive-product.use-case.js';
import { UnarchiveProductUseCase } from '../../apps/api/src/modules/inventory/application/unarchive-product.use-case.js';
import { UnarchiveVariantUseCase } from '../../apps/api/src/modules/inventory/application/unarchive-variant.use-case.js';
import { ReceiveStockUseCase } from '../../apps/api/src/modules/inventory/application/receive-stock.use-case.js';
import { AdjustStockUseCase } from '../../apps/api/src/modules/inventory/application/adjust-stock.use-case.js';
import { TransferStockUseCase } from '../../apps/api/src/modules/inventory/application/transfer-stock.use-case.js';
import { ReserveStockUseCase } from '../../apps/api/src/modules/inventory/application/reserve-stock.use-case.js';
import { CommitReservationUseCase } from '../../apps/api/src/modules/inventory/application/commit-reservation.use-case.js';
import { ReleaseReservationUseCase } from '../../apps/api/src/modules/inventory/application/release-reservation.use-case.js';
import { ApplyStockCountUseCase } from '../../apps/api/src/modules/inventory/application/apply-stock-count.use-case.js';
import { GetAvailabilityUseCase } from '../../apps/api/src/modules/inventory/application/get-availability.use-case.js';
import { GetProductUseCase } from '../../apps/api/src/modules/inventory/application/get-product.use-case.js';
import { AddVariantUseCase } from '../../apps/api/src/modules/inventory/application/add-variant.use-case.js';
import { ArchiveVariantUseCase } from '../../apps/api/src/modules/inventory/application/archive-variant.use-case.js';
import { CreateWarehouseUseCase } from '../../apps/api/src/modules/inventory/application/create-warehouse.use-case.js';
import { ListReservationsUseCase } from '../../apps/api/src/modules/inventory/application/list-reservations.use-case.js';
import { ListStockLevelsUseCase } from '../../apps/api/src/modules/inventory/application/list-stock-levels.use-case.js';
import { ListMovementsUseCase } from '../../apps/api/src/modules/inventory/application/list-movements.use-case.js';
import { ListProductsUseCase } from '../../apps/api/src/modules/inventory/application/list-products.use-case.js';
import { ListVariantsUseCase } from '../../apps/api/src/modules/inventory/application/list-variants.use-case.js';
import { ListStockCountsUseCase } from '../../apps/api/src/modules/inventory/application/list-stock-counts.use-case.js';
import { GetStockCountUseCase } from '../../apps/api/src/modules/inventory/application/get-stock-count.use-case.js';
import { STOCK_COUNT_STATUS } from '../../apps/api/src/modules/inventory/domain/index.js';
import {
  inventoryProductCreatedV1Schema,
  inventoryProductArchivedV1Schema,
  inventoryProductRestoredV1Schema,
  inventoryStockLevelChangedV1Schema,
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

// Recording EventBus — mirrors the CRM integration suite (OPS-3 checks).
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

  // Apply the real core + module migrations as the owner role.
  await applyAllMigrations(ownerConnString);

  await ownerSql.unsafe(`
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${APP_ROLE};
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${APP_ROLE};
  `);

  // A real user row is required (core_organizations.created_by FK).
  ownerUserId = randomUUID();
  await ownerSql`
    INSERT INTO core_users (id, email, password_hash, name)
    VALUES (${ownerUserId}, ${'inv-owner@example.com'}, ${'hash'}, ${'Inv Owner'})
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

  const slug = `inv-${randomUUID().slice(0, 8)}`;

  const result = await TenantContext.run({ ...ownerContext, userId: ownerUserId }, () =>
    createUseCase.execute({
      name: `Inv Org ${slug}`,
      slug,
      countryCode: 'US',
      baseCurrency: 'USD',
    }),
  );

  return { orgId: result.organization.id };
}

/** Inventory repos + core services, fresh per test (mirrors CRM suite). */
function buildInv() {
  const repo = new DrizzleInventoryRepository(db);
  const txManager = new TransactionManager(db);
  const unitOfWork = new UnitOfWork(recordingEventBus as never);
  return { repo, txManager, unitOfWork };
}

/**
 * Resolve the org's default warehouse id.
 *
 * Must run inside a TransactionManager transaction: RLS scopes by the
 * `app.organization_id` session variable that `SET LOCAL` sets inside
 * `txManager.run()` — a bare repo call outside a transaction sees zero rows
 * (fail-closed), exactly like the CRM suite's ownerSql verification reads.
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
  const { repo, txManager, unitOfWork } = buildInv();
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

describe('inventory application layer (integration)', () => {
  it('INV-10: rejects a duplicate SKU per organization', async () => {
    const { orgId } = await createOrgForOwner();
    const { repo, txManager, unitOfWork } = buildInv();
    const create = new CreateProductUseCase(repo, txManager, unitOfWork);

    await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      create.execute({
        nameI18n: { en: 'First' },
        sku: 'DUP-001',
        priceAmountMinor: '1000',
        priceCurrency: 'USD',
        costAmountMinor: '400',
        costCurrency: 'USD',
        reorderPoint: '5',
        reorderQuantity: '20',
      }),
    );

    await expect(
      TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
        create.execute({
          nameI18n: { en: 'Second' },
          sku: 'dup-001', // case-insensitive duplicate (INV-10)
          priceAmountMinor: '1000',
          priceCurrency: 'USD',
          costAmountMinor: '400',
          costCurrency: 'USD',
          reorderPoint: '5',
          reorderQuantity: '20',
        }),
      ),
    ).rejects.toMatchObject({ code: 'INVENTORY_VARIANT_DUPLICATE_SKU' });
  });

  it('INV-2/INV-12: receipt writes a ledger row, updates the projection, and recomputes the moving average', async () => {
    const { orgId } = await createOrgForOwner();
    const { variantId } = await createProduct(orgId, { name: 'Bean', sku: 'BEAN-1', costMinor: '400' });
    const { repo, txManager, unitOfWork } = buildInv();
    const receive = new ReceiveStockUseCase(repo, txManager, unitOfWork);

    observedEvents.length = 0;
    await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      receive.execute({
        variantId,
        quantity: '10',
        unitCostAmountMinor: '500',
        unitCostCurrency: 'USD',
        referenceType: 'purchase_order',
        referenceId: randomUUID(),
      }),
    );

    // The projection follows the ledger (INV-2).
    const [level] = await ownerSql`
      SELECT quantity_on_hand FROM inv_stock_levels WHERE variant_id = ${variantId}
    `;
    expect(plain(level?.quantity_on_hand)).toBe('10');

    // Moving average: (0×400 + 10×500) / 10 = 500 (INV-12).
    const [variant] = await ownerSql`
      SELECT cost_amount_minor, updated_by FROM inv_product_variants WHERE id = ${variantId}
    `;
    expect(variant?.cost_amount_minor).toBe('500');
    // The moving-average cost write stamps updated_by — the detail view's
    // "last edited by" stays accurate after a receipt.
    expect(variant?.updated_by).toBe(ownerUserId);

    // A stock.level_changed event is published after commit (OPS-3).
    const event = observedEvents.find((e) => e.name === 'inventory.stock.level_changed.v1');
    expect(event).toBeDefined();
    expect(inventoryStockLevelChangedV1Schema.parse(event?.payload)).toMatchObject({
      variantId,
      quantity: '10',
      quantityOnHand: '10',
      quantityReserved: '0',
    });

    // A second receipt recomputes: (10×500 + 10×400) / 20 = 450.
    await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      receive.execute({
        variantId,
        quantity: '10',
        unitCostAmountMinor: '400',
        unitCostCurrency: 'USD',
        referenceType: 'purchase_order',
        referenceId: randomUUID(),
      }),
    );
    const [after] = await ownerSql`
      SELECT quantity_on_hand, cost_amount_minor FROM inv_stock_levels sl
      JOIN inv_product_variants v ON v.id = sl.variant_id
      WHERE sl.variant_id = ${variantId}
    `;
    expect(plain(after?.quantity_on_hand)).toBe('20');
    expect(plain(after?.cost_amount_minor)).toBe('450');
  });

  it('INV-16: a retried receipt with the same idempotency key never double-counts', async () => {
    const { orgId } = await createOrgForOwner();
    const { variantId } = await createProduct(orgId, { name: 'Bean', sku: 'BEAN-16' });
    const { repo, txManager, unitOfWork } = buildInv();
    const receive = new ReceiveStockUseCase(repo, txManager, unitOfWork);
    const idempotencyKey = randomUUID();

    for (let i = 0; i < 3; i++) {
      await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
        receive.execute({
          variantId,
          quantity: '7',
          unitCostAmountMinor: '500',
          unitCostCurrency: 'USD',
          referenceType: 'purchase_order',
          referenceId: randomUUID(),
          idempotencyKey,
        }),
      );
    }

    const rows = await ownerSql`
      SELECT COUNT(*)::int AS count FROM inv_stock_movements WHERE variant_id = ${variantId}
    `;
    expect(rows[0]?.count).toBe(1);

    const [level] = await ownerSql`
      SELECT quantity_on_hand FROM inv_stock_levels WHERE variant_id = ${variantId}
    `;
    expect(plain(level?.quantity_on_hand)).toBe('7');
  });

  it('INV-1: the stock ledger is append-only — UPDATE and DELETE are blocked by the trigger', async () => {
    const { orgId } = await createOrgForOwner();
    const { variantId } = await createProduct(orgId, { name: 'Ledger', sku: 'LEDGER-1' });
    const { repo, txManager, unitOfWork } = buildInv();
    await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      new ReceiveStockUseCase(repo, txManager, unitOfWork).execute({
        variantId,
        quantity: '10',
        unitCostAmountMinor: '500',
        unitCostCurrency: 'USD',
        referenceType: 'purchase_order',
        referenceId: randomUUID(),
      }),
    );

    const [movement] = await ownerSql`
      SELECT id, quantity FROM inv_stock_movements WHERE variant_id = ${variantId}
    `;
    expect(movement?.id).toBeTruthy();

    // Trigger 0003_append_only.sql — same prevent_update_delete() function as
    // core_audit_log: corrections are new compensating rows, never edits.
    await expect(
      ownerSql`UPDATE inv_stock_movements SET quantity = quantity + 1 WHERE id = ${movement?.id as string}`,
    ).rejects.toThrow(/append-only/i);
    await expect(ownerSql`DELETE FROM inv_stock_movements WHERE id = ${movement?.id as string}`).rejects.toThrow(
      /append-only/i,
    );

    // The failed writes changed nothing — the ledger row is intact.
    const [after] = await ownerSql`SELECT quantity FROM inv_stock_movements WHERE id = ${movement?.id as string}`;
    expect(plain(after?.quantity)).toBe('10');
  });

  it('INV-5/INV-7/INV-8: reservations validate against available stock, commit deducts, release returns', async () => {
    const { orgId } = await createOrgForOwner();
    const { variantId } = await createProduct(orgId, { name: 'Cup', sku: 'CUP-1' });
    const { repo, txManager, unitOfWork } = buildInv();
    const receive = new ReceiveStockUseCase(repo, txManager, unitOfWork);
    const reserve = new ReserveStockUseCase(repo, txManager);
    const commit = new CommitReservationUseCase(repo, txManager, unitOfWork);
    const release = new ReleaseReservationUseCase(repo, txManager);
    const availability = new GetAvailabilityUseCase(repo, txManager);

    await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      receive.execute({
        variantId,
        quantity: '10',
        unitCostAmountMinor: '500',
        unitCostCurrency: 'USD',
        referenceType: 'purchase_order',
        referenceId: randomUUID(),
      }),
    );

    const warehouseId = await defaultWarehouseId(orgId);

    // Reserve 3 of 10 → available 7.
    const { reservationId } = await TenantContext.run(
      { ...ownerContext, userId: ownerUserId, organizationId: orgId },
      () =>
        reserve.execute({
          variantId,
          warehouseId,
          quantity: '3',
          referenceType: 'pos_sale',
          referenceId: randomUUID(),
        }),
    );

    // INV-5: a reserve of 8 exceeds the 7 available — rejected.
    await expect(
      TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
        reserve.execute({
          variantId,
          warehouseId,
          quantity: '8',
          referenceType: 'pos_sale',
          referenceId: randomUUID(),
        }),
      ),
    ).rejects.toMatchObject({ code: 'INVENTORY_INSUFFICIENT_STOCK' });

    // Committing deducts on-hand: 10 − 3 = 7, reserved 3 → 0.
    await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      commit.execute(reservationId),
    );
    const [afterCommit] = await ownerSql`
      SELECT quantity_on_hand, quantity_reserved FROM inv_stock_levels WHERE variant_id = ${variantId}
    `;
    expect(plain(afterCommit?.quantity_on_hand)).toBe('7');
    expect(plain(afterCommit?.quantity_reserved)).toBe('0');

    // A fresh hold of 2, then release → back to available (reserved 2 → 0).
    const { reservationId: heldId } = await TenantContext.run(
      { ...ownerContext, userId: ownerUserId, organizationId: orgId },
      () =>
        reserve.execute({
          variantId,
          warehouseId,
          quantity: '2',
          referenceType: 'pos_sale',
          referenceId: randomUUID(),
        }),
    );
    await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      release.execute(heldId),
    );
    const [afterRelease] = await ownerSql`
      SELECT quantity_reserved FROM inv_stock_levels WHERE variant_id = ${variantId}
    `;
    expect(plain(afterRelease?.quantity_reserved)).toBe('0');

    // GetAvailability reports the INV-5 formula (on-hand 7, available 7 now).
    const snapshots = await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      availability.execute({ variantIds: [variantId], warehouseId }),
    );
    expect(snapshots[0]).toMatchObject({
      variantId,
      quantityOnHand: '7',
      quantityReserved: '0',
      quantityAvailable: '7',
    });
  });

  it('INV-9: transfer between warehouses is atomic — two movements in one transaction', async () => {
    const { orgId } = await createOrgForOwner();
    const { variantId } = await createProduct(orgId, { name: 'Transfer', sku: 'TRF-1' });
    const { repo, txManager, unitOfWork } = buildInv();
    const receive = new ReceiveStockUseCase(repo, txManager, unitOfWork);
    const transfer = new TransferStockUseCase(repo, txManager);

    // The receipt lazily creates the org's default warehouse (A).
    await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      receive.execute({
        variantId,
        quantity: '10',
        unitCostAmountMinor: '500',
        unitCostCurrency: 'USD',
        referenceType: 'purchase_order',
        referenceId: randomUUID(),
      }),
    );

    // Resolve warehouse A now that the receipt created it.
    const warehouseId = await defaultWarehouseId(orgId);

    // Create a second warehouse as the owner (only one default per org).
    const [secondWarehouse] = await ownerSql`
      INSERT INTO inv_warehouses (organization_id, name, code, is_default, is_active)
      VALUES (${orgId}, 'Warehouse B', 'WH-B', false, true)
      RETURNING id
    `;

    // Move 4 of 10 from A to B.
    await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      transfer.execute({
        variantId,
        fromWarehouseId: warehouseId,
        toWarehouseId: secondWarehouse?.id as string,
        quantity: '4',
        referenceType: 'transfer_order',
        referenceId: randomUUID(),
      }),
    );

    const levels = await ownerSql`
      SELECT warehouse_id, quantity_on_hand FROM inv_stock_levels WHERE variant_id = ${variantId} ORDER BY quantity_on_hand
    `;
    const byWarehouse = Object.fromEntries(levels.map((l) => [l.warehouse_id, plain(l.quantity_on_hand)]));
    expect(byWarehouse[warehouseId]).toBe('6');
    expect(byWarehouse[secondWarehouse?.id as string]).toBe('4');

    // Atomicity: a transfer of more than available leaves everything untouched.
    await expect(
      TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
        transfer.execute({
          variantId,
          fromWarehouseId: warehouseId,
          toWarehouseId: secondWarehouse?.id as string,
          quantity: '999',
          referenceType: 'transfer_order',
          referenceId: randomUUID(),
        }),
      ),
    ).rejects.toMatchObject({ code: 'INVENTORY_INSUFFICIENT_STOCK' });

    const after = await ownerSql`
      SELECT quantity_on_hand FROM inv_stock_levels WHERE variant_id = ${variantId} AND warehouse_id = ${warehouseId}
    `;
    expect(plain(after[0]?.quantity_on_hand)).toBe('6');
  });

  it('INV-11: archiving a product soft-deletes every variant, never hard-deletes', async () => {
    const { orgId } = await createOrgForOwner();
    const { productId, variantId } = await createProduct(orgId, { name: 'Archive', sku: 'ARC-1' });
    const { repo, txManager, unitOfWork } = buildInv();
    const receive = new ReceiveStockUseCase(repo, txManager, unitOfWork);
    const archive = new ArchiveProductUseCase(repo, txManager, unitOfWork);
    const addVariant = new AddVariantUseCase(repo, txManager, unitOfWork);
    const listProducts = new ListProductsUseCase(repo, txManager);

    // A second variant without ledger rows — archiving covers it too.
    const { variantId: secondId } = await TenantContext.run(
      { ...ownerContext, userId: ownerUserId, organizationId: orgId },
      () =>
        addVariant.execute({
          productId,
          sku: 'ARC-2',
          priceAmountMinor: '1200',
          priceCurrency: 'USD',
          costAmountMinor: '500',
          costCurrency: 'USD',
          reorderPoint: '5',
          reorderQuantity: '10',
        }),
    );

    await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      receive.execute({
        variantId,
        quantity: '5',
        unitCostAmountMinor: '500',
        unitCostCurrency: 'USD',
        referenceType: 'purchase_order',
        referenceId: randomUUID(),
      }),
    );

    observedEvents.length = 0;
    await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      archive.execute(productId),
    );

    // Every variant soft-deleted; the ledger row is untouched (INV-1/INV-11).
    const rows = await ownerSql`
      SELECT is_active, deleted_at FROM inv_product_variants WHERE product_id = ${productId} ORDER BY created_at ASC
    `;
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row?.is_active).toBe(false);
      expect(row?.deleted_at).not.toBeNull();
    }

    const [movementCount] = await ownerSql`
      SELECT COUNT(*)::int AS count FROM inv_stock_movements WHERE variant_id = ${variantId}
    `;
    expect(movementCount?.count).toBe(1);

    // The product list now derives isActive=false → the archived filter finds it.
    const page = await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      listProducts.execute({ status: 'archived' }),
    );
    expect(page.items.some((p) => p.id === productId && p.isActive === false)).toBe(true);

    const archivedEvent = observedEvents.find((e) => e.name === 'inventory.product.archived.v1');
    expect(inventoryProductArchivedV1Schema.parse(archivedEvent?.payload)).toMatchObject({
      productId,
      variantIds: [variantId, secondId],
    });
  });

  it('update-product renames the product (catalog metadata only)', async () => {
    const { orgId } = await createOrgForOwner();
    const { productId } = await createProduct(orgId, { name: 'Old Name', sku: 'UPD-1' });
    const { repo, txManager } = buildInv();
    const update = new UpdateProductUseCase(repo, txManager);

    const result = await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      update.execute(productId, { nameI18n: { en: 'New Name' } }),
    );
    expect(result.productId).toBe(productId);
    expect(result.updatedAt).toBeTruthy();

    const [row] = await ownerSql`
      SELECT name_i18n, updated_at FROM inv_products WHERE id = ${productId}
    `;
    expect((row?.name_i18n as { en: string }).en).toBe('New Name');
    expect(row?.updated_at).not.toBeNull();

    // Unknown product → 404 (PRODUCT_NOT_FOUND).
    await expect(
      TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
        update.execute(randomUUID(), { nameI18n: { en: 'X' } }),
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', message: 'PRODUCT_NOT_FOUND' });
  });

  it('update-variant edits sellable fields and enforces INV-10 excluding self', async () => {
    const { orgId } = await createOrgForOwner();
    const { productId, variantId } = await createProduct(orgId, { name: 'Edit Me', sku: 'EDT-1' });
    await createProduct(orgId, { name: 'Other', sku: 'EDT-OTHER' });
    const { repo, txManager } = buildInv();
    const update = new UpdateVariantUseCase(repo, txManager);

    await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      update.execute(variantId, {
        sku: 'EDT-2',
        barcode: '1234',
        priceAmountMinor: '2000',
        priceCurrency: 'USD',
        costAmountMinor: '800',
        costCurrency: 'USD',
        reorderPoint: '7',
        reorderQuantity: '30',
      }),
    );

    const [row] = await ownerSql`
      SELECT sku, barcode, price_amount_minor, cost_amount_minor, reorder_point, reorder_quantity
      FROM inv_product_variants WHERE id = ${variantId}
    `;
    expect(row?.sku).toBe('EDT-2');
    expect(row?.barcode).toBe('1234');
    expect(plain(row?.price_amount_minor)).toBe('2000');
    expect(plain(row?.cost_amount_minor)).toBe('800');
    expect(plain(row?.reorder_point)).toBe('7');
    expect(plain(row?.reorder_quantity)).toBe('30');

    // INV-10: taking another product's SKU is rejected (case-insensitive).
    await expect(
      TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
        update.execute(variantId, { sku: 'edt-other' }),
      ),
    ).rejects.toMatchObject({ code: 'INVENTORY_VARIANT_DUPLICATE_SKU' });

    // Keeping your own SKU is always valid (self-exclusion).
    await expect(
      TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
        update.execute(variantId, { sku: 'EDT-2' }),
      ),
    ).resolves.toBeTruthy();

    // Audit trail: a second user's edit flips updated_by on the variant
    // while created_by stays with the original creator.
    const editorUserId = randomUUID();
    await ownerSql`
      INSERT INTO core_users (id, email, password_hash, name)
      VALUES (${editorUserId}, ${'inv-editor@example.com'}, ${'hash'}, ${'Inv Editor'})
    `;
    await TenantContext.run({ ...ownerContext, userId: editorUserId, organizationId: orgId }, () =>
      update.execute(variantId, { sku: 'EDT-3' }),
    );
    const getProduct = new GetProductUseCase(repo, txManager);
    const detail = await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      getProduct.execute(productId),
    );
    expect(detail.variants[0]).toMatchObject({
      id: variantId,
      createdByUserId: ownerUserId,
      updatedByUserId: editorUserId,
    });

    // Unknown variant → 404.
    await expect(
      TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
        update.execute(randomUUID(), { sku: 'X' }),
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', message: 'VARIANT_NOT_FOUND' });
  });

  it('INV-14: applying a stock count generates count_correction movements and locks the count', async () => {
    const { orgId } = await createOrgForOwner();
    const { variantId } = await createProduct(orgId, { name: 'Counted', sku: 'CNT-1' });
    const { repo, txManager, unitOfWork } = buildInv();
    const receive = new ReceiveStockUseCase(repo, txManager, unitOfWork);
    const applyCount = new ApplyStockCountUseCase(repo, txManager, unitOfWork);

    // The receipt lazily creates the default warehouse.
    await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      receive.execute({
        variantId,
        quantity: '10',
        unitCostAmountMinor: '500',
        unitCostCurrency: 'USD',
        referenceType: 'purchase_order',
        referenceId: randomUUID(),
      }),
    );
    const warehouseId = await defaultWarehouseId(orgId);

    // Draft count: expected 10, physically counted 8 → variance −2.
    // (The insert must run inside a TransactionManager tx so the RLS session
    // variables are set — a bare repo call fails closed.)
    const countId = randomUUID();
    await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      txManager.run((tx) =>
        repo.insertStockCount(
          {
            id: countId,
            organizationId: orgId,
            warehouseId,
            status: STOCK_COUNT_STATUS.DRAFT,
            countedAt: null,
            countedBy: null,
            notes: null,
            lines: [{ id: randomUUID(), variantId, expectedQuantity: '10', countedQuantity: '8', variance: '-2' }],
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          tx,
        ),
      ),
    );

    await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      applyCount.execute(countId),
    );

    // Locked + correction movement written (10 → 8).
    const [countRow] = await ownerSql`
      SELECT status FROM inv_stock_counts WHERE id = ${countId}
    `;
    expect(countRow?.status).toBe('applied');

    const [correction] = await ownerSql`
      SELECT type, quantity FROM inv_stock_movements WHERE variant_id = ${variantId} AND type = 'count_correction'
    `;
    expect(correction?.type).toBe('count_correction');
    expect(plain(correction?.quantity)).toBe('-2');

    const [level] = await ownerSql`
      SELECT quantity_on_hand FROM inv_stock_levels WHERE variant_id = ${variantId}
    `;
    expect(plain(level?.quantity_on_hand)).toBe('8');

    // Applying again is rejected — an applied count is immutable (INV-14).
    const before = await ownerSql`
      SELECT COUNT(*)::int AS count FROM inv_stock_movements WHERE variant_id = ${variantId}
    `;
    await expect(
      TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
        applyCount.execute(countId),
      ),
    ).rejects.toMatchObject({ code: 'INVENTORY_STOCK_COUNT_APPLIED_IMMUTABLE' });
    const after = await ownerSql`
      SELECT COUNT(*)::int AS count FROM inv_stock_movements WHERE variant_id = ${variantId}
    `;
    expect(after[0]?.count).toBe(before[0]?.count);
  });

  it('INV-4: an adjustment without a reason code is rejected', async () => {
    const { orgId } = await createOrgForOwner();
    const { variantId } = await createProduct(orgId, { name: 'Adjust', sku: 'ADJ-1' });
    const { repo, txManager, unitOfWork } = buildInv();
    const adjust = new AdjustStockUseCase(repo, txManager, unitOfWork);

    await expect(
      TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
        adjust.execute({
          variantId,
          quantity: '-1',
          reasonCode: ' ',
          referenceType: 'manual',
          referenceId: randomUUID(),
        }),
      ),
    ).rejects.toMatchObject({ code: 'INVENTORY_ADJUSTMENT_REQUIRES_REASON' });
  });

  it('publishes a schema-valid product-created event', async () => {
    const { orgId } = await createOrgForOwner();
    observedEvents.length = 0;
    const { variantId } = await createProduct(orgId, { name: 'Event Bean', sku: 'EVT-1' });
    const event = observedEvents.find((e) => e.name === 'inventory.product.created.v1');
    expect(event).toBeDefined();
    expect(inventoryProductCreatedV1Schema.parse(event?.payload)).toMatchObject({
      variantId,
      sku: 'EVT-1',
      isActive: true,
    });
  });

  it('get-product composes product, variants, stock, and ledger history', async () => {
    const { orgId } = await createOrgForOwner();
    const { productId, variantId } = await createProduct(orgId, { name: 'Detail Bean', sku: 'DTL-1' });
    const { repo, txManager, unitOfWork } = buildInv();
    const receive = new ReceiveStockUseCase(repo, txManager, unitOfWork);
    const getProduct = new GetProductUseCase(repo, txManager);

    await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      receive.execute({
        variantId,
        quantity: '7',
        unitCostAmountMinor: '400',
        unitCostCurrency: 'USD',
        referenceType: 'purchase_order',
        referenceId: randomUUID(),
      }),
    );

    const detail = await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      getProduct.execute(productId),
    );
    expect(detail.product.id).toBe(productId);
    expect(detail.product.nameI18n.en).toBe('Detail Bean');
    // Audit stamps: the product and its variant were created by the owner.
    expect(detail.product.createdByUserId).toBe(ownerUserId);
    expect(detail.product.updatedByUserId).toBe(ownerUserId);
    expect(detail.variants).toHaveLength(1);
    expect(detail.variants[0]).toMatchObject({
      id: variantId,
      sku: 'DTL-1',
      isActive: true,
      createdByUserId: ownerUserId,
      updatedByUserId: ownerUserId,
    });
    expect(plain(detail.variants[0].stock[0].quantityOnHand)).toBe('7');
    // The receipt movement is the product's ledger history (INV-1, newest first).
    expect(detail.movements.some((m) => m.variantId === variantId && m.type === 'receipt')).toBe(true);
  });

  it('add-variant adds a sellable unit under an existing product (INV-10, INV-11)', async () => {
    const { orgId } = await createOrgForOwner();
    const { productId } = await createProduct(orgId, { name: 'Multi', sku: 'MUL-1' });
    const { repo, txManager, unitOfWork } = buildInv();
    const addVariant = new AddVariantUseCase(repo, txManager, unitOfWork);

    const { variantId } = await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      addVariant.execute({
        productId,
        sku: 'MUL-2',
        priceAmountMinor: '1200',
        priceCurrency: 'USD',
        costAmountMinor: '500',
        costCurrency: 'USD',
        reorderPoint: '5',
        reorderQuantity: '10',
      }),
    );

    const [row] = await ownerSql`
      SELECT sku, product_id, is_active, deleted_at
      FROM inv_product_variants WHERE id = ${variantId}
    `;
    expect(row?.sku).toBe('MUL-2');
    expect(row?.product_id).toBe(productId);
    expect(row?.is_active).toBe(true);
    expect(row?.deleted_at).toBeNull();

    // The product still owns both variants — adding a variant never touches history.
    const variants = await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      txManager.run((tx) => repo.listVariantsByProduct(productId, tx)),
    );
    expect(variants).toHaveLength(2);
  });

  it('add-variant rejects a duplicate SKU across DIFFERENT products (INV-10)', async () => {
    const { orgId } = await createOrgForOwner();
    // Product A owns sku XS-9; product B tries to add a variant with the same sku.
    const { productId: productA } = await createProduct(orgId, { name: 'First Prod', sku: 'XS-9' });
    const { productId: productB } = await createProduct(orgId, { name: 'Second Prod', sku: 'OTHER-1' });
    const { repo, txManager, unitOfWork } = buildInv();
    const addVariant = new AddVariantUseCase(repo, txManager, unitOfWork);

    await expect(
      TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
        addVariant.execute({
          productId: productB,
          sku: 'xs-9', // case-insensitive duplicate of A's variant
          priceAmountMinor: '1200',
          priceCurrency: 'USD',
          costAmountMinor: '500',
          costCurrency: 'USD',
          reorderPoint: '5',
          reorderQuantity: '10',
        }),
      ),
    ).rejects.toMatchObject({ code: 'INVENTORY_VARIANT_DUPLICATE_SKU' });

    // No stray variant row was written.
    const [row] = await ownerSql`
      SELECT COUNT(*)::int AS count FROM inv_product_variants
      WHERE sku ILIKE 'xs-9' AND product_id = ${productA}
    `;
    expect(row?.count).toBe(1);
  });

  it('archive-variant soft-deletes ONE variant and keeps the product active (INV-11)', async () => {
    const { orgId } = await createOrgForOwner();
    const { productId, variantId } = await createProduct(orgId, { name: 'Archive Var', sku: 'ARV-1' });
    const { repo, txManager, unitOfWork } = buildInv();
    const addVariant = new AddVariantUseCase(repo, txManager, unitOfWork);
    const archiveVariant = new ArchiveVariantUseCase(repo, txManager, unitOfWork);

    const { variantId: secondId } = await TenantContext.run(
      { ...ownerContext, userId: ownerUserId, organizationId: orgId },
      () =>
        addVariant.execute({
          productId,
          sku: 'ARV-2',
          priceAmountMinor: '1200',
          priceCurrency: 'USD',
          costAmountMinor: '500',
          costCurrency: 'USD',
          reorderPoint: '5',
          reorderQuantity: '10',
        }),
    );

    await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      archiveVariant.execute(variantId),
    );

    const [archived] = await ownerSql`
      SELECT is_active, deleted_at FROM inv_product_variants WHERE id = ${variantId}
    `;
    expect(archived?.is_active).toBe(false);
    expect(archived?.deleted_at).not.toBeNull();

    // The sibling variant and the product are untouched.
    const [sibling] = await ownerSql`
      SELECT is_active FROM inv_product_variants WHERE id = ${secondId}
    `;
    expect(sibling?.is_active).toBe(true);
    const [product] = await ownerSql`
      SELECT is_active, deleted_at FROM inv_products WHERE id = ${productId}
    `;
    expect(product?.is_active).toBe(true);
    expect(product?.deleted_at).toBeNull();
  });

  it('unarchive-variant restores ONE variant and emits the restored event (INV-11 inverse)', async () => {
    const { orgId } = await createOrgForOwner();
    const { productId, variantId } = await createProduct(orgId, { name: 'Restore Var', sku: 'RST-1' });
    const { repo, txManager, unitOfWork } = buildInv();
    const addVariant = new AddVariantUseCase(repo, txManager, unitOfWork);
    const archiveVariant = new ArchiveVariantUseCase(repo, txManager, unitOfWork);
    const unarchiveVariant = new UnarchiveVariantUseCase(repo, txManager, unitOfWork);

    const { variantId: secondId } = await TenantContext.run(
      { ...ownerContext, userId: ownerUserId, organizationId: orgId },
      () =>
        addVariant.execute({
          productId,
          sku: 'RST-2',
          priceAmountMinor: '1200',
          priceCurrency: 'USD',
          costAmountMinor: '500',
          costCurrency: 'USD',
          reorderPoint: '5',
          reorderQuantity: '10',
        }),
    );

    await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      archiveVariant.execute(variantId),
    );

    observedEvents.length = 0;
    const { restoredAt } = await TenantContext.run(
      { ...ownerContext, userId: ownerUserId, organizationId: orgId },
      () => unarchiveVariant.execute(variantId),
    );
    expect(restoredAt).toBeTruthy();

    const [restored] = await ownerSql`
      SELECT is_active, deleted_at FROM inv_product_variants WHERE id = ${variantId}
    `;
    expect(restored?.is_active).toBe(true);
    expect(restored?.deleted_at).toBeNull();

    // The sibling variant was never archived — restore touches only its target.
    const [sibling] = await ownerSql`
      SELECT is_active FROM inv_product_variants WHERE id = ${secondId}
    `;
    expect(sibling?.is_active).toBe(true);

    const restoredEvent = observedEvents.find((e) => e.name === 'inventory.product.restored.v1');
    expect(inventoryProductRestoredV1Schema.parse(restoredEvent?.payload)).toMatchObject({
      productId,
      variantIds: [variantId],
    });
  });

  it('unarchive-product restores every archived variant (INV-11 inverse)', async () => {
    const { orgId } = await createOrgForOwner();
    const { productId } = await createProduct(orgId, { name: 'Restore Prod', sku: 'RSP-1' });
    const { repo, txManager, unitOfWork } = buildInv();
    const addVariant = new AddVariantUseCase(repo, txManager, unitOfWork);
    const archiveProduct = new ArchiveProductUseCase(repo, txManager, unitOfWork);
    const unarchiveProduct = new UnarchiveProductUseCase(repo, txManager, unitOfWork);

    await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      addVariant.execute({
        productId,
        sku: 'RSP-2',
        priceAmountMinor: '1200',
        priceCurrency: 'USD',
        costAmountMinor: '500',
        costCurrency: 'USD',
        reorderPoint: '5',
        reorderQuantity: '10',
      }),
    );

    await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      archiveProduct.execute(productId),
    );

    observedEvents.length = 0;
    await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      unarchiveProduct.execute(productId),
    );

    const rows = await ownerSql`
      SELECT is_active, deleted_at FROM inv_product_variants WHERE product_id = ${productId} ORDER BY created_at ASC
    `;
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row?.is_active).toBe(true);
      expect(row?.deleted_at).toBeNull();
    }

    const restoredEvent = observedEvents.find((e) => e.name === 'inventory.product.restored.v1');
    const parsed = inventoryProductRestoredV1Schema.parse(restoredEvent?.payload);
    expect(parsed.productId).toBe(productId);
    expect(parsed.variantIds).toHaveLength(2);

    // The products list derives isActive=true again.
    const listProducts = new ListProductsUseCase(repo, txManager);
    const page = await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      listProducts.execute({ search: 'Restore Prod' }),
    );
    expect(page.items[0]?.isActive).toBe(true);
  });

  it('unarchive rejects when the archived SKU was re-claimed (INV-10)', async () => {
    const { orgId } = await createOrgForOwner();
    const { variantId } = await createProduct(orgId, { name: 'Sku Reclaim', sku: 'RCL-1' });
    const { repo, txManager, unitOfWork } = buildInv();
    const archiveVariant = new ArchiveVariantUseCase(repo, txManager, unitOfWork);
    const unarchiveVariant = new UnarchiveVariantUseCase(repo, txManager, unitOfWork);

    // Archive the variant → its SKU becomes free for a new variant.
    await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      archiveVariant.execute(variantId),
    );

    // A new product claims the SKU while the original is archived.
    await createProduct(orgId, { name: 'Claimant', sku: 'rcl-1' });

    // Restoring would now break INV-10 — rejected.
    await expect(
      TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
        unarchiveVariant.execute(variantId),
      ),
    ).rejects.toMatchObject({ code: 'INVENTORY_VARIANT_DUPLICATE_SKU' });
  });

  it('list-variants returns every sellable variant, excluding archived ones (pickers)', async () => {
    const { orgId } = await createOrgForOwner();
    const { productId, variantId } = await createProduct(orgId, { name: 'Picker', sku: 'PKR-1' });
    const { repo, txManager, unitOfWork } = buildInv();
    const addVariant = new AddVariantUseCase(repo, txManager, unitOfWork);
    const archiveVariant = new ArchiveVariantUseCase(repo, txManager, unitOfWork);
    const listVariants = new ListVariantsUseCase(repo, txManager);

    await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      addVariant.execute({
        productId,
        sku: 'PKR-2',
        priceAmountMinor: '1200',
        priceCurrency: 'USD',
        costAmountMinor: '500',
        costCurrency: 'USD',
        reorderPoint: '5',
        reorderQuantity: '10',
      }),
    );
    await createProduct(orgId, { name: 'Other', sku: 'PKR-3' });

    const { items } = await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      listVariants.execute(),
    );
    expect(items.map((v) => v.sku).sort()).toEqual(['PKR-1', 'PKR-2', 'PKR-3']);
    // The picker row carries the product name so the select label reads correctly.
    const first = items.find((v) => v.sku === 'PKR-1');
    expect(first?.nameI18n.en).toBe('Picker');

    // Archived variants never appear in pickers.
    await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      archiveVariant.execute(variantId),
    );
    const { items: after } = await TenantContext.run(
      { ...ownerContext, userId: ownerUserId, organizationId: orgId },
      () => listVariants.execute(),
    );
    expect(after.map((v) => v.sku).sort()).toEqual(['PKR-2', 'PKR-3']);
  });

  it('products list exposes variantCount (non-deleted variants per product)', async () => {
    const { orgId } = await createOrgForOwner();
    const { productId, variantId } = await createProduct(orgId, { name: 'Counted Prod', sku: 'VCT-1' });
    const { repo, txManager, unitOfWork } = buildInv();
    const addVariant = new AddVariantUseCase(repo, txManager, unitOfWork);
    const archiveVariant = new ArchiveVariantUseCase(repo, txManager, unitOfWork);
    const listProducts = new ListProductsUseCase(repo, txManager);

    await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      addVariant.execute({
        productId,
        sku: 'VCT-2',
        priceAmountMinor: '1200',
        priceCurrency: 'USD',
        costAmountMinor: '500',
        costCurrency: 'USD',
        reorderPoint: '5',
        reorderQuantity: '10',
      }),
    );

    const page = await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      listProducts.execute({ search: 'Counted Prod' }),
    );
    expect(page.items[0]?.variantCount).toBe(2);
    // The grouped products table gets EVERY variant in one row set — both
    // active here (created within the same ms, so their mutual order is
    // timestamp-tied; only the active-first guarantee is deterministic).
    expect(page.items[0]?.variants).toHaveLength(2);
    expect(page.items[0]?.variants.map((v) => v.sku).sort()).toEqual(['VCT-1', 'VCT-2']);
    expect(page.items[0]?.variants.every((v) => v.isActive)).toBe(true);
    // The display fields stay backward-compatible: the primary is one of them.
    expect(['VCT-1', 'VCT-2']).toContain(page.items[0]?.sku);

    // Archiving one variant drops the count but keeps the archived row in the
    // list (INV-11: history never lost) — and the active variant is promoted
    // to the top of the group (active-first ordering, now deterministic).
    await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      archiveVariant.execute(variantId),
    );
    const after = await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      listProducts.execute({ search: 'Counted Prod' }),
    );
    expect(after.items[0]?.variantCount).toBe(1);
    expect(after.items[0]?.variants).toHaveLength(2);
    expect(after.items[0]?.variants[0]).toMatchObject({ sku: 'VCT-2', isActive: true });
    expect(after.items[0]?.variants[1]).toMatchObject({ sku: 'VCT-1', isActive: false });
    expect(after.items[0]?.sku).toBe('VCT-2');
  });

  it('create-warehouse rejects duplicate codes and honours isDefault only once', async () => {
    const { orgId } = await createOrgForOwner();
    const { repo, txManager } = buildInv();
    const createWarehouse = new CreateWarehouseUseCase(repo, txManager);

    await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      createWarehouse.execute({
        name: 'Main Site',
        code: 'wh-01', // lower-case input — stored uppercase
        isDefault: true,
      }),
    );

    // Duplicate code (case-insensitive) is rejected.
    await expect(
      TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
        createWarehouse.execute({ name: 'Other', code: 'WH-01' }),
      ),
    ).rejects.toMatchObject({ code: 'INVENTORY_WAREHOUSE_DUPLICATE_CODE' });

    // A second isDefault is silently ignored — the org already has one.
    const second = await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      createWarehouse.execute({ name: 'Backup', code: 'WH-02', isDefault: true }),
    );
    expect(second.isDefault).toBe(false);
  });

  it('list-reservations exposes held stock with reference context (INV-7/8)', async () => {
    const { orgId } = await createOrgForOwner();
    const { variantId } = await createProduct(orgId, { name: 'Resv List', sku: 'RSL-1' });
    const { repo, txManager, unitOfWork } = buildInv();
    const receive = new ReceiveStockUseCase(repo, txManager, unitOfWork);
    const reserve = new ReserveStockUseCase(repo, txManager);
    const listReservations = new ListReservationsUseCase(repo, txManager);

    await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      receive.execute({
        variantId,
        quantity: '10',
        unitCostAmountMinor: '400',
        unitCostCurrency: 'USD',
        referenceType: 'purchase_order',
        referenceId: randomUUID(),
      }),
    );
    const warehouseId = await defaultWarehouseId(orgId);

    const saleId = randomUUID();
    const { reservationId } = await TenantContext.run(
      { ...ownerContext, userId: ownerUserId, organizationId: orgId },
      () =>
        reserve.execute({
          variantId,
          warehouseId,
          quantity: '3',
          referenceType: 'sale',
          referenceId: saleId,
          holdForSeconds: 900,
        }),
    );

    const { items: rows } = await TenantContext.run(
      { ...ownerContext, userId: ownerUserId, organizationId: orgId },
      () => listReservations.execute(),
    );
    const held = rows.find((r) => r.id === reservationId);
    expect(held).toBeDefined();
    expect(held).toMatchObject({
      variantId,
      quantity: '3',
      state: 'held',
      referenceType: 'sale',
      referenceId: saleId,
    });
  });

  it('get-stock-count returns the count with enriched lines (INV-14)', async () => {
    const { orgId } = await createOrgForOwner();
    const { variantId } = await createProduct(orgId, { name: 'Count Detail', sku: 'CDT-1' });
    const { repo, txManager, unitOfWork } = buildInv();
    const receive = new ReceiveStockUseCase(repo, txManager, unitOfWork);
    const getCount = new GetStockCountUseCase(repo, txManager);

    await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      receive.execute({
        variantId,
        quantity: '10',
        unitCostAmountMinor: '400',
        unitCostCurrency: 'USD',
        referenceType: 'purchase_order',
        referenceId: randomUUID(),
      }),
    );
    const warehouseId = await defaultWarehouseId(orgId);

    const countId = randomUUID();
    await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      txManager.run((tx) =>
        repo.insertStockCount(
          {
            id: countId,
            organizationId: orgId,
            warehouseId,
            status: STOCK_COUNT_STATUS.DRAFT,
            countedAt: null,
            countedBy: null,
            notes: 'physical tally',
            lines: [{ id: randomUUID(), variantId, expectedQuantity: '10', countedQuantity: '9', variance: '-1' }],
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          tx,
        ),
      ),
    );

    const detail = await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
      getCount.execute(countId),
    );
    expect(detail).toMatchObject({
      id: countId,
      warehouseId,
      status: 'draft',
      notes: 'physical tally',
    });
    expect(detail.warehouseName).toBeTruthy();
    expect(detail.lines[0]).toMatchObject({
      variantId,
      expectedQuantity: '10',
      countedQuantity: '9',
      variance: '-1',
      sku: 'CDT-1',
    });
  });

  describe('INVENTORY_STOCK_PORT (Level 3 — PLAN §5.6)', () => {
    /**
     * Build the port impl sharing the SAME TransactionManager the test uses
     * to mint the ref — refs are minted/resolved per-instance (WeakMap), so
     * the port must hold the identical manager the caller runs inside.
     */
    function buildPort(txManager: TransactionManager) {
      const { repo } = buildInv();
      const port = new InventoryStockPortImpl(repo, txManager);
      return { repo, txManager, port };
    }

    it('reserve → commit deducts stock atomically inside the caller transaction', async () => {
      const { orgId } = await createOrgForOwner();
      const { variantId } = await createProduct(orgId, { name: 'Port Cup', sku: 'PORT-1' });
      const { repo, txManager, unitOfWork } = buildInv();
      const receive = new ReceiveStockUseCase(repo, txManager, unitOfWork);
      const { port } = buildPort(txManager);

      await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
        receive.execute({
          variantId,
          quantity: '10',
          unitCostAmountMinor: '500',
          unitCostCurrency: 'USD',
          referenceType: 'purchase_order',
          referenceId: randomUUID(),
        }),
      );
      const warehouseId = await defaultWarehouseId(orgId);

      // Simulate POS checkout: mint the ref inside the CALLER's transaction
      // and pass it to the port — the port joins that same transaction.
      const { reservationId } = await TenantContext.run(
        { ...ownerContext, userId: ownerUserId, organizationId: orgId },
        () =>
          txManager.run(async (tx) => {
            const ref = txManager.ref(tx);
            const result = await port.reserve(
              { variantId, warehouseId, quantity: '4', referenceType: 'pos_sale', referenceId: randomUUID() },
              ref,
            );
            await port.commitReservation(result.reservationId, ref);
            return result;
          }),
      );

      // On-hand 10 − 4 = 6, reserved back to 0, reservation committed.
      const [level] = await ownerSql`
        SELECT quantity_on_hand, quantity_reserved FROM inv_stock_levels WHERE variant_id = ${variantId}
      `;
      expect(plain(level?.quantity_on_hand)).toBe('6');
      expect(plain(level?.quantity_reserved)).toBe('0');
      const [reservation] = await ownerSql`
        SELECT state FROM inv_stock_reservations WHERE id = ${reservationId}
      `;
      expect(reservation?.state).toBe('committed');
    });

    it('reserve → release returns the quantity to available (INV-8)', async () => {
      const { orgId } = await createOrgForOwner();
      const { variantId } = await createProduct(orgId, { name: 'Port Release', sku: 'PORT-2' });
      const { repo, txManager, unitOfWork } = buildInv();
      const receive = new ReceiveStockUseCase(repo, txManager, unitOfWork);
      const { port } = buildPort(txManager);

      await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
        receive.execute({
          variantId,
          quantity: '5',
          unitCostAmountMinor: '500',
          unitCostCurrency: 'USD',
          referenceType: 'purchase_order',
          referenceId: randomUUID(),
        }),
      );
      const warehouseId = await defaultWarehouseId(orgId);

      await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
        txManager.run(async (tx) => {
          const ref = txManager.ref(tx);
          const { reservationId } = await port.reserve(
            { variantId, warehouseId, quantity: '2', referenceType: 'pos_sale', referenceId: randomUUID() },
            ref,
          );
          await port.releaseReservation(reservationId, ref);
        }),
      );

      const [level] = await ownerSql`
        SELECT quantity_on_hand, quantity_reserved FROM inv_stock_levels WHERE variant_id = ${variantId}
      `;
      expect(plain(level?.quantity_on_hand)).toBe('5');
      expect(plain(level?.quantity_reserved)).toBe('0');
    });

    it('INV-7: a reservation with a tiny hold bound is picked up by the expiry scan', async () => {
      const { orgId } = await createOrgForOwner();
      const { variantId } = await createProduct(orgId, { name: 'Port Expiry', sku: 'PORT-3' });
      const { repo, txManager, unitOfWork } = buildInv();
      const receive = new ReceiveStockUseCase(repo, txManager, unitOfWork);
      const { port } = buildPort(txManager);

      await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
        receive.execute({
          variantId,
          quantity: '5',
          unitCostAmountMinor: '500',
          unitCostCurrency: 'USD',
          referenceType: 'purchase_order',
          referenceId: randomUUID(),
        }),
      );
      const warehouseId = await defaultWarehouseId(orgId);

      let reservationId = '';
      await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
        txManager.run(async (tx) => {
          const ref = txManager.ref(tx);
          const result = await port.reserve(
            {
              variantId,
              warehouseId,
              quantity: '2',
              holdForSeconds: 1, // 1-second bound (INV-7)
              referenceType: 'pos_sale',
              referenceId: randomUUID(),
            },
            ref,
          );
          reservationId = result.reservationId;
        }),
      );

      // Wait for the hold bound to pass, then the expiry job's scan finds it.
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const expired = await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
        txManager.run((tx) => repo.listExpiredHeldReservations(new Date(), tx)),
      );
      expect(expired.some((r) => r.id === reservationId)).toBe(true);
    });

    it('getAvailability reports INV-5 available = on-hand − reserved for the port', async () => {
      const { orgId } = await createOrgForOwner();
      const { variantId } = await createProduct(orgId, { name: 'Port Avail', sku: 'PORT-4' });
      const { repo, txManager, unitOfWork } = buildInv();
      const receive = new ReceiveStockUseCase(repo, txManager, unitOfWork);
      const { port } = buildPort(txManager);

      await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
        receive.execute({
          variantId,
          quantity: '10',
          unitCostAmountMinor: '500',
          unitCostCurrency: 'USD',
          referenceType: 'purchase_order',
          referenceId: randomUUID(),
        }),
      );
      const warehouseId = await defaultWarehouseId(orgId);

      const snapshots = await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
        port.getAvailability({ variantIds: [variantId], warehouseId }),
      );
      expect(snapshots).toHaveLength(1);
      expect(snapshots[0]).toMatchObject({
        variantId,
        warehouseId,
        quantityOnHand: '10',
        quantityReserved: '0',
        quantityAvailable: '10',
      });
    });
  });

  describe('inventory list filters & pagination (INV-1/5/13)', () => {
    it('stock list filters by search, warehouse, low-stock and paginates (INV-5/13)', async () => {
      const { orgId } = await createOrgForOwner();
      const { variantId: lowVariant } = await createProduct(orgId, { name: 'Low Widget', sku: 'LOW-SKU' });
      const { variantId: okVariant } = await createProduct(orgId, { name: 'Healthy Widget', sku: 'OK-SKU' });
      // Never received — no level row exists; the stock page must still show it.
      const { variantId: neverReceived } = await createProduct(orgId, { name: 'Never Received', sku: 'NEW-SKU' });
      const { repo, txManager, unitOfWork } = buildInv();
      const receive = new ReceiveStockUseCase(repo, txManager, unitOfWork);
      const list = new ListStockLevelsUseCase(repo, txManager);

      await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, async () => {
        // Both variants land in the org's default warehouse; LOW is under its
        // reorder point (5), OK is not.
        await receive.execute({
          variantId: lowVariant,
          quantity: '2',
          unitCostAmountMinor: '400',
          unitCostCurrency: 'USD',
          referenceType: 'purchase_order',
          referenceId: randomUUID(),
        });
        await receive.execute({
          variantId: okVariant,
          quantity: '10',
          unitCostAmountMinor: '400',
          unitCostCurrency: 'USD',
          referenceType: 'purchase_order',
          referenceId: randomUUID(),
        });
      });

      const warehouseId = await defaultWarehouseId(orgId);

      await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, async () => {
        // Search matches product name OR SKU (case-insensitive).
        const bySku = await list.execute({ search: 'low-sku' });
        expect(bySku.total).toBe(1);
        expect(bySku.items[0]).toMatchObject({ variantId: lowVariant, sku: 'LOW-SKU' });

        // Warehouse narrowing keeps every sellable variant at that warehouse —
        // including the never-received one, which shows zero quantities.
        const inWarehouse = await list.execute({ warehouseId });
        expect(inWarehouse.total).toBe(3);
        const neverRow = inWarehouse.items.find((r) => r.variantId === neverReceived);
        expect(neverRow).toMatchObject({
          variantId: neverReceived,
          sku: 'NEW-SKU',
          quantityOnHand: '0',
          quantityReserved: '0',
          lastMovementId: null,
        });
        expect(neverRow?.warehouseId).toBe(warehouseId);

        // INV-13: low = available (on-hand − reserved) < reorder point — the
        // never-received variant (available 0 < reorder 5) IS low, matching
        // the stock-page badge; only a reorder point of 0 stays off the chip.
        const lowOnly = await list.execute({ lowStock: true });
        expect(lowOnly.total).toBe(2);
        expect(lowOnly.items[0]).toMatchObject({ variantId: lowVariant, quantityOnHand: '2' });
        expect(lowOnly.items.map((r) => r.variantId).sort()).toEqual([lowVariant, neverReceived].sort());

        // Pagination: one row per page, ordered by product name.
        const page1 = await list.execute({ page: 1, pageSize: 1 });
        const page2 = await list.execute({ page: 2, pageSize: 1 });
        expect(page1.total).toBe(3);
        expect(page1.items).toHaveLength(1);
        expect(page2.items).toHaveLength(1);
        expect(page1.items[0]?.sku).not.toBe(page2.items[0]?.sku);

        // Internal batch reads (jobs / product detail) pass `all` and must
        // never be truncated by pagination defaults — and must stay leveled-
        // only so the low-stock job never alerts on never-received variants.
        const everything = await list.execute({ all: true });
        expect(everything.total).toBe(2);
        expect(everything.items).toHaveLength(2);
      });
    });

    it('stock list shows every variant even before a warehouse exists (stock-page UX)', async () => {
      const { orgId } = await createOrgForOwner();
      const { variantId } = await createProduct(orgId, { name: 'Fresh', sku: 'FRESH-1' });
      const { repo, txManager } = buildInv();
      const list = new ListStockLevelsUseCase(repo, txManager);

      const page = await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
        list.execute(),
      );
      // No default warehouse exists yet (created lazily on first receipt), so
      // the row carries a NULL warehouse and zero quantities — the stock page
      // can still render it and offer receive/adjust.
      expect(page.total).toBe(1);
      expect(page.items[0]).toMatchObject({
        variantId,
        sku: 'FRESH-1',
        quantityOnHand: '0',
        quantityReserved: '0',
        reorderPoint: '5',
      });
      expect(page.items[0].warehouseId).toBeNull();
      expect(page.items[0].warehouseName).toBeNull();
      expect(page.items[0].unitCostAmountMinor).toBeNull();
    });

    it('movements filter by search, type, and date range and paginate (INV-1)', async () => {
      const { orgId } = await createOrgForOwner();
      const { variantId } = await createProduct(orgId, { name: 'Ledger Widget', sku: 'LDG-1' });
      const { variantId: otherVariant } = await createProduct(orgId, { name: 'Other Widget', sku: 'OTH-1' });
      const { repo, txManager, unitOfWork } = buildInv();
      const receive = new ReceiveStockUseCase(repo, txManager, unitOfWork);
      const adjust = new AdjustStockUseCase(repo, txManager, unitOfWork);
      const list = new ListMovementsUseCase(repo, txManager);

      await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, async () => {
        await receive.execute({
          variantId,
          quantity: '10',
          unitCostAmountMinor: '400',
          unitCostCurrency: 'USD',
          referenceType: 'purchase_order',
          referenceId: randomUUID(),
        });
        await adjust.execute({
          variantId,
          quantity: '-2',
          reasonCode: 'damaged',
          referenceType: 'damage_report',
          referenceId: randomUUID(),
        });
        await receive.execute({
          variantId: otherVariant,
          quantity: '5',
          unitCostAmountMinor: '200',
          unitCostCurrency: 'USD',
          referenceType: 'purchase_order',
          referenceId: randomUUID(),
        });
      });

      await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, async () => {
        // Search narrows to one SKU (receipt + adjustment = 2 rows).
        const bySku = await list.execute({ search: 'LDG-1' });
        expect(bySku.total).toBe(2);
        expect(bySku.items.every((m) => m.variantId === variantId)).toBe(true);

        // Type filter keeps only receipts across all variants.
        const receipts = await list.execute({ type: 'receipt' });
        expect(receipts.total).toBe(2);
        expect(receipts.items.every((m) => m.type === 'receipt')).toBe(true);

        const adjustments = await list.execute({ type: 'adjustment' });
        expect(adjustments.total).toBe(1);
        expect(adjustments.items[0]).toMatchObject({ variantId, reasonCode: 'damaged' });

        // Date range: everything happened today; a past range matches nothing.
        const today = new Date().toISOString().slice(0, 10);
        const todayRows = await list.execute({ fromDate: today, toDate: today });
        expect(todayRows.total).toBe(3);
        const past = await list.execute({ fromDate: '2020-01-01', toDate: '2020-01-02' });
        expect(past.total).toBe(0);

        // Pagination: newest first, one row per page.
        const page1 = await list.execute({ page: 1, pageSize: 1 });
        expect(page1.total).toBe(3);
        expect(page1.items).toHaveLength(1);
        const page3 = await list.execute({ page: 3, pageSize: 1 });
        expect(page3.items).toHaveLength(1);
      });
    });

    it('reservations filter by status and paginate (INV-7/8)', async () => {
      const { orgId } = await createOrgForOwner();
      const { variantId } = await createProduct(orgId, { name: 'Resv Filter', sku: 'RSF-1' });
      const { repo, txManager, unitOfWork } = buildInv();
      const receive = new ReceiveStockUseCase(repo, txManager, unitOfWork);
      const reserve = new ReserveStockUseCase(repo, txManager);
      const release = new ReleaseReservationUseCase(repo, txManager);
      const list = new ListReservationsUseCase(repo, txManager);

      await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
        receive.execute({
          variantId,
          quantity: '10',
          unitCostAmountMinor: '400',
          unitCostCurrency: 'USD',
          referenceType: 'purchase_order',
          referenceId: randomUUID(),
        }),
      );
      const warehouseId = await defaultWarehouseId(orgId);

      const { reservationId } = await TenantContext.run(
        { ...ownerContext, userId: ownerUserId, organizationId: orgId },
        () =>
          reserve.execute({
            variantId,
            warehouseId,
            quantity: '3',
            referenceType: 'sale',
            referenceId: randomUUID(),
            holdForSeconds: 900,
          }),
      );
      // A second hold stays active — release only flips the first row's state.
      await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
        reserve.execute({
          variantId,
          warehouseId,
          quantity: '2',
          referenceType: 'sale',
          referenceId: randomUUID(),
          holdForSeconds: 900,
        }),
      );
      await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
        release.execute(reservationId),
      );

      await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, async () => {
        const released = await list.execute({ status: 'released' });
        expect(released.total).toBe(1);
        expect(released.items[0]).toMatchObject({ id: reservationId, state: 'released' });

        const held = await list.execute({ status: 'held' });
        expect(held.total).toBe(1);

        const committed = await list.execute({ status: 'committed' });
        expect(committed.total).toBe(0);

        // Pagination across the full set (held + released).
        const page1 = await list.execute({ page: 1, pageSize: 1 });
        expect(page1.total).toBe(2);
        expect(page1.items).toHaveLength(1);
      });
    });

    it('products list filters by search and status and paginates (INV-10/11)', async () => {
      const { orgId } = await createOrgForOwner();
      const { variantId: keepVariant } = await createProduct(orgId, { name: 'Alpha Widget', sku: 'ALP-1' });
      const { variantId: goneVariant } = await createProduct(orgId, { name: 'Beta Widget', sku: 'BET-1' });
      const { repo, txManager, unitOfWork } = buildInv();
      const list = new ListProductsUseCase(repo, txManager);
      const archiveVariant = new ArchiveVariantUseCase(repo, txManager, unitOfWork);

      // Archive Beta's only variant → Beta has no sellable unit left (INV-11).
      await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
        archiveVariant.execute(goneVariant),
      );

      await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, async () => {
        const all = await list.execute();
        expect(all.total).toBe(2);
        expect(all.items).toHaveLength(2);

        // Search matches product name OR SKU (case-insensitive).
        const bySku = await list.execute({ search: 'alp-1' });
        expect(bySku.total).toBe(1);
        expect(bySku.items[0]).toMatchObject({ sku: 'ALP-1' });

        // Status: active = has a sellable variant; archived = none left.
        const active = await list.execute({ status: 'active' });
        expect(active.total).toBe(1);
        expect(active.items[0]).toMatchObject({ sku: 'ALP-1', isActive: true });

        const archived = await list.execute({ status: 'archived' });
        expect(archived.total).toBe(1);
        // The archived row keeps its last variant's SKU + id for display (INV-11 history).
        expect(archived.items[0]).toMatchObject({ sku: 'BET-1', isActive: false, variantId: goneVariant });

        // Pagination: one row per page, ordered by product name.
        const page1 = await list.execute({ page: 1, pageSize: 1 });
        const page2 = await list.execute({ page: 2, pageSize: 1 });
        expect(page1.total).toBe(2);
        expect(page1.items).toHaveLength(1);
        expect(page2.items).toHaveLength(1);
        expect(page1.items[0]?.sku).not.toBe(page2.items[0]?.sku);
      });
    });

    it('stock-counts list filters by status and paginates (INV-14)', async () => {
      const { orgId } = await createOrgForOwner();
      const { variantId } = await createProduct(orgId, { name: 'Count List', sku: 'CLT-1' });
      const { repo, txManager, unitOfWork } = buildInv();
      const list = new ListStockCountsUseCase(repo, txManager);
      const receive = new ReceiveStockUseCase(repo, txManager, unitOfWork);

      // The receipt lazily creates the org's default warehouse.
      await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
        receive.execute({
          variantId,
          quantity: '5',
          unitCostAmountMinor: '500',
          unitCostCurrency: 'USD',
          referenceType: 'purchase_order',
          referenceId: randomUUID(),
        }),
      );
      const warehouseId = await defaultWarehouseId(orgId);

      await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
        txManager.run((tx) =>
          repo.insertStockCount(
            {
              id: randomUUID(),
              organizationId: orgId,
              warehouseId,
              status: STOCK_COUNT_STATUS.DRAFT,
              countedAt: null,
              countedBy: null,
              notes: 'first tally',
              lines: [{ id: randomUUID(), variantId, expectedQuantity: '10', countedQuantity: '9', variance: '-1' }],
              createdAt: new Date(),
              updatedAt: new Date(),
            },
            tx,
          ),
        ),
      );

      await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, () =>
        txManager.run((tx) =>
          repo.insertStockCount(
            {
              id: randomUUID(),
              organizationId: orgId,
              warehouseId,
              status: STOCK_COUNT_STATUS.APPLIED,
              countedAt: new Date(),
              countedBy: null,
              notes: 'second tally',
              lines: [{ id: randomUUID(), variantId, expectedQuantity: '10', countedQuantity: '10', variance: '0' }],
              createdAt: new Date(),
              updatedAt: new Date(),
            },
            tx,
          ),
        ),
      );

      await TenantContext.run({ ...ownerContext, userId: ownerUserId, organizationId: orgId }, async () => {
        const drafts = await list.execute({ status: 'draft' });
        expect(drafts.total).toBe(1);
        expect(drafts.items[0]).toMatchObject({ status: 'draft', notes: 'first tally' });

        const applied = await list.execute({ status: 'applied' });
        expect(applied.total).toBe(1);
        expect(applied.items[0]).toMatchObject({ status: 'applied', notes: 'second tally' });

        // The full set carries its lines; pagination caps the page.
        const all = await list.execute();
        expect(all.total).toBe(2);
        expect(all.items[0].lines).toHaveLength(1);

        const page1 = await list.execute({ page: 1, pageSize: 1 });
        expect(page1.total).toBe(2);
        expect(page1.items).toHaveLength(1);
      });
    });
  });
});
