import { PosError, POS_ERROR_CODE } from './errors.js';
import { multiplyMinorByQuantity, parseMinor, taxInBp, toMinorString } from './money.js';

/** Sale states (pos_sales.status). */
export const SALE_STATUS = {
  COMPLETED: 'completed',
  REFUNDED: 'refunded',
  PARTIALLY_REFUNDED: 'partially_refunded',
  VOIDED: 'voided',
} as const;

export type SaleStatus = (typeof SALE_STATUS)[keyof typeof SALE_STATUS];

/** Payment methods (pos_payments.method). */
export const PAYMENT_METHOD = {
  CASH: 'cash',
  CARD: 'card',
  OTHER: 'other',
} as const;

export type PaymentMethod = (typeof PAYMENT_METHOD)[keyof typeof PAYMENT_METHOD];

/** One line as submitted by the client (checkout / offline sync). */
export interface SaleLineInput {
  variantId: string;
  sku: string;
  /** POS-12: name snapshot at sale time (i18n object). */
  nameI18n: Record<string, string>;
  /** UoM quantity, decimal string (numeric(18,4)). */
  quantity: string;
  unitPriceAmountMinor: string;
  lineDiscountAmountMinor: string;
  /** Tax rate in basis points (POS-17). */
  taxRateBp: number;
  currency: string;
}

/** One payment as submitted by the client. */
export interface PaymentInput {
  method: PaymentMethod;
  amountMinor: string;
  currency: string;
  /** Cash only — what the customer handed over (POS-10: change is tendered − amount). */
  tenderedAmountMinor?: string;
  changeAmountMinor?: string;
  /** Card only — capture reference. */
  reference?: string | null;
}

/** Persisted shape of a sale line (pos_sale_lines). */
export interface SaleLineData {
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

/** Persisted shape of a payment (pos_payments). */
export interface PaymentData {
  id: string;
  saleId: string;
  method: PaymentMethod;
  amountMinor: string;
  currency: string;
  tenderedAmountMinor: string | null;
  changeAmountMinor: string;
  reference: string | null;
  capturedAt: Date;
  createdBy: string | null;
}

/** Persisted shape of a sale with its lines + payments (pos_sales + children). */
export interface SaleData {
  id: string;
  organizationId: string;
  shiftId: string;
  registerId: string;
  receiptNumber: string;
  customerContactId: string | null;
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
  lines: SaleLineData[];
  payments: PaymentData[];
}

export interface CreateSaleInput {
  id: string;
  organizationId: string;
  shiftId: string;
  registerId: string;
  receiptNumber: string;
  customerContactId?: string | null;
  /** The register's currency = the org base currency (POS-11). */
  currency: string;
  /** POS-19: locale the sale was completed in. */
  locale: string;
  lines: SaleLineInput[];
  payments: PaymentInput[];
  soldAt: Date;
  createdAt: Date;
  createdBy: string | null;
  idempotencyKey?: string | null;
  clientDeviceId?: string | null;
  /** Set for online sales; NULL for offline sales awaiting sync (POS-27). */
  syncedAt?: Date | null;
  exchangeRate?: string | null;
  baseTotalAmountMinor?: string | null;
}

/**
 * Sale — the completed-sale aggregate (pos_sales + pos_sale_lines + pos_payments).
 *
 * Rules enforced here:
 * - POS-11: every line and payment shares ONE currency (the register's).
 * - POS-12: lines carry snapshots of SKU / name / price / tax / discount.
 * - POS-16: line discount ≤ line subtotal; no negative totals.
 * - POS-17: tax per line at the line's rate in basis points; the sale tax is
 *   the sum of line taxes.
 * - POS-10: the sale completes only when Σ payments = total. Overpayment is
 *   cash tendered with change due, never an inflated payment amount.
 * - POS-13/14: a completed sale is immutable; void only in the same open shift
 *   with no captured payment.
 */
export class Sale {
  private constructor(private readonly data: SaleData) {}

  static create(input: CreateSaleInput): Sale {
    // POS-11: single currency across the whole sale.
    for (const line of input.lines) {
      if (line.currency !== input.currency) {
        throw new PosError(
          POS_ERROR_CODE.CURRENCY_MISMATCH,
          'All sale lines must share the register currency (POS-11).',
          {
            saleCurrency: input.currency,
            lineCurrency: line.currency,
          },
        );
      }
    }
    for (const payment of input.payments) {
      if (payment.currency !== input.currency) {
        throw new PosError(
          POS_ERROR_CODE.CURRENCY_MISMATCH,
          'All payments must share the register currency (POS-11).',
          { saleCurrency: input.currency, paymentCurrency: payment.currency },
        );
      }
    }

    // Lines: snapshots + per-line tax (POS-12, POS-17), discount cap (POS-16).
    let subtotal = 0n;
    let totalDiscount = 0n;
    let totalTax = 0n;
    const lines: SaleLineData[] = input.lines.map((line) => {
      const unitPrice = parseMinor(line.unitPriceAmountMinor);
      const lineSubtotal = multiplyMinorByQuantity(unitPrice, line.quantity);
      const discount = parseMinor(line.lineDiscountAmountMinor);
      // POS-16: line discount ≤ line subtotal.
      if (discount > lineSubtotal) {
        throw new PosError(
          POS_ERROR_CODE.DISCOUNT_EXCEEDS_SUBTOTAL,
          'A line discount cannot exceed its subtotal (POS-16).',
          {
            lineSubtotal: lineSubtotal.toString(),
            discount: discount.toString(),
          },
        );
      }
      const taxable = lineSubtotal - discount;
      const tax = taxInBp(taxable, line.taxRateBp);
      const lineTotal = taxable + tax;

      subtotal += taxable;
      totalDiscount += discount;
      totalTax += tax;

      return {
        id: crypto.randomUUID(),
        saleId: input.id,
        variantId: line.variantId,
        skuSnapshot: line.sku,
        nameSnapshot: line.nameI18n,
        quantity: line.quantity,
        unitPriceAmountMinor: line.unitPriceAmountMinor,
        lineDiscountAmountMinor: line.lineDiscountAmountMinor,
        taxRateBp: line.taxRateBp,
        taxAmountMinor: toMinorString(tax),
        lineTotalAmountMinor: toMinorString(lineTotal),
        currency: line.currency,
      };
    });

    const total = subtotal + totalTax;

    // Payments (POS-10): Σ amounts must equal the total exactly.
    let paid = 0n;
    const payments: PaymentData[] = input.payments.map((payment) => {
      const amount = parseMinor(payment.amountMinor);
      paid += amount;

      let tendered: string | null = payment.tenderedAmountMinor ?? null;
      let change: string;
      if (payment.method === PAYMENT_METHOD.CASH && tendered !== null) {
        const changeMinor = parseMinor(tendered) - amount;
        // POS-10: change is tendered − amount; never a negative (short) tender.
        if (changeMinor < 0n) {
          throw new PosError(
            POS_ERROR_CODE.PAYMENTS_DO_NOT_EQUAL_TOTAL,
            'Cash tendered must cover the payment amount (POS-10).',
            { tendered: tendered.toString(), amount: amount.toString() },
          );
        }
        change = changeMinor.toString();
      } else {
        change = payment.changeAmountMinor ?? '0';
        tendered = payment.tenderedAmountMinor ?? null;
      }

      return {
        id: crypto.randomUUID(),
        saleId: input.id,
        method: payment.method,
        amountMinor: payment.amountMinor,
        currency: payment.currency,
        tenderedAmountMinor: tendered,
        changeAmountMinor: change,
        reference: payment.reference ?? null,
        capturedAt: input.createdAt,
        createdBy: input.createdBy,
      };
    });

    if (paid !== total) {
      throw new PosError(POS_ERROR_CODE.PAYMENTS_DO_NOT_EQUAL_TOTAL, 'Payments must equal the sale total (POS-10).', {
        total: total.toString(),
        paid: paid.toString(),
      });
    }

    return new Sale({
      id: input.id,
      organizationId: input.organizationId,
      shiftId: input.shiftId,
      registerId: input.registerId,
      receiptNumber: input.receiptNumber,
      customerContactId: input.customerContactId ?? null,
      status: SALE_STATUS.COMPLETED,
      subtotalAmountMinor: toMinorString(subtotal),
      discountAmountMinor: toMinorString(totalDiscount),
      taxAmountMinor: toMinorString(totalTax),
      totalAmountMinor: toMinorString(total),
      currency: input.currency,
      exchangeRate: input.exchangeRate ?? null,
      baseTotalAmountMinor: input.baseTotalAmountMinor ?? null,
      locale: input.locale,
      idempotencyKey: input.idempotencyKey ?? null,
      soldAt: input.soldAt,
      syncedAt: input.syncedAt ?? null,
      clientDeviceId: input.clientDeviceId ?? null,
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
      createdBy: input.createdBy,
      updatedBy: input.createdBy,
      lines,
      payments,
    });
  }

  static fromPersistence(data: SaleData): Sale {
    return new Sale(data);
  }

  // ─── Getters ────────────────────────────────────────────────────────────────

  get id(): string {
    return this.data.id;
  }
  get organizationId(): string {
    return this.data.organizationId;
  }
  get shiftId(): string {
    return this.data.shiftId;
  }
  get registerId(): string {
    return this.data.registerId;
  }
  get receiptNumber(): string {
    return this.data.receiptNumber;
  }
  get status(): SaleStatus {
    return this.data.status;
  }
  get currency(): string {
    return this.data.currency;
  }
  get totalAmountMinor(): string {
    return this.data.totalAmountMinor;
  }
  get subtotalAmountMinor(): string {
    return this.data.subtotalAmountMinor;
  }
  get taxAmountMinor(): string {
    return this.data.taxAmountMinor;
  }
  get discountAmountMinor(): string {
    return this.data.discountAmountMinor;
  }
  get lines(): SaleLineData[] {
    return this.data.lines;
  }
  get payments(): PaymentData[] {
    return this.data.payments;
  }
  get customerContactId(): string | null {
    return this.data.customerContactId;
  }
  get locale(): string {
    return this.data.locale;
  }
  get soldAt(): Date {
    return this.data.soldAt;
  }
  get idempotencyKey(): string | null {
    return this.data.idempotencyKey;
  }

  /**
   * POS-14 — a sale may be voided only within the SAME open shift and only if
   * no payment has been captured. Afterwards, only a refund is possible.
   */
  assertCanVoid(openShiftId: string): void {
    if (this.data.status !== SALE_STATUS.COMPLETED) {
      throw new PosError(POS_ERROR_CODE.SALE_IMMUTABLE, 'Only a completed sale can be voided (POS-13).', {
        saleId: this.data.id,
        status: this.data.status,
      });
    }
    if (this.data.shiftId !== openShiftId) {
      throw new PosError(
        POS_ERROR_CODE.SALE_NOT_VOIDABLE,
        'A sale can only be voided within the same open shift (POS-14).',
        { saleId: this.data.id },
      );
    }
    if (this.data.payments.length > 0) {
      throw new PosError(
        POS_ERROR_CODE.SALE_NOT_VOIDABLE,
        'A sale with a captured payment can only be corrected by a refund (POS-14).',
        { saleId: this.data.id },
      );
    }
  }

  /** Marks the sale voided (POS-14). Caller must run assertCanVoid first. */
  markVoided(now: Date): void {
    this.data.status = SALE_STATUS.VOIDED;
    this.data.updatedAt = now;
  }

  /** Marks the sale refunded / partially refunded (POS-21 bookkeeping). */
  markRefunded({ fully, now }: { fully: boolean; now: Date }): void {
    this.data.status = fully ? SALE_STATUS.REFUNDED : SALE_STATUS.PARTIALLY_REFUNDED;
    this.data.updatedAt = now;
  }

  toJSON(): SaleData {
    return { ...this.data };
  }
}
