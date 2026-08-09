import { randomUUID } from 'node:crypto';

import { INVENTORY_STOCK_PORT } from '@modubiz/contracts';
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
import { InventoryStockPortImpl } from '../../../inventory/infrastructure/ports/inventory-stock.port.impl.js';
import { DrizzleInventoryRepository } from '../../../inventory/infrastructure/repositories/drizzle-inventory.repository.js';
import { PosController } from '../../api/pos.controller.js';
import {
  CheckoutUseCase,
  CreateRegisterUseCase,
  GetSaleUseCase,
  ListRegistersUseCase,
  ListSalesUseCase,
  ListShiftsUseCase,
  OpenShiftUseCase,
} from '../../application/index.js';
import { DrizzlePosRepository } from '../../infrastructure/repositories/drizzle-pos.repository.js';

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
let repo: DrizzlePosRepository;
let createRegister: CreateRegisterUseCase;
let openShift: OpenShiftUseCase;
let checkout: CheckoutUseCase;
let listRegisters: ListRegistersUseCase;
let listShifts: ListShiftsUseCase;
let listSales: ListSalesUseCase;
let getSale: GetSaleUseCase;

function context(organizationId: string, userId: string): TenantContextData {
  return {
    userId,
    sessionId: undefined,
    organizationId,
    roles: ['OWNER'],
    permissions: [
      'pos:register:manage',
      'pos:shift:open',
      'pos:shift:close',
      'pos:sale:create',
      'pos:refund:process',
      'pos:report:view',
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
  repo = new DrizzlePosRepository(db);
  const unitOfWork = new UnitOfWork(noopEventBus);
  createRegister = new CreateRegisterUseCase(repo, txManager);
  openShift = new OpenShiftUseCase(repo, txManager, unitOfWork);
  listRegisters = new ListRegistersUseCase(repo, txManager);
  listShifts = new ListShiftsUseCase(repo, txManager);
  listSales = new ListSalesUseCase(repo, txManager);
  getSale = new GetSaleUseCase(repo, txManager);

  // POS-15: checkout consumes the real inventory stock port (Level 3). The
  // cross-org register lookup below fails BEFORE the port is reached, so a
  // real impl (rather than a stub) proves the failure is RLS, not wiring.
  const invRepo = new DrizzleInventoryRepository(db);
  const stockPort = new InventoryStockPortImpl(invRepo, txManager);
  const portRegistry = new PortRegistry();
  portRegistry.register(INVENTORY_STOCK_PORT, stockPort);
  checkout = new CheckoutUseCase(repo, txManager, unitOfWork, portRegistry);
}, 180_000);

beforeEach(async () =>
  ownerSql.unsafe(
    'TRUNCATE TABLE pos_registers, pos_shifts, pos_sales, pos_sale_lines, pos_payments, pos_refunds, pos_refund_lines, pos_sync_log CASCADE',
  ),
);

afterAll(async () => {
  if (appSql) await appSql.end();
  if (ownerSql) await ownerSql.end();
  if (container) await container.stop();
});

/** Seed a register in the given org (POS-1 binds it to a warehouse). */
async function seedRegister(
  ctx: TenantContextData,
  code = `TILL-${randomUUID().slice(0, 4)}`,
): Promise<{ id: string }> {
  return TenantContext.run(ctx, () =>
    createRegister.execute({ name: 'Isolation Till', code, warehouseId: randomUUID() }),
  );
}

/** Seed a register + open shift + completed sale directly (owner, no RLS). */
async function seedOrgBSale(): Promise<{ registerId: string; saleId: string }> {
  const registerId = randomUUID();
  const shiftId = randomUUID();
  const saleId = randomUUID();
  await ownerSql`
    INSERT INTO pos_registers (id, organization_id, name, code, warehouse_id, receipt_prefix, next_receipt_number, is_active)
    VALUES (${registerId}, ${ORG_B_ID}, 'B Till', 'B-1', ${randomUUID()}, 'R', 1, true)
  `;
  await ownerSql`
    INSERT INTO pos_shifts (id, organization_id, register_id, opened_by, opened_at, opening_float_amount_minor, currency, status)
    VALUES (${shiftId}, ${ORG_B_ID}, ${registerId}, ${USER_B_ID}, now(), 0, 'USD', 'open')
  `;
  await ownerSql`
    INSERT INTO pos_sales (id, organization_id, shift_id, register_id, receipt_number, status,
      subtotal_amount_minor, discount_amount_minor, tax_amount_minor, total_amount_minor, currency, locale, sold_at)
    VALUES (${saleId}, ${ORG_B_ID}, ${shiftId}, ${registerId}, 'R-0001', 'completed',
      1000, 0, 0, 1000, 'USD', 'en', now())
  `;
  await ownerSql`
    INSERT INTO pos_sale_lines (id, organization_id, sale_id, variant_id, sku_snapshot, name_snapshot, quantity,
      unit_price_amount_minor, line_discount_amount_minor, tax_rate_bp, tax_amount_minor, line_total_amount_minor, currency)
    VALUES (${randomUUID()}, ${ORG_B_ID}, ${saleId}, ${randomUUID()}, 'B-SKU', '{}'::jsonb, 1,
      1000, 0, 0, 0, 1000, 'USD')
  `;
  await ownerSql`
    INSERT INTO pos_payments (id, organization_id, sale_id, method, amount_minor, currency, change_amount_minor)
    VALUES (${randomUUID()}, ${ORG_B_ID}, ${saleId}, 'cash', 1000, 'USD', 0)
  `;
  return { registerId, saleId };
}

describe('POS tenant isolation', () => {
  it('TEN-1: org A cannot read an org B register', async () => {
    const { id: registerId } = await seedRegister(orgBContext);
    const result = await TenantContext.run(orgAContext, () =>
      txManager.run((tx) => repo.findRegisterById(registerId, tx)),
    );
    expect(result).toBeUndefined();
  });

  it('TEN-1: org A cannot open a shift on an org B register (POS_REGISTER_NOT_FOUND)', async () => {
    const { id: registerId } = await seedRegister(orgBContext);
    await expect(
      TenantContext.run(orgAContext, () =>
        openShift.execute({ registerId, openingFloatAmountMinor: '0', currency: 'USD' }),
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', message: 'POS_REGISTER_NOT_FOUND' });
  });

  it('TEN-1: org A cannot checkout on an org B register (POS_REGISTER_NOT_FOUND)', async () => {
    const { id: registerId } = await seedRegister(orgBContext);
    await expect(
      TenantContext.run(orgAContext, () =>
        checkout.execute({
          registerId,
          currency: 'USD',
          locale: 'en',
          lines: [
            {
              variantId: randomUUID(),
              sku: 'X-1',
              nameI18n: { en: 'X' },
              quantity: '1',
              unitPriceAmountMinor: '1000',
              lineDiscountAmountMinor: '0',
              taxRateBp: 0,
              currency: 'USD',
            },
          ],
          payments: [
            {
              method: 'cash',
              amountMinor: '1000',
              currency: 'USD',
              tenderedAmountMinor: '1000',
              changeAmountMinor: '0',
            },
          ],
        }),
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', message: 'POS_REGISTER_NOT_FOUND' });
  });

  it('TEN-1: org A register list excludes org B registers', async () => {
    await seedRegister(orgBContext);
    const registers = await TenantContext.run(orgAContext, () => listRegisters.execute());
    expect(registers).toHaveLength(0);
  });

  it('TEN-1: org A shift list excludes org B shifts', async () => {
    await seedOrgBSale();
    const shifts = await TenantContext.run(orgAContext, () => listShifts.execute());
    expect(shifts).toHaveLength(0);
  });

  it('TEN-1: org A sales list excludes org B sales', async () => {
    await seedOrgBSale();
    const page = await TenantContext.run(orgAContext, () => listSales.execute());
    expect(page.items).toHaveLength(0);
  });

  it('TEN-1: org A cannot read an org B sale (POS_SALE_NOT_FOUND)', async () => {
    const { saleId } = await seedOrgBSale();
    await expect(TenantContext.run(orgAContext, () => getSale.execute(saleId))).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'POS_SALE_NOT_FOUND',
    });
  });

  it('TEN-2: an injected organizationId cannot override the session organization', async () => {
    const input = {
      name: 'Injected Till',
      code: 'INJ-1',
      warehouseId: randomUUID(),
      // Passed as an extra field so TS excess-property checks do not apply —
      // the use case ignores it; RLS + TenantContext decide the real org (TEN-2).
      organizationId: ORG_B_ID,
    };
    const result = await TenantContext.run(orgAContext, () => createRegister.execute(input));
    const rows = await ownerSql`SELECT organization_id FROM pos_registers WHERE id = ${result.id}`;
    expect(rows[0]?.organization_id).toBe(ORG_A_ID);
  });

  it('TEN-3: no tenant context exposes zero POS rows', async () => {
    await seedOrgBSale();
    // NO TenantContext: RLS is unset, so every read fails closed — both the
    // bare repo call (no transaction, no SET LOCAL) and a raw SQL read.
    await withoutTenantContext(async () => {
      const registers = await repo.listRegisters();
      expect(registers).toHaveLength(0);
      const rows = await db.execute(sql`SELECT id FROM pos_sales`);
      expect(rows).toHaveLength(0);
    });
  });

  it('AUTHZ-6: an OWNER receives MODULE_NOT_ENTITLED when POS is disabled', async () => {
    const store = new InMemoryEntitlementStore();
    await store.upsert({
      organizationId: ORG_A_ID,
      moduleKey: 'pos',
      state: 'disabled',
      trialStartedAt: null,
      trialEndsAt: null,
      activatedAt: null,
      disabledAt: '2026-01-01T00:00:00Z',
      purgeAfter: null,
    });
    const guard = new EntitlementGuard(new Reflector(), new EntitlementService(store));
    await expect(guard.canActivate(guardContext(['pos:register:manage']))).rejects.toThrow('MODULE_NOT_ENTITLED');
  });

  it('AUTHZ-5: an entitled user without pos:register:manage is denied', () => {
    const guard = new PermissionGuard(new Reflector());
    // `listRegistersRoute` requires pos:register:manage; the user holds only a
    // DIFFERENT pos permission, so the guard must deny (AUTHZ-5).
    expect(() => guard.canActivate(guardContext(['pos:report:view']))).toThrow(ForbiddenException);
  });
});

/**
 * Guard execution context for the AUTHZ-5/6 unit checks.
 *
 * `getHandler` deliberately points at a REAL controller route method
 * (`listRegistersRoute`): the PermissionGuard reads `@RequiresPermission`
 * metadata off that handler, so the assertion only means something while the
 * method exists and carries the decorator. If the method is renamed, this
 * test must be updated alongside — it would otherwise silently pass.
 */
function guardContext(permissions: string[]): Parameters<EntitlementGuard['canActivate']>[0] {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user: { sub: USER_A_ID, organizationId: ORG_A_ID, roles: ['OWNER'], permissions } }),
    }),
    getHandler: () => PosController.prototype.listRegistersRoute,
    getClass: () => PosController,
  } as never;
}
