import type { TxOrDb } from '../../../../core/database/repository.base.js';
import type { PaymentMethod, RefundData, SaleData, SaleStatus, ShiftData, ShiftStatus } from '../../domain/index.js';

/** DI token for the POS repository. */
export const POS_REPOSITORY = Symbol('POS_REPOSITORY');

/** Register row (pos_registers) with the register's open shift id, if any (POS-2). */
export interface RegisterRow {
  id: string;
  organizationId: string;
  name: string;
  code: string;
  warehouseId: string;
  receiptPrefix: string;
  nextReceiptNumber: number;
  isActive: boolean;
  openShiftId: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

/** Shift row (pos_shifts). */
export interface ShiftRow {
  id: string;
  organizationId: string;
  registerId: string;
  openedBy: string;
  openedAt: Date;
  openingFloatAmountMinor: string;
  closedBy: string | null;
  closedAt: Date | null;
  countedCashAmountMinor: string | null;
  expectedCashAmountMinor: string | null;
  varianceAmountMinor: string | null;
  currency: string;
  status: ShiftStatus;
  forcedClose: boolean;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
  updatedBy: string | null;
}

/** Sale line row (pos_sale_lines). */
export interface SaleLineRow {
  id: string;
  saleId: string;
  variantId: string;
  skuSnapshot: string;
  nameSnapshot: Record<string, string>;
  quantity: string;
  unitPriceAmountMinor: string;
  lineDiscountAmountMinor: string;
  taxRateBp: number;
  taxAmountMinor: string;
  lineTotalAmountMinor: string;
  currency: string;
}

/** Payment row (pos_payments). */
export interface PaymentRow {
  id: string;
  saleId: string;
  /** POS-10: the payment vocabulary (cash | card | other). */
  method: PaymentMethod;
  amountMinor: string;
  currency: string;
  tenderedAmountMinor: string | null;
  changeAmountMinor: string;
  reference: string | null;
  capturedAt: Date;
  createdBy: string | null;
}

/** Sale row (pos_sales) with its lines + payments. */
export interface SaleRow {
  id: string;
  organizationId: string;
  shiftId: string;
  registerId: string;
  receiptNumber: string;
  customerContactId: string | null;
  /** POS-13: the immutable status vocabulary. */
  status: SaleStatus;
  subtotalAmountMinor: string;
  discountAmountMinor: string;
  taxAmountMinor: string;
  totalAmountMinor: string;
  currency: string;
  exchangeRate: string | null;
  baseTotalAmountMinor: string | null;
  locale: string;
  idempotencyKey: string | null;
  soldAt: Date;
  syncedAt: Date | null;
  clientDeviceId: string | null;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
  updatedBy: string | null;
  lines: SaleLineRow[];
  payments: PaymentRow[];
}

/** Refund line row (pos_refund_lines). */
export interface RefundLineRow {
  id: string;
  refundId: string;
  saleLineId: string;
  variantId: string;
  quantity: string;
  restock: boolean;
  amountMinor: string;
  currency: string;
}

/** Refund row (pos_refunds) with its lines. */
export interface RefundRow {
  id: string;
  organizationId: string;
  originalSaleId: string;
  shiftId: string;
  registerId: string;
  reasonCode: string;
  amountMinor: string;
  currency: string;
  refundedAt: Date;
  createdAt: Date;
  createdBy: string | null;
  lines: RefundLineRow[];
}

/** Sync log row (pos_sync_log). */
export interface SyncLogRow {
  id: string;
  organizationId: string;
  clientDeviceId: string;
  idempotencyKey: string;
  payload: Record<string, unknown>;
  receivedAt: Date;
  result: 'accepted' | 'duplicate' | 'rejected';
  errorCode: string | null;
}

/** A page of results (pagination UI pattern shared with the inventory module). */
export interface PageResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Sales list page — carries the exact Σ of the MATCHING set (ignoring
 * pagination) so the reports page can show filtered totals without summing
 * the current page (mirrors the CRM deals `DealListPage.totalValueBaseMinor`).
 */
export interface SalesListPage extends PageResult<SaleRow> {
  /** Σ sale totals of every sale matching the filter (minor units). */
  totalAmountMinor: string;
  /**
   * Σ refund amounts issued in the same date window against sales that match
   * the filter (minor units). A fully-refunded sale's status ('refunded')
   * drops it out of BOTH this Σ and the revenue Σ, so net revenue never
   * double-counts a sale refunded within the same period (net = 0).
   *
   * Known limitation (deliberate): a sale fully refunded in a LATER period
   * than it was sold is not netted retroactively — the org has no sale-status
   * history to attribute its refund to the sale period, so the refund only
   * counts in the period it was issued while the sale still counts for
   * revenue. Net revenue = totalAmountMinor − refundsAmountMinor.
   */
  refundsAmountMinor: string;
}

/** Filter for the paginated sales list (reports / history). */
export interface SaleListFilter {
  /**
   * One or more statuses to include (POS-13). Omitted = every status. The
   * controller turns the comma-separated `status` query into this array, so
   * revenue-style sums can exclude voided/refunded sales server-side.
   */
  statuses?: string[];
  shiftId?: string;
  registerId?: string;
  /** Inclusive lower bound on sold_at (ISO date YYYY-MM-DD). */
  fromDate?: string;
  /** Inclusive upper bound on sold_at (ISO date YYYY-MM-DD). */
  toDate?: string;
  page?: number;
  pageSize?: number;
}

/** Filter for the shifts list (shifts page) — range on opened_at. */
export interface ShiftListFilter {
  /** Inclusive lower bound on opened_at (ISO date YYYY-MM-DD). */
  fromDate?: string;
  /** Inclusive upper bound on opened_at (ISO date YYYY-MM-DD). */
  toDate?: string;
}

/**
 * A shift row plus its sales/refund aggregates — matches the shift-report
 * totals semantics (POS-8: Σ sale totals, Σ refund amounts).
 */
export interface ShiftSummaryRow extends ShiftRow {
  /** Number of sales in the shift. */
  salesCount: number;
  /** Σ sale totals in the shift (minor units). */
  salesAmountMinor: string;
  /** Σ refund amounts in the shift (minor units). */
  refundsAmountMinor: string;
}

/** The POS read/write repository. RLS scopes every query to the org. */
export interface PosRepository {
  // ─── Registers (POS-1) ─────────────────────────────────────────────────
  listRegisters(tx?: TxOrDb): Promise<RegisterRow[]>;
  findRegisterById(id: string, tx?: TxOrDb): Promise<RegisterRow | undefined>;
  insertRegister(
    data: { id: string; name: string; code: string; warehouseId: string },
    tx?: TxOrDb,
  ): Promise<RegisterRow>;

  // ─── Shifts (POS-2, POS-4, POS-5, POS-7) ───────────────────────────────
  findOpenShiftByRegister(registerId: string, tx?: TxOrDb): Promise<ShiftRow | undefined>;
  findShiftById(id: string, tx?: TxOrDb): Promise<ShiftRow | undefined>;
  listShifts(filter?: ShiftListFilter, tx?: TxOrDb): Promise<ShiftSummaryRow[]>;
  insertShift(shift: ShiftData, tx?: TxOrDb): Promise<ShiftRow>;
  updateShiftClosed(shift: ShiftData, tx?: TxOrDb): Promise<void>;
  /** POS-7: true when any sale in the shift has `synced_at IS NULL`. */
  hasUnsyncedSalesInShift(shiftId: string, tx?: TxOrDb): Promise<boolean>;

  // ─── Sales (POS-9, POS-10, POS-26) ─────────────────────────────────────
  /**
   * POS-9: atomically allocate the next receipt sequence number
   * (`UPDATE ... RETURNING next_receipt_number + 1`). Never consumed by a
   * failed sale — the number is only bumped when the sale row is about to be
   * inserted.
   */
  allocateReceiptNumber(registerId: string, tx?: TxOrDb): Promise<number>;
  findSaleById(id: string, tx?: TxOrDb): Promise<SaleRow | undefined>;
  findSaleByIdempotencyKey(idempotencyKey: string, tx?: TxOrDb): Promise<SaleRow | undefined>;
  listSales(filter: SaleListFilter, tx?: TxOrDb): Promise<SalesListPage>;
  listSalesByShift(shiftId: string, tx?: TxOrDb): Promise<SaleRow[]>;
  insertSale(sale: SaleData, tx?: TxOrDb): Promise<void>;
  updateSaleStatus(id: string, status: string, tx?: TxOrDb): Promise<void>;
  /** POS-5: Σ cash payments in the shift (minor units). */
  sumCashSalesByShift(shiftId: string, tx?: TxOrDb): Promise<string>;

  // ─── Payments (append-only) ────────────────────────────────────────────
  listPaymentsBySale(saleId: string, tx?: TxOrDb): Promise<PaymentRow[]>;

  // ─── Refunds (POS-20, POS-21, POS-22, POS-23) ──────────────────────────
  findSaleLineById(id: string, tx?: TxOrDb): Promise<SaleLineRow | undefined>;
  insertRefund(refund: RefundData, tx?: TxOrDb): Promise<void>;
  findRefundById(id: string, tx?: TxOrDb): Promise<RefundRow | undefined>;
  findRefundLinesByRefund(refundId: string, tx?: TxOrDb): Promise<RefundLineRow[]>;
  listRefundsBySale(saleId: string, tx?: TxOrDb): Promise<RefundRow[]>;
  /** All refunds issued during a shift (the shift report, POS-8). */
  listRefundsByShift(shiftId: string, tx?: TxOrDb): Promise<RefundRow[]>;
  /** POS-5: Σ refund amounts in the shift (minor units). */
  sumRefundsByShift(shiftId: string, tx?: TxOrDb): Promise<string>;
  /** POS-21: Σ refunded quantity for one original sale line. */
  cumulativeRefundedQuantityByLine(saleLineId: string, tx?: TxOrDb): Promise<string>;
  /** POS-21: Σ refunded amount for one sale. */
  cumulativeRefundedAmountBySale(saleId: string, tx?: TxOrDb): Promise<string>;

  // ─── Sync log (POS-26, POS-29) ─────────────────────────────────────────
  findSyncLogByIdempotencyKey(idempotencyKey: string, tx?: TxOrDb): Promise<SyncLogRow | undefined>;
  insertSyncLog(entry: Omit<SyncLogRow, 'id' | 'receivedAt'>, tx?: TxOrDb): Promise<void>;
}
