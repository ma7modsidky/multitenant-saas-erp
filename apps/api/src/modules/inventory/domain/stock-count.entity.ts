import { InventoryError, INVENTORY_ERROR_CODE } from './errors.js';

/** Stock count states (inv_stock_counts.status). */
export const STOCK_COUNT_STATUS = {
  DRAFT: 'draft',
  APPLIED: 'applied',
} as const;

export type StockCountStatus = (typeof STOCK_COUNT_STATUS)[keyof typeof STOCK_COUNT_STATUS];

/** One physical-count line (inv_stock_count_lines). */
export interface StockCountLineData {
  id: string;
  variantId: string;
  expectedQuantity: string;
  countedQuantity: string;
  /** variance = counted − expected (generated column in the DB). */
  variance: string;
}

/** Persisted shape of a stock count (inv_stock_counts + lines). */
export interface StockCountData {
  id: string;
  organizationId: string;
  warehouseId: string;
  status: StockCountStatus;
  countedAt: Date | null;
  countedBy: string | null;
  notes: string | null;
  lines: StockCountLineData[];
  createdAt: Date;
  updatedAt: Date;
}

/**
 * StockCount — a physical count of one warehouse.
 *
 * Rules enforced here:
 * - INV-14: a draft count may be edited; once `applied` it is immutable and
 *   generates `count_correction` movements for every variance.
 */
export class StockCount {
  private constructor(private readonly data: StockCountData) {}

  static create(data: StockCountData): StockCount {
    return new StockCount({ ...data });
  }

  static fromPersistence(data: StockCountData): StockCount {
    return new StockCount(data);
  }

  // ─── Getters ────────────────────────────────────────────────────────────────

  get id(): string {
    return this.data.id;
  }
  get organizationId(): string {
    return this.data.organizationId;
  }
  get warehouseId(): string {
    return this.data.warehouseId;
  }
  get status(): StockCountStatus {
    return this.data.status;
  }
  get countedAt(): Date | null {
    return this.data.countedAt;
  }
  get countedBy(): string | null {
    return this.data.countedBy;
  }
  get lines(): StockCountLineData[] {
    return this.data.lines.map((line) => ({ ...line }));
  }

  toJSON(): StockCountData {
    return { ...this.data, lines: this.data.lines.map((line) => ({ ...line })) };
  }

  // ─── Behaviour ──────────────────────────────────────────────────────────────

  /** INV-14: a draft may be edited (replace its lines). */
  updateLines(lines: StockCountLineData[], by: string, at = new Date()): void {
    this.assertDraft();
    this.data.lines = lines.map((line) => ({ ...line }));
    this.data.updatedAt = at;
  }

  /**
   * INV-14: applying locks the count (immutable) and records who/when.
   * `assertApplied()` guards every later mutation.
   */
  apply(by: string, at = new Date()): void {
    this.assertDraft();
    this.data.status = STOCK_COUNT_STATUS.APPLIED;
    this.data.countedBy = by;
    this.data.countedAt = at;
    this.data.updatedAt = at;
  }

  /**
   * INV-14: every line with a variance needs a `count_correction` movement.
   * Returns the signed quantities per variant (expected − counted is the
   * ledger's correction; zero-variance lines produce no movement).
   */
  corrections(): Array<{ variantId: string; quantity: string }> {
    return this.data.lines
      .filter((line) => line.variance !== '0')
      .map((line) => ({ variantId: line.variantId, quantity: line.variance }));
  }

  private assertDraft(): void {
    if (this.data.status !== STOCK_COUNT_STATUS.DRAFT) {
      throw new InventoryError(
        INVENTORY_ERROR_CODE.STOCK_COUNT_APPLIED_IMMUTABLE,
        'An applied stock count is immutable.',
        { stockCountId: this.data.id, status: this.data.status },
      );
    }
  }
}
