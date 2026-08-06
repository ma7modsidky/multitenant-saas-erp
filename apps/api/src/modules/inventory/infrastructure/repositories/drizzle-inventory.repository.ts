import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { fromDbDate, toDbDate } from '../../../../core/database/db-date.js';
import { DRIZZLE_DB, type DrizzleDb } from '../../../../core/database/drizzle.provider.js';
import type { TxOrDb } from '../../../../core/database/repository.base.js';
import { TenantContext } from '../../../../core/tenancy/tenant-context.js';
import {
  type InventoryRepository,
  type ProductWithVariantRow,
  type StockLevelRow,
  type WarehouseRow,
} from '../../application/ports/index.js';
import {
  type ProductVariantData,
  type ReservationData,
  type StockCountData,
  type StockCountLineData,
  type StockMovementData,
} from '../../domain/index.js';

/**
 * DrizzleInventoryRepository — Drizzle implementation of InventoryRepository.
 *
 * RLS scopes every query to the current organization (fail-closed), so no
 * manual organization_id filters are used in feature code (hard rule #2).
 * Inserts populate organization_id from TenantContext, never from client input.
 *
 * Ledger discipline (INV-1): inv_stock_movements is append-only — this
 * repository never UPDATEs or DELETEs a movement row.
 */
@Injectable()
export class DrizzleInventoryRepository implements InventoryRepository {
  private readonly variants = sql.identifier('inv_product_variants');
  private readonly products = sql.identifier('inv_products');
  private readonly uoms = sql.identifier('inv_units_of_measure');
  private readonly warehouses = sql.identifier('inv_warehouses');
  private readonly levels = sql.identifier('inv_stock_levels');
  private readonly movements = sql.identifier('inv_stock_movements');
  private readonly reservations = sql.identifier('inv_stock_reservations');
  private readonly counts = sql.identifier('inv_stock_counts');
  private readonly countLines = sql.identifier('inv_stock_count_lines');
  private readonly alerts = sql.identifier('inv_low_stock_alerts');

  constructor(
    @Inject(DRIZZLE_DB)
    private readonly db: DrizzleDb,
  ) {}

  private getDb(tx?: TxOrDb): PostgresJsDatabase {
    return (tx ?? this.db) as PostgresJsDatabase;
  }

  /** `'a','b'` fragment for `IN (...)` — postgres.js can't bind JS arrays. */
  private uuidList(ids: string[]): SQL {
    return sql.join(
      ids.map((id) => sql`${id}`),
      sql.raw(', '),
    );
  }

  // ─── Products & variants ────────────────────────────────────────────────

  async listProducts(tx?: TxOrDb): Promise<ProductWithVariantRow[]> {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(sql`
      SELECT DISTINCT ON (p.id)
        p.id,
        p.name_i18n,
        p.is_active,
        v.id AS variant_id,
        v.sku,
        v.price_amount_minor,
        v.price_currency,
        v.reorder_point,
        p.created_at,
        p.updated_at
      FROM ${this.products} p
      LEFT JOIN ${this.variants} v ON v.product_id = p.id AND v.deleted_at IS NULL
      WHERE p.deleted_at IS NULL
      ORDER BY p.id, p.created_at DESC
    `);
    return rows.map((row) => ({
      id: row.id as string,
      nameI18n: (row.name_i18n as Record<string, string>) ?? {},
      isActive: row.is_active as boolean,
      variantId: (row.variant_id as string | null) ?? null,
      sku: (row.sku as string | null) ?? null,
      priceAmountMinor: (row.price_amount_minor as string | null) ?? null,
      priceCurrency: (row.price_currency as string | null) ?? null,
      reorderPoint: (row.reorder_point as string | null) ?? null,
      createdAt: fromDbDate(row.created_at)?.toISOString() ?? null,
      updatedAt: fromDbDate(row.updated_at)?.toISOString() ?? null,
    }));
  }

  async insertVariant(
    variant: ProductVariantData,
    nameI18n: Record<string, string>,
    tx?: TxOrDb,
  ): Promise<ProductVariantData> {
    const db = this.getDb(tx);
    const organizationId = TenantContext.requireOrganizationId();
    const userId = TenantContext.getUserId() ?? null;
    const now = new Date();

    // The product row requires a unit of measure (NOT NULL FK). Ensure the
    // org's default 'ea' UoM exists, then use it.
    await db.execute(sql`
      INSERT INTO ${this.uoms} (organization_id, code, name_i18n, precision, created_at, updated_at, created_by, updated_by)
      VALUES (${organizationId}, 'ea', ${JSON.stringify({ en: 'Each' })}::jsonb, 0, ${toDbDate(now)}, ${toDbDate(now)}, ${userId}, ${userId})
      ON CONFLICT (organization_id, code) WHERE deleted_at IS NULL DO NOTHING
    `);
    const uomRows = await db.execute<Record<string, unknown>>(sql`
      SELECT id FROM ${this.uoms}
      WHERE organization_id = ${organizationId} AND code = 'ea' AND deleted_at IS NULL LIMIT 1
    `);
    const uomId = uomRows[0]?.id as string;

    await db.execute(sql`
      INSERT INTO ${this.products}
        (id, organization_id, name_i18n, description_i18n, category_id, uom_id,
         is_active, tax_rate_bp, tracking_mode, created_at, updated_at, created_by, updated_by)
      VALUES
        (${variant.productId}, ${organizationId}, ${JSON.stringify(nameI18n)}::jsonb, ${'{}'}::jsonb, NULL, ${uomId},
         ${variant.isActive}, 0, 'quantity', ${toDbDate(variant.createdAt)}, ${toDbDate(variant.updatedAt)}, ${userId}, ${userId})
    `);

    const rows = await db.execute<Record<string, unknown>>(sql`
      INSERT INTO ${this.variants}
        (id, organization_id, product_id, sku, barcode, attributes,
         price_amount_minor, price_currency, cost_amount_minor, cost_currency,
         reorder_point, reorder_quantity, is_active, created_at, updated_at, created_by, updated_by)
      VALUES
        (${variant.id}, ${organizationId}, ${variant.productId}, ${variant.sku}, ${variant.barcode}, ${JSON.stringify(variant.attributes)}::jsonb,
         ${variant.priceAmountMinor}, ${variant.priceCurrency}, ${variant.costAmountMinor}, ${variant.costCurrency},
         ${variant.reorderPoint}, ${variant.reorderQuantity}, ${variant.isActive},
         ${toDbDate(variant.createdAt)}, ${toDbDate(variant.updatedAt)}, ${userId}, ${userId})
      RETURNING *
    `);
    const row = rows[0];
    if (!row) throw new Error('INSERT inv_product_variants RETURNING returned no rows');
    return this.rowToVariant(row);
  }

  async findVariantBySku(sku: string, tx?: TxOrDb): Promise<ProductVariantData | undefined> {
    const db = this.getDb(tx);
    // INV-10: case-insensitive duplicate detection, matching the domain guard.
    const rows = await db.execute<Record<string, unknown>>(sql`
      SELECT * FROM ${this.variants}
      WHERE LOWER(sku) = LOWER(${sku}) AND deleted_at IS NULL LIMIT 1
    `);
    const row = rows[0];
    if (!row) return undefined;
    return this.rowToVariant(row);
  }

  async findVariantById(id: string, tx?: TxOrDb): Promise<ProductVariantData | undefined> {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(
      sql`SELECT * FROM ${this.variants} WHERE id = ${id} AND deleted_at IS NULL LIMIT 1`,
    );
    const row = rows[0];
    if (!row) return undefined;
    return this.rowToVariant(row);
  }

  async variantHasMovements(variantId: string, tx?: TxOrDb): Promise<boolean> {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(
      sql`SELECT EXISTS (SELECT 1 FROM ${this.movements} WHERE variant_id = ${variantId}) AS has_movements`,
    );
    return Boolean(rows[0]?.has_movements);
  }

  async archiveVariant(variantId: string, at: Date, by: string | null, tx?: TxOrDb): Promise<void> {
    const db = this.getDb(tx);
    await db.execute(
      sql`UPDATE ${this.variants}
          SET is_active = false, deleted_at = ${toDbDate(at)}, updated_at = ${toDbDate(at)}, updated_by = ${by}
          WHERE id = ${variantId} AND deleted_at IS NULL`,
    );
  }

  async updateVariantCost(
    variantId: string,
    costAmountMinor: string,
    costCurrency: string,
    tx?: TxOrDb,
  ): Promise<void> {
    const db = this.getDb(tx);
    await db.execute(
      sql`UPDATE ${this.variants}
          SET cost_amount_minor = ${costAmountMinor}, cost_currency = ${costCurrency}, updated_at = NOW()
          WHERE id = ${variantId} AND deleted_at IS NULL`,
    );
  }

  async findMovementByIdempotencyKey(idempotencyKey: string, tx?: TxOrDb): Promise<StockMovementData | undefined> {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(
      sql`SELECT * FROM ${this.movements} WHERE idempotency_key = ${idempotencyKey} LIMIT 1`,
    );
    const row = rows[0];
    if (!row) return undefined;
    return this.rowToMovement(row);
  }

  // ─── Warehouses ─────────────────────────────────────────────────────────

  async listWarehouses(tx?: TxOrDb): Promise<WarehouseRow[]> {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(
      sql`SELECT * FROM ${this.warehouses} WHERE deleted_at IS NULL ORDER BY is_default DESC, name ASC`,
    );
    return rows.map((row) => this.rowToWarehouse(row));
  }

  async findWarehouseById(id: string, tx?: TxOrDb): Promise<WarehouseRow | undefined> {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(
      sql`SELECT * FROM ${this.warehouses} WHERE id = ${id} AND deleted_at IS NULL LIMIT 1`,
    );
    const row = rows[0];
    if (!row) return undefined;
    return this.rowToWarehouse(row);
  }

  async ensureDefaultWarehouse(tx?: TxOrDb): Promise<WarehouseRow> {
    const db = this.getDb(tx);
    const organizationId = TenantContext.requireOrganizationId();
    const userId = TenantContext.getUserId() ?? null;

    await db.execute(
      sql`      INSERT INTO ${this.warehouses}
            (organization_id, name, code, address, is_default, is_active, created_at, updated_at, created_by, updated_by)
          VALUES
            (${organizationId}, 'Default Warehouse', 'DEFAULT', ${'{}'}::jsonb, true, true, NOW(), NOW(), ${userId}, ${userId})
          ON CONFLICT (organization_id, code) WHERE deleted_at IS NULL DO NOTHING`,
    );
    const rows = await db.execute<Record<string, unknown>>(
      sql`SELECT * FROM ${this.warehouses}
          WHERE organization_id = ${organizationId} AND code = 'DEFAULT' AND deleted_at IS NULL LIMIT 1`,
    );
    const row = rows[0];
    if (!row) throw new Error('ensureDefaultWarehouse: default warehouse not found after upsert');
    return this.rowToWarehouse(row);
  }

  // ─── Stock ledger + projection ──────────────────────────────────────────

  async insertMovement(movement: StockMovementData, tx?: TxOrDb): Promise<StockMovementData> {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(sql`
      INSERT INTO ${this.movements}
        (id, organization_id, variant_id, warehouse_id, type, quantity,
         unit_cost_amount_minor, unit_cost_currency, reference_type, reference_id,
         reason_code, idempotency_key, occurred_at, created_by, created_at)
      VALUES
        (${movement.id}, ${movement.organizationId}, ${movement.variantId}, ${movement.warehouseId},
         ${movement.type}, ${movement.quantity}, ${movement.unitCostAmountMinor}, ${movement.unitCostCurrency},
         ${movement.referenceType}, ${movement.referenceId}, ${movement.reasonCode},
         ${movement.idempotencyKey}, ${toDbDate(movement.occurredAt)}, ${movement.createdBy}, NOW())
      RETURNING *
    `);
    const row = rows[0];
    if (!row) throw new Error('INSERT inv_stock_movements RETURNING returned no rows');
    return this.rowToMovement(row);
  }

  async getStockLevel(variantId: string, warehouseId: string, tx?: TxOrDb): Promise<StockLevelRow | undefined> {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(sql`
      SELECT
        sl.variant_id,
        v.sku,
        p.name_i18n,
        sl.warehouse_id,
        w.name AS warehouse_name,
        sl.quantity_on_hand,
        sl.quantity_reserved,
        v.reorder_point,
        sl.last_movement_id
      FROM ${this.levels} sl
      JOIN ${this.variants} v ON v.id = sl.variant_id
      JOIN ${this.products} p ON p.id = v.product_id
      JOIN ${this.warehouses} w ON w.id = sl.warehouse_id
      WHERE sl.variant_id = ${variantId} AND sl.warehouse_id = ${warehouseId} AND sl.deleted_at IS NULL
      LIMIT 1
    `);
    const row = rows[0];
    if (!row) return undefined;
    return this.rowToStockLevel(row);
  }

  async getStockLevels(variantIds: string[], warehouseId: string, tx?: TxOrDb): Promise<StockLevelRow[]> {
    const db = this.getDb(tx);
    if (variantIds.length === 0) return [];
    const rows = await db.execute<Record<string, unknown>>(sql`
      SELECT
        sl.variant_id,
        v.sku,
        p.name_i18n,
        sl.warehouse_id,
        w.name AS warehouse_name,
        sl.quantity_on_hand,
        sl.quantity_reserved,
        v.reorder_point,
        sl.last_movement_id
      FROM ${this.levels} sl
      JOIN ${this.variants} v ON v.id = sl.variant_id
      JOIN ${this.products} p ON p.id = v.product_id
      JOIN ${this.warehouses} w ON w.id = sl.warehouse_id
      WHERE sl.warehouse_id = ${warehouseId} AND sl.variant_id IN (${this.uuidList(variantIds)}) AND sl.deleted_at IS NULL
    `);
    return rows.map((row) => this.rowToStockLevel(row));
  }

  async upsertStockLevel(
    variantId: string,
    warehouseId: string,
    quantityOnHand: string,
    quantityReserved: string,
    lastMovementId: string | null,
    tx?: TxOrDb,
  ): Promise<void> {
    const db = this.getDb(tx);
    const organizationId = TenantContext.requireOrganizationId();
    const userId = TenantContext.getUserId() ?? null;
    await db.execute(
      sql`INSERT INTO ${this.levels}
            (id, organization_id, variant_id, warehouse_id, quantity_on_hand, quantity_reserved,
             last_movement_id, created_at, updated_at, created_by, updated_by)
          VALUES
            (gen_random_uuid(), ${organizationId}, ${variantId}, ${warehouseId}, ${quantityOnHand}, ${quantityReserved},
             ${lastMovementId}, NOW(), NOW(), ${userId}, ${userId})
          ON CONFLICT (organization_id, variant_id, warehouse_id) WHERE deleted_at IS NULL
          DO UPDATE SET
            quantity_on_hand = EXCLUDED.quantity_on_hand,
            quantity_reserved = EXCLUDED.quantity_reserved,
            last_movement_id = EXCLUDED.last_movement_id,
            updated_at = NOW(),
            updated_by = ${userId}`,
    );
  }

  async listStockLevels(tx?: TxOrDb): Promise<StockLevelRow[]> {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(sql`
      SELECT
        sl.variant_id,
        v.sku,
        p.name_i18n,
        sl.warehouse_id,
        w.name AS warehouse_name,
        sl.quantity_on_hand,
        sl.quantity_reserved,
        v.reorder_point,
        sl.last_movement_id
      FROM ${this.levels} sl
      JOIN ${this.variants} v ON v.id = sl.variant_id
      JOIN ${this.products} p ON p.id = v.product_id
      JOIN ${this.warehouses} w ON w.id = sl.warehouse_id
      WHERE sl.deleted_at IS NULL
      ORDER BY p.name_default ASC
    `);
    return rows.map((row) => this.rowToStockLevel(row));
  }

  // ─── Reservations (INV-7, INV-8) ────────────────────────────────────────

  async insertReservation(reservation: ReservationData, tx?: TxOrDb): Promise<ReservationData> {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(sql`
      INSERT INTO ${this.reservations}
        (id, organization_id, variant_id, warehouse_id, quantity, state,
         expires_at, reference_type, reference_id, created_at, updated_at, created_by, updated_by)
      VALUES
        (${reservation.id}, ${reservation.organizationId}, ${reservation.variantId}, ${reservation.warehouseId},
         ${reservation.quantity}, ${reservation.state}, ${toDbDate(reservation.expiresAt)},
         ${reservation.referenceType}, ${reservation.referenceId},
         ${toDbDate(reservation.createdAt)}, ${toDbDate(reservation.updatedAt)},
         ${TenantContext.getUserId() ?? null}, ${TenantContext.getUserId() ?? null})
      RETURNING *
    `);
    const row = rows[0];
    if (!row) throw new Error('INSERT inv_stock_reservations RETURNING returned no rows');
    return this.rowToReservation(row);
  }

  async findReservationById(id: string, tx?: TxOrDb): Promise<ReservationData | undefined> {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(
      sql`SELECT * FROM ${this.reservations} WHERE id = ${id} LIMIT 1`,
    );
    const row = rows[0];
    if (!row) return undefined;
    return this.rowToReservation(row);
  }

  async updateReservationState(id: string, state: ReservationData['state'], at: Date, tx?: TxOrDb): Promise<void> {
    const db = this.getDb(tx);
    await db.execute(
      sql`UPDATE ${this.reservations}
          SET state = ${state}, updated_at = ${toDbDate(at)}, updated_by = ${TenantContext.getUserId() ?? null}
          WHERE id = ${id}`,
    );
  }

  async listExpiredHeldReservations(now: Date, tx?: TxOrDb): Promise<ReservationData[]> {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(
      sql`SELECT * FROM ${this.reservations} WHERE state = 'held' AND expires_at <= ${toDbDate(now)}`,
    );
    return rows.map((row) => this.rowToReservation(row));
  }

  async upsertLowStockAlert(variantId: string, warehouseId: string, triggeredAt: Date, tx?: TxOrDb): Promise<void> {
    const db = this.getDb(tx);
    const organizationId = TenantContext.requireOrganizationId();
    // INV-13: one open alert per (variant, warehouse); a storm can't happen.
    await db.execute(
      sql`INSERT INTO ${this.alerts} (organization_id, variant_id, warehouse_id, triggered_at, created_at, updated_at)
          VALUES (${organizationId}, ${variantId}, ${warehouseId}, ${toDbDate(triggeredAt)}, NOW(), NOW())
          ON CONFLICT (organization_id, variant_id, warehouse_id) WHERE resolved_at IS NULL DO NOTHING`,
    );
  }

  async resolveLowStockAlert(variantId: string, warehouseId: string, resolvedAt: Date, tx?: TxOrDb): Promise<void> {
    const db = this.getDb(tx);
    await db.execute(
      sql`UPDATE ${this.alerts}
          SET resolved_at = ${toDbDate(resolvedAt)}, updated_at = NOW()
          WHERE variant_id = ${variantId} AND warehouse_id = ${warehouseId} AND resolved_at IS NULL`,
    );
  }

  // ─── Stock counts (INV-14) ──────────────────────────────────────────────

  async listStockCounts(tx?: TxOrDb): Promise<StockCountData[]> {
    const db = this.getDb(tx);
    const countRows = await db.execute<Record<string, unknown>>(
      sql`SELECT * FROM ${this.counts} WHERE deleted_at IS NULL ORDER BY created_at DESC`,
    );
    if (countRows.length === 0) return [];

    const lineRows = await db.execute<Record<string, unknown>>(sql`
      SELECT * FROM ${this.countLines}
      WHERE stock_count_id IN (${this.uuidList(countRows.map((r) => r.id as string))}) ORDER BY created_at ASC
    `);
    const linesByCount = new Map<string, StockCountLineData[]>();
    for (const line of lineRows) {
      const key = line.stock_count_id as string;
      const list = linesByCount.get(key) ?? [];
      list.push(this.rowToCountLine(line));
      linesByCount.set(key, list);
    }

    return countRows.map((row) => ({
      id: row.id as string,
      organizationId: row.organization_id as string,
      warehouseId: row.warehouse_id as string,
      status: row.status as StockCountData['status'],
      countedAt: fromDbDate(row.counted_at),
      countedBy: (row.counted_by as string | null) ?? null,
      notes: (row.notes as string | null) ?? null,
      lines: linesByCount.get(row.id as string) ?? [],
      createdAt: fromDbDate(row.created_at) as Date,
      updatedAt: fromDbDate(row.updated_at) as Date,
    }));
  }

  async insertStockCount(count: StockCountData, tx?: TxOrDb): Promise<StockCountData> {
    const db = this.getDb(tx);
    const organizationId = TenantContext.requireOrganizationId();
    const userId = TenantContext.getUserId() ?? null;

    const rows = await db.execute<Record<string, unknown>>(sql`
      INSERT INTO ${this.counts}
        (id, organization_id, warehouse_id, status, counted_at, counted_by, notes, created_at, updated_at, created_by, updated_by)
      VALUES
        (${count.id}, ${organizationId}, ${count.warehouseId}, ${count.status}, ${toDbDate(count.countedAt)},
         ${count.countedBy}, ${count.notes}, ${toDbDate(count.createdAt)}, ${toDbDate(count.updatedAt)}, ${userId}, ${userId})
      RETURNING *
    `);
    const row = rows[0];
    if (!row) throw new Error('INSERT inv_stock_counts RETURNING returned no rows');

    for (const line of count.lines) {
      await db.execute(sql`
        INSERT INTO ${this.countLines}
          (id, organization_id, stock_count_id, variant_id, expected_quantity, counted_quantity, created_at, updated_at, created_by, updated_by)
        VALUES
          (${crypto.randomUUID()}, ${organizationId}, ${count.id}, ${line.variantId},
           ${line.expectedQuantity}, ${line.countedQuantity}, NOW(), NOW(), ${userId}, ${userId})
      `);
    }

    return {
      ...count,
      organizationId,
      createdAt: fromDbDate(row.created_at) as Date,
      updatedAt: fromDbDate(row.updated_at) as Date,
    };
  }

  async applyStockCount(
    count: StockCountData,
    _corrections: Array<{ variantId: string; quantity: string }>,
    tx?: TxOrDb,
  ): Promise<void> {
    const db = this.getDb(tx);
    const organizationId = TenantContext.requireOrganizationId();
    const userId = TenantContext.getUserId() ?? null;

    // Lock the count: applied is immutable (INV-14).
    await db.execute(
      sql`UPDATE ${this.counts}
          SET status = 'applied', counted_at = ${toDbDate(count.countedAt)}, counted_by = ${count.countedBy},
              updated_at = ${toDbDate(count.updatedAt)}, updated_by = ${userId}
          WHERE id = ${count.id} AND deleted_at IS NULL`,
    );

    // Replace the lines so the applied snapshot is the source of truth for the
    // correction movements (variance is a generated column in the DB).
    await db.execute(sql`DELETE FROM ${this.countLines} WHERE stock_count_id = ${count.id}`);
    for (const line of count.lines) {
      await db.execute(sql`
        INSERT INTO ${this.countLines}
          (id, organization_id, stock_count_id, variant_id, expected_quantity, counted_quantity, created_at, updated_at, created_by, updated_by)
        VALUES
          (${crypto.randomUUID()}, ${organizationId}, ${count.id}, ${line.variantId},
           ${line.expectedQuantity}, ${line.countedQuantity}, NOW(), NOW(), ${userId}, ${userId})
      `);
    }
  }

  // ─── Reconciliation (INV-2) ─────────────────────────────────────────────

  async sumMovementsByVariantWarehouse(
    tx?: TxOrDb,
  ): Promise<Array<{ variantId: string; warehouseId: string; total: string }>> {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(sql`
      SELECT variant_id, warehouse_id, SUM(quantity)::text AS total
      FROM ${this.movements}
      GROUP BY variant_id, warehouse_id
    `);
    return rows.map((row) => ({
      variantId: row.variant_id as string,
      warehouseId: row.warehouse_id as string,
      total: this.decimal(row.total),
    }));
  }

  // ─── Row mappers ────────────────────────────────────────────────────────

  /** numeric(18,4) comes back as '10.0000' — normalize to plain decimals. */
  private decimal(value: unknown): string {
    if (typeof value !== 'string' && typeof value !== 'number') return '0';
    const raw = String(value);
    if (!raw.includes('.')) return raw;
    return raw.replace(/\.?0+$/, '') || '0';
  }

  private rowToVariant(row: Record<string, unknown>): ProductVariantData {
    return {
      id: row.id as string,
      organizationId: row.organization_id as string,
      productId: row.product_id as string,
      sku: row.sku as string,
      barcode: (row.barcode as string | null) ?? null,
      attributes: (row.attributes as Record<string, unknown>) ?? {},
      priceAmountMinor: String((row.price_amount_minor as string | null) ?? '0'),
      priceCurrency: row.price_currency as string,
      costAmountMinor: String((row.cost_amount_minor as string | null) ?? '0'),
      costCurrency: row.cost_currency as string,
      reorderPoint: this.decimal(row.reorder_point),
      reorderQuantity: this.decimal(row.reorder_quantity),
      isActive: Boolean(row.is_active),
      createdAt: fromDbDate(row.created_at) as Date,
      updatedAt: fromDbDate(row.updated_at) as Date,
      deletedAt: fromDbDate(row.deleted_at),
    };
  }

  private rowToMovement(row: Record<string, unknown>): StockMovementData {
    return {
      id: row.id as string,
      organizationId: row.organization_id as string,
      variantId: row.variant_id as string,
      warehouseId: row.warehouse_id as string,
      type: row.type as StockMovementData['type'],
      quantity: this.decimal(row.quantity),
      unitCostAmountMinor: (row.unit_cost_amount_minor as string | null) ?? null,
      unitCostCurrency: (row.unit_cost_currency as string | null) ?? null,
      referenceType: row.reference_type as string,
      referenceId: row.reference_id as string,
      reasonCode: (row.reason_code as string | null) ?? null,
      idempotencyKey: (row.idempotency_key as string | null) ?? null,
      occurredAt: fromDbDate(row.occurred_at) as Date,
      createdBy: (row.created_by as string | null) ?? null,
    };
  }

  private rowToReservation(row: Record<string, unknown>): ReservationData {
    return {
      id: row.id as string,
      organizationId: row.organization_id as string,
      variantId: row.variant_id as string,
      warehouseId: row.warehouse_id as string,
      quantity: this.decimal(row.quantity),
      state: row.state as ReservationData['state'],
      expiresAt: fromDbDate(row.expires_at) as Date,
      referenceType: row.reference_type as string,
      referenceId: row.reference_id as string,
      createdAt: fromDbDate(row.created_at) as Date,
      updatedAt: fromDbDate(row.updated_at) as Date,
    };
  }

  private rowToWarehouse(row: Record<string, unknown>): WarehouseRow {
    return {
      id: row.id as string,
      name: row.name as string,
      code: row.code as string,
      isDefault: Boolean(row.is_default),
      isActive: Boolean(row.is_active),
    };
  }

  private rowToStockLevel(row: Record<string, unknown>): StockLevelRow {
    return {
      variantId: row.variant_id as string,
      sku: row.sku as string,
      nameI18n: (row.name_i18n as Record<string, string>) ?? {},
      warehouseId: row.warehouse_id as string,
      warehouseName: row.warehouse_name as string,
      quantityOnHand: this.decimal(row.quantity_on_hand),
      quantityReserved: this.decimal(row.quantity_reserved),
      reorderPoint: this.decimal(row.reorder_point),
      lastMovementId: (row.last_movement_id as string | null) ?? null,
    };
  }

  private rowToCountLine(row: Record<string, unknown>): StockCountLineData {
    return {
      id: row.id as string,
      variantId: row.variant_id as string,
      expectedQuantity: this.decimal(row.expected_quantity),
      countedQuantity: this.decimal(row.counted_quantity),
      variance: this.decimal(row.variance),
    };
  }
}
