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

/** Filter for the paginated sales list (reports / history). */
export interface SaleListFilter {
  status?: string;
  shiftId?: string;
  registerId?: string;
  page?: number;
  pageSize?: number;
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
  listShifts(tx?: TxOrDb): Promise<ShiftRow[]>;
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
  listSales(filter: SaleListFilter, tx?: TxOrDb): Promise<PageResult<SaleRow>>;
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
