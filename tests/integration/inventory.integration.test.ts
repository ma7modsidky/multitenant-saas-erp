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
import { ArchiveProductUseCase } from '../../apps/api/src/modules/inventory/application/archive-product.use-case.js';
import { ReceiveStockUseCase } from '../../apps/api/src/modules/inventory/application/receive-stock.use-case.js';
import { AdjustStockUseCase } from '../../apps/api/src/modules/inventory/application/adjust-stock.use-case.js';
import { TransferStockUseCase } from '../../apps/api/src/modules/inventory/application/transfer-stock.use-case.js';
import { ReserveStockUseCase } from '../../apps/api/src/modules/inventory/application/reserve-stock.use-case.js';
import { CommitReservationUseCase } from '../../apps/api/src/modules/inventory/application/commit-reservation.use-case.js';
import { ReleaseReservationUseCase } from '../../apps/api/src/modules/inventory/application/release-reservation.use-case.js';
import { ApplyStockCountUseCase } from '../../apps/api/src/modules/inventory/application/apply-stock-count.use-case.js';
import { GetAvailabilityUseCase } from '../../apps/api/src/modules/inventory/application/get-availability.use-case.js';
import { STOCK_COUNT_STATUS } from '../../apps/api/src/modules/inventory/domain/index.js';
import {
  inventoryProductCreatedV1Schema,
  inventoryProductArchivedV1Schema,
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
      SELECT cost_amount_minor FROM inv_product_variants WHERE id = ${variantId}
    `;
    expect(variant?.cost_amount_minor).toBe('500');

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

  it('INV-11: a variant with movement history archives, never hard-deletes', async () => {
    const { orgId } = await createOrgForOwner();
    const { variantId } = await createProduct(orgId, { name: 'Archive', sku: 'ARC-1' });
    const { repo, txManager, unitOfWork } = buildInv();
    const receive = new ReceiveStockUseCase(repo, txManager, unitOfWork);
    const archive = new ArchiveProductUseCase(repo, txManager, unitOfWork);

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
      archive.execute(variantId),
    );

    // Soft-deleted, history untouched.
    const [row] = await ownerSql`
      SELECT is_active, deleted_at FROM inv_product_variants WHERE id = ${variantId}
    `;
    expect(row?.is_active).toBe(false);
    expect(row?.deleted_at).not.toBeNull();

    const [movementCount] = await ownerSql`
      SELECT COUNT(*)::int AS count FROM inv_stock_movements WHERE variant_id = ${variantId}
    `;
    expect(movementCount?.count).toBe(1);

    const archivedEvent = observedEvents.find((e) => e.name === 'inventory.product.archived.v1');
    expect(inventoryProductArchivedV1Schema.parse(archivedEvent?.payload)).toMatchObject({
      productId: expect.any(String),
      variantIds: [variantId],
    });
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
});
