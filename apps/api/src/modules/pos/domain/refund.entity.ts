import { PosError, POS_ERROR_CODE } from './errors.js';
import { parseMinor, toMinorString } from './money.js';

/** One refund line as submitted by the client. */
export interface RefundLineInput {
  /** The ORIGINAL sale line being refunded (POS-21 tracks per-line quantity). */
  saleLineId: string;
  variantId: string;
  /** Quantity refunded, decimal string. */
  quantity: string;
  /** POS-22: restock is decided per line. */
  restock: boolean;
  /** The amount refunded for this line (minor units). */
  amountMinor: string;
  currency: string;
}

/** Persisted shape of a refund line (pos_refund_lines). */
export interface RefundLineData {
  id: string;
  refundId: string;
  saleLineId: string;
  variantId: string;
  quantity: string;
  restock: boolean;
  amountMinor: string;
  currency: string;
}

/** Persisted shape of a refund (pos_refunds) with its lines. */
export interface RefundData {
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
  lines: RefundLineData[];
}

export interface CreateRefundInput {
  id: string;
  organizationId: string;
  originalSaleId: string;
  shiftId: string;
  registerId: string;
  reasonCode: string;
  currency: string;
  lines: RefundLineInput[];
  refundedAt: Date;
  createdBy: string | null;
}

/**
 * Refund — a return against an original completed sale (pos_refunds + lines).
 *
 * Rules enforced here:
 * - POS-20: a refund references the original sale (validated by the use case
 *   — the sale must exist and be completed in the same org).
 * - POS-22: restock is decided per line (return vs write_off movement).
 * - POS-23: a reason code is mandatory.
 * - The refund amount is the sum of its line amounts; each line quantity is
 *   positive and each amount non-negative.
 */
export class Refund {
  private constructor(private readonly data: RefundData) {}

  static create(input: CreateRefundInput): Refund {
    // POS-23: a refund requires a reason code.
    if (!input.reasonCode.trim()) {
      throw new PosError(POS_ERROR_CODE.REFUND_REQUIRES_REASON, 'A refund requires a reason code (POS-23).');
    }

    let total = 0n;
    const lines: RefundLineData[] = input.lines.map((line) => {
      if (line.currency !== input.currency) {
        throw new PosError(POS_ERROR_CODE.CURRENCY_MISMATCH, 'Refund lines must share the sale currency (POS-11).', {
          refundCurrency: input.currency,
          lineCurrency: line.currency,
        });
      }
      const amount = parseMinor(line.amountMinor);
      total += amount;
      return {
        id: crypto.randomUUID(),
        refundId: input.id,
        saleLineId: line.saleLineId,
        variantId: line.variantId,
        quantity: line.quantity,
        restock: line.restock,
        amountMinor: line.amountMinor,
        currency: line.currency,
      };
    });

    return new Refund({
      id: input.id,
      organizationId: input.organizationId,
      originalSaleId: input.originalSaleId,
      shiftId: input.shiftId,
      registerId: input.registerId,
      reasonCode: input.reasonCode,
      amountMinor: toMinorString(total),
      currency: input.currency,
      refundedAt: input.refundedAt,
      createdAt: input.refundedAt,
      createdBy: input.createdBy,
      lines,
    });
  }

  static fromPersistence(data: RefundData): Refund {
    return new Refund(data);
  }

  get id(): string {
    return this.data.id;
  }
  get organizationId(): string {
    return this.data.organizationId;
  }
  get originalSaleId(): string {
    return this.data.originalSaleId;
  }
  get shiftId(): string {
    return this.data.shiftId;
  }
  get registerId(): string {
    return this.data.registerId;
  }
  get reasonCode(): string {
    return this.data.reasonCode;
  }
  get amountMinor(): string {
    return this.data.amountMinor;
  }
  get currency(): string {
    return this.data.currency;
  }
  get lines(): RefundLineData[] {
    return this.data.lines;
  }

  toJSON(): RefundData {
    return { ...this.data };
  }
}
