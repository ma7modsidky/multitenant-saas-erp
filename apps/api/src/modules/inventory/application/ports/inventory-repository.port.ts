import type { TxOrDb } from '../../../../core/database/repository.base.js';
import type { ProductVariantData, ReservationData, StockCountData, StockMovementData } from '../../domain/index.js';

/** DI token for the inventory repository. */
export const INVENTORY_REPOSITORY = Symbol('INVENTORY_REPOSITORY');

/** Row shape for a product + its first/active variant (list endpoint). */
export interface ProductWithVariantRow {
  id: string;
  nameI18n: Record<string, string>;
  isActive: boolean;
  variantId: string | null;
  sku: string | null;
  priceAmountMinor: string | null;
  priceCurrency: string | null;
  reorderPoint: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

/** Stock projection row (list endpoint). */
export interface StockLevelRow {
  variantId: string;
  sku: string;
  nameI18n: Record<string, string>;
  warehouseId: string;
  warehouseName: string;
  quantityOnHand: string;
  quantityReserved: string;
  reorderPoint: string;
  /** Last movement id that updated this projection (INV-2). */
  lastMovementId: string | null;
}

/** Warehouse row. */
export interface WarehouseRow {
  id: string;
  name: string;
  code: string;
  isDefault: boolean;
  isActive: boolean;
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
  listProducts(tx: TxOrDb): Promise<ProductWithVariantRow[]>;
  /** Creates the product row (with its i18n name) + the first variant atomically. */
  insertVariant(variant: ProductVariantData, nameI18n: Record<string, string>, tx: TxOrDb): Promise<ProductVariantData>;
  /** Variants whose SKU matches (case-insensitive) — for INV-10 duplicate checks. */
  findVariantBySku(sku: string, tx: TxOrDb): Promise<ProductVariantData | undefined>;
  findVariantById(id: string, tx: TxOrDb): Promise<ProductVariantData | undefined>;
  /** True when the variant has any ledger rows (INV-11). */
  variantHasMovements(variantId: string, tx: TxOrDb): Promise<boolean>;
  archiveVariant(variantId: string, at: Date, by: string | null, tx: TxOrDb): Promise<void>;
  updateVariantCost(variantId: string, costAmountMinor: string, costCurrency: string, tx: TxOrDb): Promise<void>;
  /** True when the variant has any ledger rows (INV-16 idempotent retries). */
  findMovementByIdempotencyKey(idempotencyKey: string, tx: TxOrDb): Promise<StockMovementData | undefined>;

  // ─── Warehouses ─────────────────────────────────────────────────────────
  listWarehouses(tx: TxOrDb): Promise<WarehouseRow[]>;
  findWarehouseById(id: string, tx: TxOrDb): Promise<WarehouseRow | undefined>;
  /** Resolves the org's default warehouse; creates it on first use. */
  ensureDefaultWarehouse(tx: TxOrDb): Promise<WarehouseRow>;

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
  /** Stock list with availability (INV-5) for the stock page. */
  listStockLevels(tx: TxOrDb): Promise<StockLevelRow[]>;

  // ─── Reservations (INV-7, INV-8) ────────────────────────────────────────
  insertReservation(reservation: ReservationData, tx: TxOrDb): Promise<ReservationData>;
  findReservationById(id: string, tx: TxOrDb): Promise<ReservationData | undefined>;
  updateReservationState(id: string, state: ReservationData['state'], at: Date, tx: TxOrDb): Promise<void>;
  /** Held reservations past their bound (INV-7 expiry job). */
  listExpiredHeldReservations(now: Date, tx: TxOrDb): Promise<ReservationData[]>;
  /** Record (or keep) an open low-stock alert (INV-6 oversold / INV-13). */
  upsertLowStockAlert(variantId: string, warehouseId: string, triggeredAt: Date, tx: TxOrDb): Promise<void>;
  /** Close the open alert for a pair (INV-13 recovery). */
  resolveLowStockAlert(variantId: string, warehouseId: string, resolvedAt: Date, tx: TxOrDb): Promise<void>;

  // ─── Stock counts (INV-14) ──────────────────────────────────────────────
  listStockCounts(tx: TxOrDb): Promise<StockCountData[]>;
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
