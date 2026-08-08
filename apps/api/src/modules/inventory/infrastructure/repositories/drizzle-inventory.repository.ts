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
  type MovementListFilter,
  type MovementRow,
  type PageResult,
  type ProductListFilter,
  type ProductRow,
  type ProductWithVariantRow,
  type ReservationListFilter,
  type ReservationRow,
  type StockCountLineRow,
  type StockCountListFilter,
  type StockLevelListFilter,
  type StockLevelRow,
  type VariantListFilter,
  type VariantListRow,
  type WarehouseRow,
} from '../../application/ports/index.js';
import {
  InventoryError,
  INVENTORY_ERROR_CODE,
  type ProductVariantData,
  type ReservationData,
  type StockCountData,
  type StockCountLineData,
  type StockMovementData,
} from '../../domain/index.js';

/**
 * One variant as parsed from the jsonb_agg array in listProducts. jsonb
 * numbers (numeric columns) arrive as JS numbers and text as strings — money
 * is stringified to keep the decimal-string contract (hard rule #3 / INV-15).
 */
type JsonVariant = {
  id?: string | null;
  sku?: string | null;
  price_amount_minor?: string | number | null;
  price_currency?: string | null;
  reorder_point?: string | number | null;
  is_active?: unknown;
};

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

  async listProducts(filter: ProductListFilter = {}, tx?: TxOrDb): Promise<PageResult<ProductWithVariantRow>> {
    const db = this.getDb(tx);
    const search = filter.search?.trim() ?? '';
    const page = Math.max(1, filter.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, filter.pageSize ?? 12));
    const offset = (page - 1) * pageSize;

    // Status is derived from variant presence: a product is "active" while it
    // has a non-deleted variant (INV-11 keeps history after the last archive).
    // The derived is_active also drives the response badge, so the archived
    // filter and the UI stay consistent. RLS scopes everything tenant-local.
    // The variant JOIN intentionally includes archived variants so an archived
    // product still displays its last SKU/price (history is never lost); the
    // active-variant EXISTS keeps the status derivation accurate.
    //
    // All of a product's variants are aggregated into one JSON array (newest
    // ACTIVE first, archived last) so the grouped products table renders every
    // variant under its product header in a single request. Element 0 doubles
    // as the display variant — the `variant_id`/`sku`/`price` convenience
    // fields below stay backward-compatible with the old single-variant shape.
    const hasActiveVariant = sql`EXISTS (SELECT 1 FROM ${this.variants} xa WHERE xa.product_id = p.id AND xa.deleted_at IS NULL)`;
    const conditions = [
      sql`p.deleted_at IS NULL`,
      sql`(${search} = '' OR p.name_default ILIKE ${`%${search}%`} OR v.sku ILIKE ${`%${search}%`} OR v.barcode ILIKE ${`%${search}%`})`,
    ];
    if (filter.status === 'active') {
      conditions.push(hasActiveVariant);
    } else if (filter.status === 'archived') {
      conditions.push(sql`NOT ${hasActiveVariant}`);
    }
    const where = sql.join(conditions, sql.raw(' AND '));

    const select = sql`SELECT
        p.id,
        p.name_default,
        p.name_i18n,
        p.description_i18n,
        ${hasActiveVariant} AS is_active,
        COALESCE(jsonb_agg(
          jsonb_build_object(
            'id', v.id,
            'sku', v.sku,
            'price_amount_minor', v.price_amount_minor,
            'price_currency', v.price_currency,
            'reorder_point', v.reorder_point,
            'is_active', v.is_active
          )
          ORDER BY (v.deleted_at IS NULL) DESC, v.created_at DESC, v.id
        ) FILTER (WHERE v.id IS NOT NULL), '[]'::jsonb) AS variants,
        p.created_at,
        p.updated_at,
        (SELECT count(*)::int FROM ${this.variants} vc WHERE vc.product_id = p.id AND vc.deleted_at IS NULL) AS variant_count
      FROM ${this.products} p
      LEFT JOIN ${this.variants} v ON v.product_id = p.id
      WHERE ${where}
      GROUP BY p.id, p.name_default, p.name_i18n, p.description_i18n, p.created_at, p.updated_at`;

    const countRows = await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM (${select}) q`);
    const total = Number(countRows[0]?.n ?? 0);

    const rows = await db.execute<Record<string, unknown>>(sql`
      SELECT * FROM (${select}) q
      ORDER BY q.name_default ASC NULLS LAST, q.id
      LIMIT ${pageSize} OFFSET ${offset}
    `);
    return {
      items: rows.map((row) => {
        // jsonb_agg returns parsed JSON — numeric(18,4) columns arrive as JS
        // numbers (jsonb drops trailing zeros), so stringify them to keep the
        // money/decimal string contract (hard rule #3 / INV-15).
        const rawVariants = Array.isArray(row.variants) ? (row.variants as JsonVariant[]) : [];
        const primary = rawVariants[0];
        const toVariant = (v: JsonVariant) => ({
          id: v.id as string,
          sku: v.sku as string,
          priceAmountMinor: String(v.price_amount_minor ?? '0'),
          priceCurrency: v.price_currency ?? 'USD',
          reorderPoint: String(v.reorder_point ?? '0'),
          isActive: Boolean(v.is_active),
        });
        return {
          id: row.id as string,
          nameI18n: (row.name_i18n as Record<string, string>) ?? {},
          descriptionI18n: (row.description_i18n as Record<string, string>) ?? {},
          isActive: Boolean(row.is_active),
          variantId: primary?.id ?? null,
          sku: primary?.sku ?? null,
          priceAmountMinor: primary ? String(primary.price_amount_minor ?? '0') : null,
          priceCurrency: primary ? (primary.price_currency ?? 'USD') : null,
          reorderPoint: primary ? String(primary.reorder_point ?? '0') : null,
          createdAt: fromDbDate(row.created_at)?.toISOString() ?? null,
          updatedAt: fromDbDate(row.updated_at)?.toISOString() ?? null,
          variantCount: Number(row.variant_count ?? 0),
          variants: rawVariants.map(toVariant),
        };
      }),
      total,
      page,
      pageSize,
    };
  }

  async listVariants(filter: VariantListFilter = {}, tx?: TxOrDb): Promise<PageResult<VariantListRow>> {
    const db = this.getDb(tx);
    const search = filter.search?.trim() ?? '';
    const page = Math.max(1, filter.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, filter.pageSize ?? 12));
    const offset = (page - 1) * pageSize;

    // Sellable variants only (deleted_at IS NULL) — pickers must never offer
    // archived units. RLS scopes everything tenant-local.
    const conditions = [
      sql`v.deleted_at IS NULL`,
      sql`p.deleted_at IS NULL`,
      sql`(${search} = '' OR p.name_default ILIKE ${`%${search}%`} OR v.sku ILIKE ${`%${search}%`} OR v.barcode ILIKE ${`%${search}%`})`,
    ];
    const where = sql.join(conditions, sql.raw(' AND '));

    const select = sql`SELECT
        v.id AS variant_id,
        v.product_id,
        v.sku,
        p.name_i18n
      FROM ${this.variants} v
      JOIN ${this.products} p ON p.id = v.product_id
      WHERE ${where}`;

    const countRows = await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM (${select}) q`);
    const total = Number(countRows[0]?.n ?? 0);

    const rows = await db.execute<Record<string, unknown>>(sql`
      ${select}
      ORDER BY p.name_default ASC NULLS LAST, v.created_at ASC, v.id
      LIMIT ${pageSize} OFFSET ${offset}
    `);
    return {
      items: rows.map((row) => ({
        variantId: row.variant_id as string,
        productId: row.product_id as string,
        sku: row.sku as string,
        nameI18n: (row.name_i18n as Record<string, string>) ?? {},
      })),
      total,
      page,
      pageSize,
    };
  }

  async findProductById(id: string, tx?: TxOrDb): Promise<ProductRow | undefined> {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(sql`
      SELECT id, name_i18n, description_i18n, is_active, created_at, updated_at, created_by, updated_by
      FROM ${this.products}
      WHERE id = ${id} AND deleted_at IS NULL LIMIT 1
    `);
    const row = rows[0];
    if (!row) return undefined;
    return {
      id: row.id as string,
      nameI18n: (row.name_i18n as Record<string, string>) ?? {},
      descriptionI18n: (row.description_i18n as Record<string, string>) ?? {},
      isActive: row.is_active as boolean,
      createdAt: fromDbDate(row.created_at) as Date,
      updatedAt: fromDbDate(row.updated_at) as Date,
      createdByUserId: (row.created_by as string | null) ?? null,
      updatedByUserId: (row.updated_by as string | null) ?? null,
    };
  }

  async listVariantsByProduct(productId: string, tx?: TxOrDb): Promise<ProductVariantData[]> {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(sql`
      SELECT * FROM ${this.variants}
      WHERE product_id = ${productId}
      ORDER BY created_at ASC
    `);
    return rows.map((row) => this.rowToVariant(row));
  }

  async insertVariantForProduct(variant: ProductVariantData, tx?: TxOrDb): Promise<ProductVariantData> {
    const db = this.getDb(tx);
    const organizationId = TenantContext.requireOrganizationId();
    const userId = TenantContext.getUserId() ?? null;
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

  async findVariantByIdIncludingDeleted(id: string, tx?: TxOrDb): Promise<ProductVariantData | undefined> {
    const db = this.getDb(tx);
    // No deleted_at filter — the unarchive use case must read the archived row
    // before restoring it (findVariantById intentionally excludes it).
    const rows = await db.execute<Record<string, unknown>>(
      sql`SELECT * FROM ${this.variants} WHERE id = ${id} LIMIT 1`,
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

  async unarchiveVariant(variantId: string, at: Date, by: string | null, tx?: TxOrDb): Promise<void> {
    const db = this.getDb(tx);
    // Lifts the soft delete (INV-11 inverse): the variant is sellable again.
    // updated_by is stamped so the detail view's "last edited by" is accurate.
    await db.execute(
      sql`UPDATE ${this.variants}
          SET is_active = true, deleted_at = NULL, updated_at = ${toDbDate(at)}, updated_by = ${by}
          WHERE id = ${variantId} AND deleted_at IS NOT NULL`,
    );
  }

  async updateProduct(
    productId: string,
    patch: { nameI18n?: Record<string, string>; descriptionI18n?: Record<string, string> },
    at: Date,
    by: string | null,
    tx?: TxOrDb,
  ): Promise<void> {
    const db = this.getDb(tx);
    // Only the provided columns are rewritten; the DTO guarantees at least one.
    const sets: SQL[] = [];
    if (patch.nameI18n !== undefined) {
      sets.push(sql`name_i18n = ${JSON.stringify(patch.nameI18n)}::jsonb`);
    }
    if (patch.descriptionI18n !== undefined) {
      sets.push(sql`description_i18n = ${JSON.stringify(patch.descriptionI18n)}::jsonb`);
    }
    if (sets.length === 0) return;
    await db.execute(
      sql`UPDATE ${this.products}
          SET ${sql.join(sets, sql.raw(', '))}, updated_at = ${toDbDate(at)}, updated_by = ${by}
          WHERE id = ${productId} AND deleted_at IS NULL`,
    );
  }

  async updateVariant(variant: ProductVariantData, tx?: TxOrDb): Promise<void> {
    const db = this.getDb(tx);
    await db.execute(
      sql`UPDATE ${this.variants}
          SET sku = ${variant.sku}, barcode = ${variant.barcode},
              price_amount_minor = ${variant.priceAmountMinor}, price_currency = ${variant.priceCurrency},
              cost_amount_minor = ${variant.costAmountMinor}, cost_currency = ${variant.costCurrency},
              reorder_point = ${variant.reorderPoint}, reorder_quantity = ${variant.reorderQuantity},
              updated_at = ${toDbDate(variant.updatedAt)}, updated_by = ${TenantContext.getUserId() ?? null}
          WHERE id = ${variant.id} AND deleted_at IS NULL`,
    );
  }

  async updateVariantCost(
    variantId: string,
    costAmountMinor: string,
    costCurrency: string,
    tx?: TxOrDb,
  ): Promise<void> {
    const db = this.getDb(tx);
    // The moving-average cost write (INV-12) is still a user-driven change —
    // stamp updated_by so the detail view's "last edited by" stays accurate
    // (the receiving user is the same one recorded on the movement row).
    await db.execute(
      sql`UPDATE ${this.variants}
          SET cost_amount_minor = ${costAmountMinor}, cost_currency = ${costCurrency},
              updated_at = NOW(), updated_by = ${TenantContext.getUserId() ?? null}
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

  async insertWarehouse(
    data: { id: string; name: string; code: string; isDefault: boolean },
    tx?: TxOrDb,
  ): Promise<WarehouseRow> {
    const db = this.getDb(tx);
    const organizationId = TenantContext.requireOrganizationId();
    const userId = TenantContext.getUserId() ?? null;
    const rows = await db.execute<Record<string, unknown>>(sql`
      INSERT INTO ${this.warehouses}
        (id, organization_id, name, code, address, is_default, is_active, created_at, updated_at, created_by, updated_by)
      VALUES
        (${data.id}, ${organizationId}, ${data.name}, ${data.code}, ${'{}'}::jsonb, ${data.isDefault}, true, NOW(), NOW(), ${userId}, ${userId})
      ON CONFLICT (organization_id, code) WHERE deleted_at IS NULL DO NOTHING
      RETURNING *
    `);
    const row = rows[0];
    if (!row)
      throw new InventoryError(
        INVENTORY_ERROR_CODE.WAREHOUSE_DUPLICATE_CODE,
        'A warehouse with this code already exists.',
      );
    return this.rowToWarehouse(row);
  }

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
        p.id AS product_id,
        p.name_i18n,
        sl.warehouse_id,
        w.name AS warehouse_name,
        sl.quantity_on_hand,
        sl.quantity_reserved,
        v.reorder_point,
        sl.last_movement_id,
        v.cost_amount_minor AS unit_cost_amount_minor,
        v.cost_currency AS unit_cost_currency
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
        p.id AS product_id,
        p.name_i18n,
        sl.warehouse_id,
        w.name AS warehouse_name,
        sl.quantity_on_hand,
        sl.quantity_reserved,
        v.reorder_point,
        sl.last_movement_id,
        v.cost_amount_minor AS unit_cost_amount_minor,
        v.cost_currency AS unit_cost_currency
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

  async listStockLevels(filter: StockLevelListFilter = {}, tx?: TxOrDb): Promise<PageResult<StockLevelRow>> {
    const db = this.getDb(tx);
    const search = filter.search?.trim() ?? '';
    const page = Math.max(1, filter.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, filter.pageSize ?? 12));
    const offset = (page - 1) * pageSize;
    const all = Boolean(filter.all);

    // RLS scopes the whole query to the tenant; the warehouse filter is a
    // client-visible narrowing, never a tenant bypass. Reorder comparison is
    // numeric — the columns are numeric(18,4), so SQL compares them exactly
    // (INV-15) and the frontend never sees floats.
    //
    // The USER-FACING stock table lists every sellable variant (left-joined to
    // the projection) so a variant that has never received stock still shows
    // with zero quantities and its reorder point — that is the row the
    // receive/adjust actions act on. A brand-new org has no warehouse row yet
    // (the default is created lazily on the first receipt), so the warehouse
    // join is a LEFT JOIN and those rows carry a NULL warehouse id.
    //
    // Internal batch reads (jobs, product-detail composition) pass `all` and
    // keep the leveled-only INNER join: the low-stock alert job must never
    // alert on never-received variants, and the detail view attaches real
    // level rows. (The API low-stock chip below DOES include never-received
    // variants when they are below their reorder point — that matches their
    // "Low stock" badge; the job, by contrast, only tracks leveled pairs.)
    const from = all
      ? sql`
        FROM ${this.levels} sl
        JOIN ${this.variants} v ON v.id = sl.variant_id
        JOIN ${this.products} p ON p.id = v.product_id
        JOIN ${this.warehouses} w ON w.id = sl.warehouse_id`
      : sql`
        FROM ${this.variants} v
        JOIN ${this.products} p ON p.id = v.product_id
        ${
          filter.warehouseId
            ? sql`JOIN ${this.warehouses} w ON w.id = ${filter.warehouseId} AND w.deleted_at IS NULL`
            : sql`LEFT JOIN ${this.warehouses} w ON w.deleted_at IS NULL`
        }
        LEFT JOIN ${this.levels} sl ON sl.variant_id = v.id AND sl.warehouse_id = w.id AND sl.deleted_at IS NULL`;

    const conditions = [sql`(${search} = '' OR p.name_default ILIKE ${`%${search}%`} OR v.sku ILIKE ${`%${search}%`})`];
    if (all) {
      conditions.push(sql`sl.deleted_at IS NULL`);
    } else {
      conditions.push(sql`v.deleted_at IS NULL`, sql`p.deleted_at IS NULL`);
    }
    if (filter.lowStock) {
      // INV-13: low means AVAILABLE (on-hand − reserved, INV-5) < reorder
      // point — the same strict comparison as the stock-page badge, the
      // dashboard widget, and the low-stock job. COALESCE keeps never-
      // received variants (zero available) consistent with their badge: they
      // ARE low when their reorder point is positive, and a reorder point of
      // 0 never floods the chip (0 < 0 is false).
      conditions.push(sql`COALESCE(sl.quantity_on_hand, 0) - COALESCE(sl.quantity_reserved, 0) < v.reorder_point`);
    }
    const where = sql.join(conditions, sql.raw(' AND '));

    // One shared select for both join shapes (in the INNER case v/w equal
    // the level's own ids, and the COALESCE/CASE are no-ops on non-null
    // level rows). Untracked rows get zero quantities and a NULL unit cost so
    // the stock-valuation widget never counts never-received variants.
    const select = sql`SELECT
        v.id AS variant_id,
        v.sku,
        p.id AS product_id,
        p.name_i18n,
        w.id AS warehouse_id,
        w.name AS warehouse_name,
        COALESCE(sl.quantity_on_hand, 0) AS quantity_on_hand,
        COALESCE(sl.quantity_reserved, 0) AS quantity_reserved,
        v.reorder_point,
        sl.last_movement_id,
        CASE WHEN sl.id IS NULL THEN NULL ELSE v.cost_amount_minor END AS unit_cost_amount_minor,
        CASE WHEN sl.id IS NULL THEN NULL ELSE v.cost_currency END AS unit_cost_currency
      ${from}
      WHERE ${where}`;

    // Internal batch reads (jobs, product-detail composition) pass `all` to
    // avoid silent truncation; the API never does — it paginates instead.
    const pageClause = all ? sql`` : sql`LIMIT ${pageSize} OFFSET ${offset}`;

    const countRows = await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM (${select}) q`);
    const total = Number(countRows[0]?.n ?? 0);

    const rows = await db.execute<Record<string, unknown>>(sql`
      ${select}
      ORDER BY p.name_default ASC, v.id, w.id NULLS LAST
      ${pageClause}
    `);
    return {
      items: rows.map((row) => this.rowToStockLevel(row)),
      total,
      page: all ? 1 : page,
      pageSize: all ? rows.length : pageSize,
    };
  }

  async listMovements(filter: MovementListFilter = {}, tx?: TxOrDb): Promise<PageResult<MovementRow>> {
    const db = this.getDb(tx);
    const search = filter.search?.trim() ?? '';
    const page = Math.max(1, filter.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, filter.pageSize ?? 12));
    const offset = (page - 1) * pageSize;

    // INV-1: the append-only ledger, newest first. Variants/warehouses join
    // without deleted_at filters so archived products keep their history.
    const conditions = [
      sql`TRUE`,
      sql`(${search} = '' OR p.name_default ILIKE ${`%${search}%`} OR v.sku ILIKE ${`%${search}%`})`,
    ];
    if (filter.type) {
      conditions.push(sql`m.type = ${filter.type}`);
    }
    if (filter.fromDate) {
      conditions.push(sql`m.occurred_at >= ${filter.fromDate}::date`);
    }
    if (filter.toDate) {
      // Inclusive: a movement on toDate itself still matches.
      conditions.push(sql`m.occurred_at < (${filter.toDate}::date + interval '1 day')`);
    }
    const where = sql.join(conditions, sql.raw(' AND '));

    const select = sql`SELECT
        m.id,
        m.type,
        m.variant_id,
        v.sku,
        p.name_i18n,
        m.warehouse_id,
        w.name AS warehouse_name,
        m.quantity,
        m.unit_cost_amount_minor,
        m.unit_cost_currency,
        m.reference_type,
        m.reference_id,
        m.reason_code,
        m.occurred_at,
        m.created_by
      FROM ${this.movements} m
      JOIN ${this.variants} v ON v.id = m.variant_id
      JOIN ${this.products} p ON p.id = v.product_id
      LEFT JOIN ${this.warehouses} w ON w.id = m.warehouse_id
      WHERE ${where}`;

    // Internal batch reads (product-detail composition) pass `all` to avoid
    // silent truncation; the API never does — it paginates instead.
    const pageClause = filter.all ? sql`` : sql`LIMIT ${pageSize} OFFSET ${offset}`;

    const countRows = await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM (${select}) q`);
    const total = Number(countRows[0]?.n ?? 0);

    const rows = await db.execute<Record<string, unknown>>(sql`
      ${select}
      ORDER BY m.occurred_at DESC, m.id DESC
      ${pageClause}
    `);
    return {
      items: rows.map((row) => this.rowToMovementRow(row)),
      total,
      page: filter.all ? 1 : page,
      pageSize: filter.all ? rows.length : pageSize,
    };
  }

  // ─── Reservations (INV-7, INV-8) ────────────────────────────────────────

  async listReservations(filter: ReservationListFilter = {}, tx?: TxOrDb): Promise<PageResult<ReservationRow>> {
    const db = this.getDb(tx);
    const page = Math.max(1, filter.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, filter.pageSize ?? 12));
    const offset = (page - 1) * pageSize;

    // Status is a client-visible narrowing on top of the RLS tenant scope.
    const conditions = [sql`TRUE`];
    if (filter.status) {
      conditions.push(sql`r.state = ${filter.status}`);
    }
    const where = sql.join(conditions, sql.raw(' AND '));

    const select = sql`SELECT
        r.id,
        r.variant_id,
        v.sku,
        p.name_i18n,
        r.warehouse_id,
        w.name AS warehouse_name,
        r.quantity,
        r.state,
        r.expires_at,
        r.reference_type,
        r.reference_id,
        r.created_at
      FROM ${this.reservations} r
      JOIN ${this.variants} v ON v.id = r.variant_id
      JOIN ${this.products} p ON p.id = v.product_id
      JOIN ${this.warehouses} w ON w.id = r.warehouse_id
      WHERE ${where}`;

    const countRows = await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM (${select}) q`);
    const total = Number(countRows[0]?.n ?? 0);

    const rows = await db.execute<Record<string, unknown>>(sql`
      ${select}
      ORDER BY r.created_at DESC, r.id DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `);
    return {
      items: rows.map((row) => ({
        id: row.id as string,
        variantId: row.variant_id as string,
        sku: (row.sku as string | null) ?? '',
        nameI18n: (row.name_i18n as Record<string, string>) ?? {},
        warehouseId: row.warehouse_id as string,
        warehouseName: row.warehouse_name as string,
        quantity: this.decimal(row.quantity),
        state: row.state as ReservationRow['state'],
        expiresAt: fromDbDate(row.expires_at)?.toISOString() ?? '',
        referenceType: row.reference_type as string,
        referenceId: row.reference_id as string,
        createdAt: fromDbDate(row.created_at)?.toISOString() ?? '',
      })),
      total,
      page,
      pageSize,
    };
  }

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

  async findStockCountById(id: string, tx?: TxOrDb): Promise<StockCountData | undefined> {
    const db = this.getDb(tx);
    const countRows = await db.execute<Record<string, unknown>>(
      sql`SELECT * FROM ${this.counts} WHERE id = ${id} AND deleted_at IS NULL LIMIT 1`,
    );
    const row = countRows[0];
    if (!row) return undefined;
    const lineRows = await db.execute<Record<string, unknown>>(
      sql`SELECT * FROM ${this.countLines} WHERE stock_count_id = ${id} ORDER BY created_at ASC`,
    );
    return {
      id: row.id as string,
      organizationId: row.organization_id as string,
      warehouseId: row.warehouse_id as string,
      status: row.status as StockCountData['status'],
      countedAt: fromDbDate(row.counted_at),
      countedBy: (row.counted_by as string | null) ?? null,
      notes: (row.notes as string | null) ?? null,
      lines: lineRows.map((line) => this.rowToCountLine(line)),
      createdAt: fromDbDate(row.created_at) as Date,
      updatedAt: fromDbDate(row.updated_at) as Date,
    };
  }

  async listStockCountLines(id: string, tx?: TxOrDb): Promise<StockCountLineRow[]> {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(sql`
      SELECT
        cl.id,
        cl.variant_id,
        v.sku,
        p.name_i18n,
        cl.expected_quantity,
        cl.counted_quantity,
        cl.variance
      FROM ${this.countLines} cl
      JOIN ${this.variants} v ON v.id = cl.variant_id
      JOIN ${this.products} p ON p.id = v.product_id
      WHERE cl.stock_count_id = ${id}
      ORDER BY cl.created_at ASC
    `);
    return rows.map((row) => ({
      id: row.id as string,
      variantId: row.variant_id as string,
      sku: (row.sku as string | null) ?? '',
      nameI18n: (row.name_i18n as Record<string, string>) ?? {},
      expectedQuantity: this.decimal(row.expected_quantity),
      countedQuantity: this.decimal(row.counted_quantity),
      variance: this.decimal(row.variance),
    }));
  }

  async listStockCounts(filter: StockCountListFilter = {}, tx?: TxOrDb): Promise<PageResult<StockCountData>> {
    const db = this.getDb(tx);
    const page = Math.max(1, filter.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, filter.pageSize ?? 12));
    const offset = (page - 1) * pageSize;

    const conditions = [sql`deleted_at IS NULL`];
    if (filter.status) {
      conditions.push(sql`status = ${filter.status}`);
    }
    const where = sql.join(conditions, sql.raw(' AND '));

    const countRows = await db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM ${this.counts} WHERE ${where}`,
    );
    const total = Number(countRows[0]?.n ?? 0);

    const rows = await db.execute<Record<string, unknown>>(sql`
      SELECT * FROM ${this.counts}
      WHERE ${where}
      ORDER BY created_at DESC, id DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `);
    if (rows.length === 0) return { items: [], total, page, pageSize };

    const lineRows = await db.execute<Record<string, unknown>>(sql`
      SELECT * FROM ${this.countLines}
      WHERE stock_count_id IN (${this.uuidList(rows.map((r) => r.id as string))}) ORDER BY created_at ASC
    `);
    const linesByCount = new Map<string, StockCountLineData[]>();
    for (const line of lineRows) {
      const key = line.stock_count_id as string;
      const list = linesByCount.get(key) ?? [];
      list.push(this.rowToCountLine(line));
      linesByCount.set(key, list);
    }

    return {
      items: rows.map((row) => ({
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
      })),
      total,
      page,
      pageSize,
    };
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

  private rowToMovementRow(row: Record<string, unknown>): MovementRow {
    return {
      id: row.id as string,
      type: row.type as string,
      variantId: row.variant_id as string,
      sku: (row.sku as string | null) ?? '',
      nameI18n: (row.name_i18n as Record<string, string>) ?? {},
      warehouseId: (row.warehouse_id as string | null) ?? null,
      warehouseName: (row.warehouse_name as string | null) ?? null,
      quantity: this.decimal(row.quantity),
      unitCostAmountMinor: (row.unit_cost_amount_minor as string | null) ?? null,
      unitCostCurrency: (row.unit_cost_currency as string | null) ?? null,
      referenceType: row.reference_type as string,
      referenceId: row.reference_id as string,
      reasonCode: (row.reason_code as string | null) ?? null,
      occurredAt: fromDbDate(row.occurred_at)?.toISOString() ?? '',
      createdBy: (row.created_by as string | null) ?? null,
    };
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
      createdByUserId: (row.created_by as string | null) ?? null,
      updatedByUserId: (row.updated_by as string | null) ?? null,
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
      // The stock table groups rows by product — the stock-page grouping.
      productId: row.product_id as string,
      nameI18n: (row.name_i18n as Record<string, string>) ?? {},
      warehouseId: (row.warehouse_id as string | null) ?? null,
      warehouseName: (row.warehouse_name as string | null) ?? null,
      quantityOnHand: this.decimal(row.quantity_on_hand),
      quantityReserved: this.decimal(row.quantity_reserved),
      reorderPoint: this.decimal(row.reorder_point),
      lastMovementId: (row.last_movement_id as string | null) ?? null,
      unitCostAmountMinor: (row.unit_cost_amount_minor as string | null) ?? null,
      unitCostCurrency: (row.unit_cost_currency as string | null) ?? null,
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
