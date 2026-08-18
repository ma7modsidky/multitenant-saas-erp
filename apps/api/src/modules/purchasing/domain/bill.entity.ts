import { PURCHASING_ERROR_CODE, PurchasingDomainError } from './errors.js';
import { computeLineTax, computeLineTotal, isNonNegativeMinor, isPositiveQuantity, sumMinor } from './money.js';

export const BILL_STATUS = {
  DRAFT: 'draft',
  APPROVED: 'approved',
  PARTIALLY_PAID: 'partially_paid',
  PAID: 'paid',
  VOID: 'void',
} as const;

export type BillStatus = (typeof BILL_STATUS)[keyof typeof BILL_STATUS];

export interface BillLineData {
  id: string;
  organizationId: string;
  billId: string;
  poLineId: string | null;
  grnLineId: string | null;
  variantId: string | null;
  /** Snapshot of the ordered item name (from the PO line) for the document. */
  itemNameSnapshot: string;
  quantity: string;
  unitCostMinor: string;
  unitCostCurrency: string;
  taxRateBpSnapshot: number;
  taxMinor: string;
  lineTotalMinor: string;
}

export interface BillLineInput {
  poLineId?: string | null;
  grnLineId?: string | null;
  variantId?: string | null;
  /** Item name snapshot for the document (optional — resolved from the PO line on read). */
  itemNameSnapshot?: string;
  quantity: string;
  unitCostMinor: string;
  unitCostCurrency?: string;
  taxRateBpSnapshot?: number;
}

export interface BillData {
  id: string;
  organizationId: string;
  number: string;
  supplierId: string;
  poId: string | null;
  grnId: string | null;
  status: BillStatus;
  billDate: string;
  dueDate: string | null;
  currency: string;
  subtotalMinor: string;
  discountMinor: string;
  taxMinor: string;
  totalMinor: string;
  supplierTaxIdSnapshot: string | null;
  idempotencyKey: string | null;
  paidMinor: string;
  createdAt: string;
  updatedAt: string;
  lines: BillLineData[];
}

/**
 * Bill + lines — the purchase-bill aggregate (PUR-6, PUR-7, PUR-9).
 *
 * PUR-6: a bill can be approved only when every goods line has a received GRN
 * (service bills are exempt). Approval records the AP vendor-ledger entry and
 * publishes `purchasing.bill.approved.v1` so the GL can post.
 * PUR-7: lifecycle Draft → Approved → Partially Paid → Paid → Void. Payments
 * allocate across bills; cumulative allocations per bill never exceed its
 * total.
 * PUR-9: cost variance vs the GRN cost posts a `cost_adjustment` movement —
 * historical cost is never rewritten.
 */
export class Bill {
  private constructor(private readonly data: BillData) {}

  static create(input: {
    id: string;
    organizationId: string;
    number: string;
    supplierId: string;
    poId?: string | null;
    grnId?: string | null;
    billDate?: string;
    dueDate?: string | null;
    currency: string;
    supplierTaxIdSnapshot?: string | null;
    idempotencyKey?: string | null;
    lines: BillLineInput[];
    now?: Date;
  }): Bill {
    if (input.lines.length === 0) {
      throw new PurchasingDomainError('PURCHASING_BILL_NO_LINES', 'A bill requires at least one line (PUR-6).');
    }
    const currency = input.currency.toUpperCase();
    const billId = input.id;
    const organizationId = input.organizationId;
    const timestamp = (input.now ?? new Date()).toISOString();
    const today = (input.now ?? new Date()).toISOString().slice(0, 10);

    const lines: BillLineData[] = input.lines.map((line, index) => {
      if (!isPositiveQuantity(line.quantity)) {
        throw new PurchasingDomainError(
          PURCHASING_ERROR_CODE.NOT_FOUND,
          `Bill line ${index + 1} has an invalid quantity (PUR-6).`,
          { index },
        );
      }
      if (!isNonNegativeMinor(line.unitCostMinor)) {
        throw new PurchasingDomainError(
          PURCHASING_ERROR_CODE.NOT_FOUND,
          `Bill line ${index + 1} has a negative unit cost (PUR-6).`,
          { index },
        );
      }
      const lineTotal = computeLineTotal(line.unitCostMinor, line.quantity, '0');
      const rateBp = Math.max(0, Math.trunc(line.taxRateBpSnapshot ?? 0));
      return {
        id: crypto.randomUUID(),
        organizationId,
        billId,
        poLineId: line.poLineId ?? null,
        grnLineId: line.grnLineId ?? null,
        variantId: line.variantId ?? null,
        itemNameSnapshot: line.itemNameSnapshot ?? '',
        quantity: line.quantity,
        unitCostMinor: line.unitCostMinor,
        unitCostCurrency: (line.unitCostCurrency ?? currency).toUpperCase(),
        taxRateBpSnapshot: rateBp,
        taxMinor: computeLineTax(lineTotal, rateBp),
        lineTotalMinor: lineTotal,
      };
    });

    const subtotal = sumMinor(lines.map((l) => l.lineTotalMinor));
    const tax = sumMinor(lines.map((l) => l.taxMinor));
    const total = (BigInt(subtotal) + BigInt(tax)).toString();

    return new Bill({
      id: billId,
      organizationId,
      number: input.number,
      supplierId: input.supplierId,
      poId: input.poId ?? null,
      grnId: input.grnId ?? null,
      status: BILL_STATUS.DRAFT,
      billDate: input.billDate ?? today,
      dueDate: input.dueDate ?? null,
      currency,
      subtotalMinor: subtotal,
      discountMinor: '0',
      taxMinor: tax,
      totalMinor: total,
      supplierTaxIdSnapshot: input.supplierTaxIdSnapshot ?? null,
      idempotencyKey: input.idempotencyKey ?? null,
      paidMinor: '0',
      createdAt: timestamp,
      updatedAt: timestamp,
      lines,
    });
  }

  static fromJSON(data: BillData): Bill {
    return new Bill(data);
  }

  toJSON(): BillData {
    return { ...this.data, lines: this.data.lines.map((l) => ({ ...l })) };
  }

  get id(): string {
    return this.data.id;
  }

  get number(): string {
    return this.data.number;
  }

  get status(): BillStatus {
    return this.data.status;
  }

  get supplierId(): string {
    return this.data.supplierId;
  }

  get totalMinor(): string {
    return this.data.totalMinor;
  }

  get currency(): string {
    return this.data.currency;
  }

  get idempotencyKey(): string | null {
    return this.data.idempotencyKey;
  }

  get lines(): BillLineData[] {
    return this.data.lines.map((l) => ({ ...l }));
  }

  /** PUR-7: the remaining unpaid balance. */
  get balanceDue(): string {
    return (BigInt(this.data.totalMinor) - BigInt(this.data.paidMinor)).toString();
  }

  /**
   * PUR-6: approve the bill (Draft → Approved). The caller validates the
   * three-way match (goods lines have received GRNs) and posts the AP
   * vendor-ledger entry atomically; the bill.approved event is published after
   * commit so the GL can post Dr Inventory/Expense, Cr AP.
   */
  approve(now: Date): void {
    if (this.data.status !== BILL_STATUS.DRAFT) {
      throw new PurchasingDomainError(
        PURCHASING_ERROR_CODE.BILL_ILLEGAL_TRANSITION,
        `Bill ${this.data.number} is ${this.data.status}; only a draft can be approved (PUR-6).`,
        { number: this.data.number, status: this.data.status },
      );
    }
    this.data.status = BILL_STATUS.APPROVED;
    this.data.updatedAt = now.toISOString();
  }

  /**
   * PUR-7: apply an allocation of `amount` to this bill. The total applied can
   * never exceed the bill total. Returns the new paid amount.
   */
  applyPayment(amountMinor: string, now: Date): string {
    if (this.data.status === BILL_STATUS.VOID || this.data.status === BILL_STATUS.DRAFT) {
      throw new PurchasingDomainError(
        PURCHASING_ERROR_CODE.BILL_ILLEGAL_TRANSITION,
        `Cannot allocate a payment to a ${this.data.status} bill (PUR-7).`,
        { number: this.data.number, status: this.data.status },
      );
    }
    if (!isNonNegativeMinor(amountMinor)) {
      throw new PurchasingDomainError(
        PURCHASING_ERROR_CODE.PAYMENT_OVER_ALLOCATED,
        'Allocation must be positive (PUR-7).',
      );
    }
    const newPaid = (BigInt(this.data.paidMinor) + BigInt(amountMinor)).toString();
    if (BigInt(newPaid) > BigInt(this.data.totalMinor)) {
      throw new PurchasingDomainError(
        PURCHASING_ERROR_CODE.PAYMENT_OVER_ALLOCATED,
        `Allocation would exceed the bill total (${this.data.totalMinor}) (PUR-7).`,
        { number: this.data.number, allocated: newPaid, total: this.data.totalMinor },
      );
    }
    this.data.paidMinor = newPaid;
    this.data.updatedAt = now.toISOString();
    if (BigInt(newPaid) === BigInt(this.data.totalMinor)) {
      this.data.status = BILL_STATUS.PAID;
    } else if (BigInt(newPaid) > 0n && this.data.status === BILL_STATUS.APPROVED) {
      this.data.status = BILL_STATUS.PARTIALLY_PAID;
    }
    return this.data.paidMinor;
  }

  /** PUR-7: void a bill (only from Draft, per the lifecycle). */
  void(now: Date): void {
    if (this.data.status !== BILL_STATUS.DRAFT) {
      throw new PurchasingDomainError(
        PURCHASING_ERROR_CODE.BILL_ILLEGAL_TRANSITION,
        `Only a draft bill can be voided directly (PUR-7); ${this.data.number} is ${this.data.status}.`,
        { number: this.data.number, status: this.data.status },
      );
    }
    this.data.status = BILL_STATUS.VOID;
    this.data.updatedAt = now.toISOString();
  }
}
