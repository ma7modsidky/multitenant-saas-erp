import { InventoryError, INVENTORY_ERROR_CODE } from './errors.js';
import { isNegativeQuantity, isZeroQuantity } from './quantity.js';

/** Movement types (DATA_MODEL §8 — the ledger vocabulary). */
export const MOVEMENT_TYPE = {
  RECEIPT: 'receipt',
  SALE: 'sale',
  RETURN: 'return',
  TRANSFER_IN: 'transfer_in',
  TRANSFER_OUT: 'transfer_out',
  ADJUSTMENT: 'adjustment',
  COUNT_CORRECTION: 'count_correction',
  WRITE_OFF: 'write_off',
} as const;

export type MovementType = (typeof MOVEMENT_TYPE)[keyof typeof MOVEMENT_TYPE];

/** Persisted shape of a ledger row (inv_stock_movements). */
export interface StockMovementData {
  id: string;
  organizationId: string;
  variantId: string;
  warehouseId: string;
  type: MovementType;
  /** Signed quantity in UoM units (numeric(18,4) — decimal string). */
  quantity: string;
  unitCostAmountMinor: string | null;
  unitCostCurrency: string | null;
  referenceType: string;
  referenceId: string;
  reasonCode: string | null;
  idempotencyKey: string | null;
  occurredAt: Date;
  createdBy: string | null;
}

/**
 * StockMovement — one append-only ledger row. The single source of truth for
 * stock (INV-1).
 *
 * Rules enforced here:
 * - INV-3: non-zero signed quantity, a type, and a reference to what caused it.
 * - INV-4: manual adjustments require a reason code.
 */
export class StockMovement {
  private constructor(private readonly data: StockMovementData) {}

  static create(data: StockMovementData): StockMovement {
    assertMovement(data);
    return new StockMovement({ ...data });
  }

  /** Reconstruct from persistence (already valid — no invariant re-check). */
  static fromPersistence(data: StockMovementData): StockMovement {
    return new StockMovement(data);
  }

  get id(): string {
    return this.data.id;
  }
  get organizationId(): string {
    return this.data.organizationId;
  }
  get variantId(): string {
    return this.data.variantId;
  }
  get warehouseId(): string {
    return this.data.warehouseId;
  }
  get type(): MovementType {
    return this.data.type;
  }
  get quantity(): string {
    return this.data.quantity;
  }
  get referenceType(): string {
    return this.data.referenceType;
  }
  get referenceId(): string {
    return this.data.referenceId;
  }
  get reasonCode(): string | null {
    return this.data.reasonCode;
  }
  get idempotencyKey(): string | null {
    return this.data.idempotencyKey;
  }
  get occurredAt(): Date {
    return this.data.occurredAt;
  }

  /** A stock-in movement (positive quantity). */
  get isInbound(): boolean {
    return !isNegativeQuantity(this.data.quantity) && !isZeroQuantity(this.data.quantity);
  }

  toJSON(): StockMovementData {
    return { ...this.data };
  }
}

/**
 * INV-3 + INV-4: validates the movement invariants at creation.
 */
function assertMovement(data: StockMovementData): void {
  if (isZeroQuantity(data.quantity)) {
    throw new InventoryError(
      INVENTORY_ERROR_CODE.MOVEMENT_ZERO_QUANTITY,
      'A stock movement must have a non-zero quantity.',
    );
  }
  if (!data.referenceType.trim() || !data.referenceId) {
    throw new InventoryError(
      INVENTORY_ERROR_CODE.MOVEMENT_REFERENCE_REQUIRED,
      'A stock movement must reference what caused it (reference_type + reference_id).',
    );
  }
  // INV-4: adjustments are the manual-change path — they always need a reason.
  if (data.type === MOVEMENT_TYPE.ADJUSTMENT && !data.reasonCode?.trim()) {
    throw new InventoryError(
      INVENTORY_ERROR_CODE.ADJUSTMENT_REQUIRES_REASON,
      'A manual adjustment requires a reason code.',
    );
  }
}
