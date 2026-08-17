import { DomainError } from '../../../core/common/errors.js';

/**
 * Stable, machine-readable error codes for the inventory module.
 *
 * Every code maps to a BUSINESS_RULES.md §8 rule id and is surfaced by the API
 * as an error code (CODING_STANDARDS.md §7 — API returns codes, not sentences).
 */
export const INVENTORY_ERROR_CODE = {
  /** INV-3 — every movement has a non-zero signed quantity, a type, and a reference. */
  MOVEMENT_ZERO_QUANTITY: 'INVENTORY_MOVEMENT_ZERO_QUANTITY',
  /** INV-3 — movement requires reference_type + reference_id. */
  MOVEMENT_REFERENCE_REQUIRED: 'INVENTORY_MOVEMENT_REFERENCE_REQUIRED',
  /** INV-4 — manual adjustments require a reason code. */
  ADJUSTMENT_REQUIRES_REASON: 'INVENTORY_ADJUSTMENT_REQUIRES_REASON',
  /** PUR-11 — supplier returns require a reason code. */
  SUPPLIER_RETURN_REQUIRES_REASON: 'INVENTORY_SUPPLIER_RETURN_REQUIRES_REASON',
  /** PUR-9 — a cost adjustment on a pair with zero on-hand stock is rejected. */
  COST_ADJUSTMENT_EMPTY_STOCK: 'INVENTORY_COST_ADJUSTMENT_EMPTY_STOCK',
  /** INV-5 — sales/reservations validate against available, never on-hand. */
  INSUFFICIENT_STOCK: 'INVENTORY_INSUFFICIENT_STOCK',
  /** INV-8 — an illegal reservation state transition. */
  RESERVATION_ILLEGAL_TRANSITION: 'INVENTORY_RESERVATION_ILLEGAL_TRANSITION',
  /** INV-7 — a reservation already expired; it can only be marked expired. */
  RESERVATION_EXPIRED: 'INVENTORY_RESERVATION_EXPIRED',
  /** INV-11 — a variant with movement history cannot be hard-deleted, only archived. */
  VARIANT_HAS_MOVEMENT_HISTORY: 'INVENTORY_VARIANT_HAS_MOVEMENT_HISTORY',
  /** INV-11 — only an archived variant can be unarchived (restore of the soft delete). */
  VARIANT_NOT_ARCHIVED: 'INVENTORY_VARIANT_NOT_ARCHIVED',
  /** INV-14 — an applied stock count is immutable. */
  STOCK_COUNT_APPLIED_IMMUTABLE: 'INVENTORY_STOCK_COUNT_APPLIED_IMMUTABLE',
  /** INV-10 — SKU/barcode unique per org among non-deleted variants. */
  VARIANT_DUPLICATE_SKU: 'INVENTORY_VARIANT_DUPLICATE_SKU',
  /** Warehouse codes are unique per org among non-deleted warehouses. */
  WAREHOUSE_DUPLICATE_CODE: 'INVENTORY_WAREHOUSE_DUPLICATE_CODE',
  /** INV-6 — only documented oversold paths may drive stock negative. */
  NEGATIVE_STOCK_NOT_ALLOWED: 'INVENTORY_NEGATIVE_STOCK_NOT_ALLOWED',
} as const;

export type InventoryErrorCode = (typeof INVENTORY_ERROR_CODE)[keyof typeof INVENTORY_ERROR_CODE];

/**
 * InventoryError — an inventory business-rule violation (422).
 *
 * Extends the shared DomainError so the global exception filter maps it to the
 * standard error response (ERR-1).
 */
export class InventoryError extends DomainError {
  constructor(code: InventoryErrorCode, message: string, params?: Record<string, unknown>) {
    super(code, message, { ...params, code });
    this.name = 'InventoryError';
  }
}
