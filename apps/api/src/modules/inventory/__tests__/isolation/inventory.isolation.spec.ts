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
import { TenantContext, type TenantContextData } from '../../../../core/tenancy/tenant-context.js';
import { withoutTenantContext } from '../../../../core/tenancy/without-tenant-context.js';
import { InventoryController } from '../../api/inventory.controller.js';
import {
  ArchiveProductUseCase,
  ArchiveVariantUseCase,
  CreateProductUseCase,
  CreateStockCountUseCase,
  ListMovementsUseCase,
  ListProductsUseCase,
  ListStockCountsUseCase,
  ListStockLevelsUseCase,
  ListVariantsUseCase,
  ListWarehousesUseCase,
  ReceiveStockUseCase,
  UnarchiveProductUseCase,
  UnarchiveVariantUseCase,
  UpdateProductUseCase,
  UpdateVariantUseCase,
} from '../../application/index.js';
import { DrizzleInventoryRepository } from '../../infrastructure/repositories/drizzle-inventory.repository.js';

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
let repo: DrizzleInventoryRepository;
let createProduct: CreateProductUseCase;
let archiveProduct: ArchiveProductUseCase;
let archiveVariant: ArchiveVariantUseCase;
let unarchiveProduct: UnarchiveProductUseCase;
let unarchiveVariant: UnarchiveVariantUseCase;
let listVariants: ListVariantsUseCase;
let receiveStock: ReceiveStockUseCase;
let listProducts: ListProductsUseCase;
let listStockLevels: ListStockLevelsUseCase;
let listMovements: ListMovementsUseCase;
let createStockCount: CreateStockCountUseCase;
let listStockCounts: ListStockCountsUseCase;
let listWarehouses: ListWarehousesUseCase;
let updateProduct: UpdateProductUseCase;
let updateVariant: UpdateVariantUseCase;

function context(organizationId: string, userId: string): TenantContextData {
  return {
    userId,
    sessionId: undefined,
    organizationId,
    roles: ['OWNER'],
    permissions: ['inventory:product:read', 'inventory:product:write', 'inventory:stock:adjust'],
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
  repo = new DrizzleInventoryRepository(db);
  const unitOfWork = new UnitOfWork(noopEventBus);
  createProduct = new CreateProductUseCase(repo, txManager, unitOfWork);
  archiveProduct = new ArchiveProductUseCase(repo, txManager, unitOfWork);
  archiveVariant = new ArchiveVariantUseCase(repo, txManager, unitOfWork);
  unarchiveProduct = new UnarchiveProductUseCase(repo, txManager, unitOfWork);
  unarchiveVariant = new UnarchiveVariantUseCase(repo, txManager, unitOfWork);
  listVariants = new ListVariantsUseCase(repo, txManager);
  receiveStock = new ReceiveStockUseCase(repo, txManager, unitOfWork);
  listProducts = new ListProductsUseCase(repo, txManager);
  listStockLevels = new ListStockLevelsUseCase(repo, txManager);
  listMovements = new ListMovementsUseCase(repo, txManager);
  createStockCount = new CreateStockCountUseCase(repo, txManager);
  listStockCounts = new ListStockCountsUseCase(repo, txManager);
  listWarehouses = new ListWarehousesUseCase(repo, txManager);
  updateProduct = new UpdateProductUseCase(repo, txManager);
  updateVariant = new UpdateVariantUseCase(repo, txManager);
}, 180_000);

beforeEach(async () =>
  ownerSql.unsafe(
    'TRUNCATE TABLE inv_products, inv_product_variants, inv_units_of_measure, inv_warehouses, inv_stock_levels, inv_stock_movements, inv_stock_reservations, inv_stock_counts, inv_stock_count_lines, inv_low_stock_alerts CASCADE',
  ),
);

afterAll(async () => {
  if (appSql) await appSql.end();
  if (ownerSql) await ownerSql.end();
  if (container) await container.stop();
});

async function seedProduct(ctx: TenantContextData, sku = `${randomUUID().slice(0, 8)}`) {
  return TenantContext.run(ctx, () =>
    createProduct.execute({
      nameI18n: { en: 'Isolation Product' },
      sku,
      priceAmountMinor: '1000',
      priceCurrency: 'USD',
      costAmountMinor: '500',
      costCurrency: 'USD',
      reorderPoint: '5',
      reorderQuantity: '10',
    }),
  );
}

describe('inventory tenant isolation', () => {
  it('TEN-1: org A cannot read an org B product variant', async () => {
    const { variantId } = await seedProduct(orgBContext);
    const result = await TenantContext.run(orgAContext, () =>
      txManager.run((tx) => repo.findVariantById(variantId, tx)),
    );
    expect(result).toBeUndefined();
  });

  it('TEN-1: org A cannot update stock on an org B variant (VARIANT_NOT_FOUND)', async () => {
    const { variantId } = await seedProduct(orgBContext);
    await expect(
      TenantContext.run(orgAContext, () =>
        receiveStock.execute({
          variantId,
          quantity: '10',
          unitCostAmountMinor: '500',
          unitCostCurrency: 'USD',
          referenceType: 'isolation-test',
          referenceId: randomUUID(),
        }),
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', message: 'VARIANT_NOT_FOUND' });
    const rows = await ownerSql`SELECT * FROM inv_stock_movements`;
    expect(rows).toHaveLength(0);
  });

  it('TEN-1: org A cannot unarchive an org B variant (restore is RLS-scoped)', async () => {
    const { variantId } = await seedProduct(orgBContext);
    // Org B archives its own variant, then org A tries to restore it.
    await TenantContext.run(orgBContext, () => archiveVariant.execute(variantId));
    await expect(TenantContext.run(orgAContext, () => unarchiveVariant.execute(variantId))).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'VARIANT_NOT_FOUND',
    });
    // The variant stays archived — org A's attempt changed nothing.
    const rows = await ownerSql`SELECT is_active, deleted_at FROM inv_product_variants WHERE id = ${variantId}`;
    expect(rows[0]?.is_active).toBe(false);
    expect(rows[0]?.deleted_at).not.toBeNull();
  });

  it('TEN-1: org A cannot unarchive an org B product (INV-11 inverse is RLS-scoped)', async () => {
    const { productId, variantId } = await seedProduct(orgBContext);
    await TenantContext.run(orgBContext, () => archiveProduct.execute(productId));
    await expect(TenantContext.run(orgAContext, () => unarchiveProduct.execute(productId))).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'PRODUCT_NOT_FOUND',
    });
    const rows = await ownerSql`SELECT is_active FROM inv_product_variants WHERE id = ${variantId}`;
    expect(rows[0]?.is_active).toBe(false);
  });

  it('TEN-1: org A variants list excludes org B sellable variants (pickers)', async () => {
    await seedProduct(orgBContext);
    const page = await TenantContext.run(orgAContext, () => listVariants.execute());
    expect(page.items).toHaveLength(0);
  });

  it('TEN-1: org A cannot archive an org B product (INV-11 soft delete is RLS-scoped)', async () => {
    const { productId, variantId } = await seedProduct(orgBContext);
    // The archive action takes the PRODUCT id — org A's lookup fails closed.
    await expect(TenantContext.run(orgAContext, () => archiveProduct.execute(productId))).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'PRODUCT_NOT_FOUND',
    });
    const rows = await ownerSql`SELECT is_active, deleted_at FROM inv_product_variants WHERE id = ${variantId}`;
    expect(rows[0]?.is_active).toBe(true);
    expect(rows[0]?.deleted_at).toBeNull();
  });

  it('TEN-1: org A cannot rename an org B product (catalog metadata is RLS-scoped)', async () => {
    const { productId } = await seedProduct(orgBContext);
    await expect(
      TenantContext.run(orgAContext, () => updateProduct.execute(productId, { nameI18n: { en: 'Hijacked' } })),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', message: 'PRODUCT_NOT_FOUND' });
    const rows = await ownerSql`SELECT name_i18n FROM inv_products WHERE id = ${productId}`;
    expect((rows[0]?.name_i18n as { en: string }).en).toBe('Isolation Product');
  });

  it('TEN-1: org A cannot edit an org B variant (VARIANT_NOT_FOUND)', async () => {
    const { variantId } = await seedProduct(orgBContext);
    await expect(
      TenantContext.run(orgAContext, () =>
        updateVariant.execute(variantId, { priceAmountMinor: '9999', priceCurrency: 'USD' }),
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', message: 'VARIANT_NOT_FOUND' });
    const rows = await ownerSql`SELECT price_amount_minor FROM inv_product_variants WHERE id = ${variantId}`;
    expect(rows[0]?.price_amount_minor).toBe('1000');
  });

  it('TEN-1: org A product list excludes org B products', async () => {
    const { productId } = await seedProduct(orgBContext);
    const page = await TenantContext.run(orgAContext, () => listProducts.execute());
    expect(page.items.some((item) => item.id === productId)).toBe(false);
  });

  it('TEN-1: org A ledger views exclude org B movements and stock levels', async () => {
    // Org B receives stock → creates its default warehouse, movement + level.
    const { variantId } = await seedProduct(orgBContext);
    await TenantContext.run(orgBContext, () =>
      receiveStock.execute({
        variantId,
        quantity: '10',
        unitCostAmountMinor: '500',
        unitCostCurrency: 'USD',
        referenceType: 'isolation-test',
        referenceId: randomUUID(),
      }),
    );

    const levels = await TenantContext.run(orgAContext, () => listStockLevels.execute());
    expect(levels.items).toHaveLength(0);
    const movements = await TenantContext.run(orgAContext, () => listMovements.execute());
    expect(movements.items).toHaveLength(0);
  });

  it('TEN-1: org A warehouse list excludes org B warehouses', async () => {
    // Org B receives stock → creates its default warehouse (RLS-scoped).
    const { variantId } = await seedProduct(orgBContext);
    await TenantContext.run(orgBContext, () =>
      receiveStock.execute({
        variantId,
        quantity: '10',
        unitCostAmountMinor: '500',
        unitCostCurrency: 'USD',
        referenceType: 'isolation-test',
        referenceId: randomUUID(),
      }),
    );

    const warehouses = await TenantContext.run(orgAContext, () => listWarehouses.execute());
    expect(warehouses).toHaveLength(0);
  });

  it('TEN-1: org A stock count list excludes org B counts', async () => {
    const { variantId } = await seedProduct(orgBContext);
    await TenantContext.run(orgBContext, () =>
      receiveStock.execute({
        variantId,
        quantity: '10',
        unitCostAmountMinor: '500',
        unitCostCurrency: 'USD',
        referenceType: 'isolation-test',
        referenceId: randomUUID(),
      }),
    );
    // Org B resolves its default warehouse and starts a draft count (INV-14).
    const [warehouse] = await TenantContext.run(orgBContext, () => listWarehouses.execute());
    if (!warehouse) throw new Error('Expected org B default warehouse to exist');
    await TenantContext.run(orgBContext, () =>
      createStockCount.execute({
        warehouseId: warehouse.id,
        notes: 'isolation draft',
        lines: [{ variantId, countedQuantity: '9' }],
      }),
    );

    const counts = await TenantContext.run(orgAContext, () => listStockCounts.execute());
    expect(counts.items).toHaveLength(0);
  });

  it('TEN-2: an injected organizationId cannot override the session organization', async () => {
    const input = {
      nameI18n: { en: 'Injected Tenant' },
      sku: 'INJ-1',
      priceAmountMinor: '1000',
      priceCurrency: 'USD',
      costAmountMinor: '500',
      costCurrency: 'USD',
      reorderPoint: '5',
      reorderQuantity: '10',
      // Passed as a variable so TS excess-property checks do not apply — the
      // use case ignores it; RLS + TenantContext decide the real org (TEN-2).
      organizationId: ORG_B_ID,
    };
    const result = await TenantContext.run(orgAContext, () => createProduct.execute(input));
    const rows = await ownerSql`SELECT organization_id FROM inv_product_variants WHERE id = ${result.variantId}`;
    expect(rows[0]?.organization_id).toBe(ORG_A_ID);
  });

  it('TEN-3: no tenant context exposes zero inventory rows', async () => {
    const { variantId } = await seedProduct(orgBContext);
    await withoutTenantContext(async () => {
      expect(await repo.findVariantById(variantId)).toBeUndefined();
      const rows = await db.execute(sql`SELECT id FROM inv_product_variants WHERE id = ${variantId}`);
      expect(rows).toHaveLength(0);
    });
  });

  it('AUTHZ-6: an OWNER receives MODULE_NOT_ENTITLED when inventory is disabled', async () => {
    const store = new InMemoryEntitlementStore();
    await store.upsert({
      organizationId: ORG_A_ID,
      moduleKey: 'inventory',
      state: 'disabled',
      trialStartedAt: null,
      trialEndsAt: null,
      activatedAt: null,
      disabledAt: '2026-01-01T00:00:00Z',
      purgeAfter: null,
      features: [],
    });
    const guard = new EntitlementGuard(new Reflector(), new EntitlementService(store));
    await expect(guard.canActivate(guardContext(['inventory:product:read']))).rejects.toThrow('MODULE_NOT_ENTITLED');
  });

  it('AUTHZ-5: an entitled user without inventory:product:read is denied', () => {
    const guard = new PermissionGuard(new Reflector());
    expect(() => guard.canActivate(guardContext(['inventory:product:write']))).toThrow(ForbiddenException);
  });
});

/**
 * Guard execution context for the AUTHZ-5/6 unit checks.
 *
 * `getHandler` deliberately points at a REAL controller route method
 * (`listProductsRoute`): the PermissionGuard reads `@RequiresPermission`
 * metadata off that handler, so the assertion only means something while the
 * method exists and carries the decorator. If the method is renamed, this
 * test must be updated alongside — it would otherwise silently pass.
 */
function guardContext(permissions: string[]): Parameters<EntitlementGuard['canActivate']>[0] {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user: { sub: USER_A_ID, organizationId: ORG_A_ID, roles: ['OWNER'], permissions } }),
    }),
    getHandler: () => InventoryController.prototype.listProductsRoute,
    getClass: () => InventoryController,
  } as never;
}
