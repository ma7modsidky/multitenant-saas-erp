// Inventory event payload schemas
//
// @see PLAN.md §5.1 — Declare contracts first
// @see DATA_MODEL.md §8 — Inventory schema (`inv_`)
// @see BUSINESS_RULES.md §8 — Inventory rules
//
// Every payload carries `organizationId` (the payload is the event's source of
// truth for tenant context — handlers run without the publishing tenant
// context) and `occurredAt` (ISO 8601) per MODULE_GUIDE.md Step 1.
import { z } from 'zod';

import { decimalString } from './index.js';

/** Stable inventory event names. Consumed by the module descriptor (`publishes`). */
export const INVENTORY_EVENTS = {
  PRODUCT_CREATED_V1: 'inventory.product.created.v1',
  PRODUCT_ARCHIVED_V1: 'inventory.product.archived.v1',
  STOCK_LEVEL_CHANGED_V1: 'inventory.stock.level_changed.v1',
  STOCK_DEPLETED_V1: 'inventory.stock.depleted.v1',
  REORDER_POINT_REACHED_V1: 'inventory.reorder_point.reached.v1',
} as const;

/** Payload of `inventory.product.created.v1` — emitted when a product is created. */
export const inventoryProductCreatedV1Schema = z.object({
  organizationId: z.string().uuid(),
  productId: z.string().uuid(),
  nameI18n: z.record(z.string(), z.string()),
  // Every created product starts with at least one variant (INV-10: SKU
  // unique per org among non-deleted variants).
  variantId: z.string().uuid(),
  sku: z.string().min(1),
  isActive: z.boolean(),
  occurredAt: z.string().datetime(),
});
export type InventoryProductCreatedV1 = z.infer<typeof inventoryProductCreatedV1Schema>;

/** Payload of `inventory.product.archived.v1` — emitted when a product is archived. */
export const inventoryProductArchivedV1Schema = z.object({
  organizationId: z.string().uuid(),
  productId: z.string().uuid(),
  // The product may be archived while variants carry movement history — the
  // archive never hard-deletes (INV-11).
  variantIds: z.array(z.string().uuid()),
  archivedAt: z.string().datetime(),
  occurredAt: z.string().datetime(),
});
export type InventoryProductArchivedV1 = z.infer<typeof inventoryProductArchivedV1Schema>;

/** Payload of `inventory.stock.level_changed.v1` — emitted after any movement. */
export const inventoryStockLevelChangedV1Schema = z.object({
  organizationId: z.string().uuid(),
  variantId: z.string().uuid(),
  warehouseId: z.string().uuid(),
  movementId: z.string().uuid(),
  movementType: z.enum([
    'receipt',
    'sale',
    'return',
    'transfer_in',
    'transfer_out',
    'adjustment',
    'count_correction',
    'write_off',
  ]),
  // Signed quantity in UoM units (numeric(18,4) stored, decimal-string in the
  // payload — JSON has no fixed-point type).
  quantity: decimalString,
  /** New on-hand after this movement (decimal string). */
  quantityOnHand: decimalString,
  /** New reserved quantity after this movement (decimal string). */
  quantityReserved: decimalString,
  occurredAt: z.string().datetime(),
});
export type InventoryStockLevelChangedV1 = z.infer<typeof inventoryStockLevelChangedV1Schema>;

/**
 * Payload of `inventory.stock.depleted.v1` — emitted when available stock
 * crosses to zero (or below via a documented oversold path, INV-6).
 */
export const inventoryStockDepletedV1Schema = z.object({
  organizationId: z.string().uuid(),
  variantId: z.string().uuid(),
  warehouseId: z.string().uuid(),
  quantityOnHand: decimalString,
  quantityReserved: decimalString,
  /** Available = on-hand − reserved (INV-5); may be negative only on INV-6 paths. */
  quantityAvailable: decimalString,
  occurredAt: z.string().datetime(),
});
export type InventoryStockDepletedV1 = z.infer<typeof inventoryStockDepletedV1Schema>;

/**
 * Payload of `inventory.reorder_point.reached.v1` — emitted when available
 * crosses below the reorder point (INV-13). The alert must not re-fire until
 * stock recovers above the reorder point.
 */
export const inventoryReorderPointReachedV1Schema = z.object({
  organizationId: z.string().uuid(),
  variantId: z.string().uuid(),
  warehouseId: z.string().uuid(),
  quantityAvailable: decimalString,
  reorderPoint: decimalString,
  occurredAt: z.string().datetime(),
});
export type InventoryReorderPointReachedV1 = z.infer<typeof inventoryReorderPointReachedV1Schema>;
