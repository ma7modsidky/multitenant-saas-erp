import type { TxOrDb } from '../../../../core/database/repository.base.js';
import type { ProductVariantData, ReservationData, StockCountData, StockMovementData } from '../../domain/index.js';

/** DI token for the inventory repository. */
export const INVENTORY_REPOSITORY = Symbol('INVENTORY_REPOSITORY');

/** Row shape for a product + its first/active variant (list endpoint). */
export interface ProductWithVariantRow {
  id: string;
  nameI18n: Record<string, string>;
  descriptionI18n: Record<string, string>;
  isActive: boolean;
  variantId: string | null;
  sku: string | null;
  priceAmountMinor: string | null;
  priceCurrency: string | null;
  reorderPoint: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  /** Number of non-deleted variants (INV-11) — the products-table "Variants" column. */
  variantCount: number;
  /**
   * EVERY variant of the product (active + archived, INV-11), newest active
   * first — the grouped products table renders these rows under a product
   * header. Element 0 is also the display variant (matches `sku`/`price`).
   */
  variants: ProductListItemVariant[];
}

/** One variant inside a product list row (the grouped products table). */
export interface ProductListItemVariant {
  id: string;
  sku: string;
  priceAmountMinor: string;
  priceCurrency: string;
  reorderPoint: string;
  isActive: boolean;
}

/** Row shape for a sellable variant in the variants picker (list endpoint). */
export interface VariantListRow {
  variantId: string;
  productId: string;
  sku: string;
  nameI18n: Record<string, string>;
}

/** A product row without its variants (detail endpoint). */
export interface ProductRow {
  id: string;
  nameI18n: Record<string, string>;
  descriptionI18n: Record<string, string>;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  /** Actor stamps (inv_products.created_by/updated_by) — audit trail. */
  createdByUserId: string | null;
  updatedByUserId: string | null;
}

/** A reservation row joined with the names the UI needs. */
export interface ReservationRow {
  id: string;
  variantId: string;
  sku: string;
  nameI18n: Record<string, string>;
  warehouseId: string;
  warehouseName: string;
  quantity: string;
  state: ReservationData['state'];
  expiresAt: string;
  referenceType: string;
  referenceId: string;
  createdAt: string;
}

/** Stock projection row (list endpoint). */
export interface StockLevelRow {
  variantId: string;
  sku: string;
  /** Owning product — the stock page groups variant rows under it. */
  productId: string;
  nameI18n: Record<string, string>;
  /**
   * Warehouse id — null only for a never-received variant when the org has
   * no warehouse row yet (the stock page shows the default target until the
   * first receipt lazily creates it).
   */
  warehouseId: string | null;
  warehouseName: string | null;
  quantityOnHand: string;
  quantityReserved: string;
  reorderPoint: string;
  /** Last movement id that updated this projection (INV-2). */
  lastMovementId: string | null;
  /** Variant cost (for the stock-valuation widget / reports). */
  unitCostAmountMinor: string | null;
  unitCostCurrency: string | null;
}

/** One ledger row with the names the UI needs (stock movements view). */
export interface MovementRow {
  id: string;
  type: string;
  /** Owning variant — lets detail views filter the ledger. */
  variantId: string;
  sku: string;
  nameI18n: Record<string, string>;
  warehouseId: string | null;
  warehouseName: string | null;
  quantity: string;
  unitCostAmountMinor: string | null;
  unitCostCurrency: string | null;
  referenceType: string;
  referenceId: string;
  reasonCode: string | null;
  occurredAt: string;
  createdBy: string | null;
}

/** Warehouse row. */
export interface WarehouseRow {
  id: string;
  name: string;
  code: string;
  isDefault: boolean;
  isActive: boolean;
}

/** A page of results with the total matching row count (pagination UI). */
export interface PageResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** Filter for the paginated stock-levels list (INV-5 stock page). */
export interface StockLevelListFilter {
  /** Matches product name or SKU (case-insensitive substring). */
  search?: string;
  /**
   * Restrict to one warehouse. RLS keeps the scope tenant-local; this is a
   * client-visible narrowing, never a tenant bypass.
   */
  warehouseId?: string;
  /**
   * Restrict to rows whose AVAILABLE (on-hand − reserved, INV-5) is strictly
   * below the reorder point — the INV-13 comparison (`available < reorder`),
   * identical to the stock-page badge and the low-stock widget/job.
   */
  lowStock?: boolean;
  /** 1-indexed page. Default 1. */
  page?: number;
  /** Rows per page. Default 12, max 100. */
  pageSize?: number;
  /**
   * Fetch every matching row, ignoring pagination — for internal batch reads
   * (jobs, product-detail composition) that must not silently truncate.
   * Never set from a controller route.
   */
  all?: boolean;
}

/** Filter for the paginated movements ledger (INV-1). */
export interface MovementListFilter {
  /** Matches product name or SKU (case-insensitive substring). */
  search?: string;
  /** One of the MOVEMENT_TYPE values (receipt, sale, adjustment, …). */
  type?: string;
  /**
   * Inclusive lower bound on `occurred_at` (ISO date `YYYY-MM-DD`). Only
   * movements on or after this day match.
   */
  fromDate?: string;
  /**
   * Inclusive upper bound on `occurred_at` (ISO date `YYYY-MM-DD`). Only
   * movements on or before this day match.
   */
  toDate?: string;
  /** 1-indexed page. Default 1. */
  page?: number;
  /** Rows per page. Default 12, max 100. */
  pageSize?: number;
  /**
   * Fetch every matching row, ignoring pagination — for internal batch reads
   * (jobs, product-detail composition) that must not silently truncate.
   * Never set from a controller route.
   */
  all?: boolean;
}

/** Filter for the paginated reservations list (INV-7/8). */
export interface ReservationListFilter {
  /** Restrict by state: held, committed, released, expired. */
  status?: ReservationData['state'];
  /** 1-indexed page. Default 1. */
  page?: number;
  /** Rows per page. Default 12, max 100. */
  pageSize?: number;
}

/** Filter for the paginated variants list (variant pickers — all sellable units). */
export interface VariantListFilter {
  /** Matches product name, SKU, or barcode (case-insensitive substring). */
  search?: string;
  /** 1-indexed page. Default 1. */
  page?: number;
  /** Rows per page. Default 12, max 100. */
  pageSize?: number;
}

/** Filter for the paginated products list (product + first active variant). */
export interface ProductListFilter {
  /** Matches product name, SKU, or barcode (case-insensitive substring). */
  search?: string;
  /**
   * Restrict by sellable state: `active` = has at least one non-deleted
   * variant; `archived` = every variant is archived (history preserved,
   * INV-11). Absent = both.
   */
  status?: 'active' | 'archived';
  /** 1-indexed page. Default 1. */
  page?: number;
  /** Rows per page. Default 12, max 100. */
  pageSize?: number;
}

/** Filter for the paginated stock-counts list (INV-14). */
export interface StockCountListFilter {
  /** Restrict by state: draft or applied. */
  status?: 'draft' | 'applied';
  /** 1-indexed page. Default 1. */
  page?: number;
  /** Rows per page. Default 12, max 100. */
  pageSize?: number;
}

/**
 * InventoryRepository — all inventory persistence, tenant-scoped by RLS.
 *
 * No method takes `organizationId` (DATA_MODEL §2 rule 2); every insert is
 * populated from TenantContext by the implementation. Methods accept an
 * ambient `tx` so use cases join the TransactionManager transaction.
 */
export interface InventoryRepository {
  // ─── Products & variants ────────────────────────────────────────────────
  /** Products with their first active variant — filtered + paged. */
  listProducts(filter: ProductListFilter, tx: TxOrDb): Promise<PageResult<ProductWithVariantRow>>;
  /** Creates the product row (with its i18n name) + the first variant atomically. */
  insertVariant(variant: ProductVariantData, nameI18n: Record<string, string>, tx: TxOrDb): Promise<ProductVariantData>;
  /** Insert a variant under an EXISTING product (add-variant flow, INV-10). */
  insertVariantForProduct(variant: ProductVariantData, tx: TxOrDb): Promise<ProductVariantData>;
  /** Product row by id (detail endpoint), or undefined when missing. */
  findProductById(id: string, tx: TxOrDb): Promise<ProductRow | undefined>;
  /** All variants of a product, newest first (archived included — INV-11). */
  listVariantsByProduct(productId: string, tx: TxOrDb): Promise<ProductVariantData[]>;
  /** Sellable variants org-wide (variant pickers) — filtered + paged. */
  listVariants(filter: VariantListFilter, tx: TxOrDb): Promise<PageResult<VariantListRow>>;
  /** Variant by id INCLUDING archived ones (unarchive needs the deleted row). */
  findVariantByIdIncludingDeleted(id: string, tx: TxOrDb): Promise<ProductVariantData | undefined>;
  /** Variants whose SKU matches (case-insensitive) — for INV-10 duplicate checks. */
  findVariantBySku(sku: string, tx: TxOrDb): Promise<ProductVariantData | undefined>;
  findVariantById(id: string, tx: TxOrDb): Promise<ProductVariantData | undefined>;
  /** True when the variant has any ledger rows (INV-11). */
  variantHasMovements(variantId: string, tx: TxOrDb): Promise<boolean>;
  archiveVariant(variantId: string, at: Date, by: string | null, tx: TxOrDb): Promise<void>;
  /** Restores an archived variant (is_active = true, soft delete lifted). */
  unarchiveVariant(variantId: string, at: Date, by: string | null, tx: TxOrDb): Promise<void>;
  /** Edits the product's translatable name/description (catalog metadata only). */
  updateProduct(
    productId: string,
    patch: { nameI18n?: Record<string, string>; descriptionI18n?: Record<string, string> },
    at: Date,
    by: string | null,
    tx: TxOrDb,
  ): Promise<void>;
  /** Edits the variant's sellable fields; archived variants are excluded (INV-11). */
  updateVariant(variant: ProductVariantData, tx: TxOrDb): Promise<void>;
  updateVariantCost(variantId: string, costAmountMinor: string, costCurrency: string, tx: TxOrDb): Promise<void>;
  /** True when the variant has any ledger rows (INV-16 idempotent retries). */
  findMovementByIdempotencyKey(idempotencyKey: string, tx: TxOrDb): Promise<StockMovementData | undefined>;

  // ─── Warehouses ─────────────────────────────────────────────────────────
  listWarehouses(tx: TxOrDb): Promise<WarehouseRow[]>;
  findWarehouseById(id: string, tx: TxOrDb): Promise<WarehouseRow | undefined>;
  /** Resolves the org's default warehouse; creates it on first use. */
  ensureDefaultWarehouse(tx: TxOrDb): Promise<WarehouseRow>;
  /** Creates a warehouse (first non-default warehouse flow). */
  insertWarehouse(
    data: { id: string; name: string; code: string; isDefault: boolean },
    tx: TxOrDb,
  ): Promise<WarehouseRow>;

  // ─── Stock ledger + projection ──────────────────────────────────────────
  insertMovement(movement: StockMovementData, tx: TxOrDb): Promise<StockMovementData>;
  /** Get the projection row, or undefined when the pair has no rows yet. */
  getStockLevel(variantId: string, warehouseId: string, tx: TxOrDb): Promise<StockLevelRow | undefined>;
  /** Get projection rows for many variants in one warehouse (INV-5 port). */
  getStockLevels(variantIds: string[], warehouseId: string, tx: TxOrDb): Promise<StockLevelRow[]>;
  /** Upsert the projection from a movement (INV-2) inside the same tx. */
  upsertStockLevel(
    variantId: string,
    warehouseId: string,
    quantityOnHand: string,
    quantityReserved: string,
    lastMovementId: string | null,
    tx: TxOrDb,
  ): Promise<void>;
  /** Stock list with availability (INV-5) for the stock page — filtered + paged. */
  listStockLevels(filter: StockLevelListFilter, tx: TxOrDb): Promise<PageResult<StockLevelRow>>;
  /** Append-only ledger, newest first, with product/warehouse names (INV-1) — filtered + paged. */
  listMovements(filter: MovementListFilter, tx: TxOrDb): Promise<PageResult<MovementRow>>;

  // ─── Reservations (INV-7, INV-8) ────────────────────────────────────────
  insertReservation(reservation: ReservationData, tx: TxOrDb): Promise<ReservationData>;
  /** All reservations, newest first, with product/warehouse names — filtered + paged. */
  listReservations(filter: ReservationListFilter, tx: TxOrDb): Promise<PageResult<ReservationRow>>;
  findReservationById(id: string, tx: TxOrDb): Promise<ReservationData | undefined>;
  updateReservationState(id: string, state: ReservationData['state'], at: Date, tx: TxOrDb): Promise<void>;
  /** Held reservations past their bound (INV-7 expiry job). */
  listExpiredHeldReservations(now: Date, tx: TxOrDb): Promise<ReservationData[]>;
  /** Record (or keep) an open low-stock alert (INV-6 oversold / INV-13). */
  upsertLowStockAlert(variantId: string, warehouseId: string, triggeredAt: Date, tx: TxOrDb): Promise<void>;
  /** Close the open alert for a pair (INV-13 recovery). */
  resolveLowStockAlert(variantId: string, warehouseId: string, resolvedAt: Date, tx: TxOrDb): Promise<void>;

  // ─── Stock counts (INV-14) ──────────────────────────────────────────────
  /** All counts with their lines — filtered + paged. */
  listStockCounts(filter: StockCountListFilter, tx: TxOrDb): Promise<PageResult<StockCountData>>;
  /** One count with its lines, or undefined when missing. */
  findStockCountById(id: string, tx: TxOrDb): Promise<StockCountData | undefined>;
  /** The count lines enriched with variant SKU/name (count detail view). */
  listStockCountLines(id: string, tx: TxOrDb): Promise<StockCountLineRow[]>;
  insertStockCount(count: StockCountData, tx: TxOrDb): Promise<StockCountData>;
  /** Applies the count: locks status + writes the correction lines. */
  applyStockCount(
    count: StockCountData,
    corrections: Array<{ variantId: string; quantity: string }>,
    tx: TxOrDb,
  ): Promise<void>;

  // ─── Reconciliation (INV-2) ─────────────────────────────────────────────
  /** Sum of movements per (variant, warehouse) — the source of truth. */
  sumMovementsByVariantWarehouse(tx: TxOrDb): Promise<Array<{ variantId: string; warehouseId: string; total: string }>>;
}

/** A stock-count line joined with variant names (count detail view). */
export interface StockCountLineRow {
  id: string;
  variantId: string;
  sku: string;
  nameI18n: Record<string, string>;
  expectedQuantity: string;
  countedQuantity: string;
  variance: string;
}
