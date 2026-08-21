import { PURCHASING_ERROR_CODE, PurchasingDomainError } from './errors.js';
import { computeLineTax, isPositiveQuantity, sumMinor } from './money.js';

export const RETURN_STATUS = {
  DRAFT: 'draft',
  APPROVED: 'approved',
  VOID: 'void',
} as const;

export type SupplierReturnStatus = (typeof RETURN_STATUS)[keyof typeof RETURN_STATUS];

export interface SupplierReturnLineData {
  id: string;
  organizationId: string;
  returnId: string;
  variantId: string | null;
  quantity: string;
  unitCostMinor: string;
  unitCostCurrency: string;
  /** ACC-11: tax-rate snapshot inherited from the source bill line. */
  taxRateBpSnapshot: number;
  /** ACC-11: per-line tax, minor units. */
  taxAmountMinor: string;
  /** ACC-11: line net + tax, minor units. */
  lineTotalMinor: string;
}

export interface SupplierReturnLineInput {
  variantId?: string | null;
  quantity: string;
  unitCostMinor: string;
  unitCostCurrency?: string;
  taxRateBpSnapshot?: number;
}

export interface SupplierReturnData {
  id: string;
  organizationId: string;
  number: string;
  supplierId: string;
  billId: string | null;
  grnLineId: string | null;
  reasonCode: string;
  status: SupplierReturnStatus;
  /** Net returned value = Σ quantity × unit cost (PUR-11). */
  amountMinor: string;
  /** ACC-11: Σ line taxes. */
  taxMinor: string;
  /** ACC-11: gross AP reduction = amountMinor + taxMinor. */
  totalMinor: string;
  /** The supplier's tax id from the source bill (ACC-11). */
  supplierTaxIdSnapshot: string | null;
  currency: string;
  returnedAt: string | null;
  createdAt: string;
  updatedAt: string;
  lines: SupplierReturnLineData[];
}

/**
 * SupplierReturn / debit note (PUR-11).
 *
 * PUR-11: a supplier return requires a reason code and a reference (bill or
 * GRN line). Approval reduces AP (debit note) AND removes stock through the
 * inventory movement port, in one transaction. The returned value is the sum
 * of line quantities × unit costs (positive amount; the ledger entry is signed
 * negative).
 */
export class SupplierReturn {
  private constructor(private readonly data: SupplierReturnData) {}

  static create(input: {
    id: string;
    organizationId: string;
    number: string;
    supplierId: string;
    billId?: string | null;
    grnLineId?: string | null;
    reasonCode: string;
    currency: string;
    /** ACC-11: the supplier's tax id inherited from the source bill. */
    supplierTaxIdSnapshot?: string | null;
    lines: SupplierReturnLineInput[];
    now?: Date;
  }): SupplierReturn {
    // PUR-11: a reason code is mandatory.
    if (!input.reasonCode || input.reasonCode.trim() === '') {
      throw new PurchasingDomainError(
        PURCHASING_ERROR_CODE.RETURN_REASON_REQUIRED,
        'A supplier return requires a reason code (PUR-11).',
      );
    }
    // PUR-11: a bill or GRN-line reference is mandatory.
    if (!input.billId && !input.grnLineId) {
      throw new PurchasingDomainError(
        PURCHASING_ERROR_CODE.RETURN_REFERENCE_REQUIRED,
        'A supplier return requires a bill or GRN-line reference (PUR-11).',
      );
    }
    if (input.lines.length === 0) {
      throw new PurchasingDomainError(
        'PURCHASING_RETURN_NO_LINES',
        'A supplier return requires at least one line (PUR-11).',
      );
    }
    const returnId = input.id;
    const organizationId = input.organizationId;
    const timestamp = (input.now ?? new Date()).toISOString();

    const lines: SupplierReturnLineData[] = input.lines.map((line, index) => {
      if (!isPositiveQuantity(line.quantity)) {
        throw new PurchasingDomainError(
          PURCHASING_ERROR_CODE.RETURN_EXCEEDS_BILL,
          `Return line ${index + 1} has an invalid quantity (PUR-11).`,
          { index },
        );
      }
      const unitCost = line.unitCostMinor;
      const currency = (line.unitCostCurrency ?? input.currency.toUpperCase()).toUpperCase();
      // PUR-11: line net = quantity × unit cost (exact integer math).
      const lineNet = scaledMultiply(unitCost, line.quantity);
      // ACC-11: line tax from the inherited rate (exclusive), rounded once.
      const rateBp = line.taxRateBpSnapshot ?? 0;
      const lineTax = rateBp === 0 ? '0' : computeLineTax(lineNet, rateBp);
      return {
        id: crypto.randomUUID(),
        organizationId,
        returnId,
        variantId: line.variantId ?? null,
        quantity: line.quantity,
        unitCostMinor: unitCost,
        unitCostCurrency: currency,
        taxRateBpSnapshot: rateBp,
        taxAmountMinor: lineTax,
        lineTotalMinor: (BigInt(lineNet) + BigInt(lineTax)).toString(),
      };
    });

    // Return net = Σ line nets; tax = Σ line taxes; total = net + tax.
    const amount = sumMinor(
      lines.map((line) => (BigInt(line.lineTotalMinor) - BigInt(line.taxAmountMinor)).toString()),
    );
    const tax = sumMinor(lines.map((l) => l.taxAmountMinor));

    return new SupplierReturn({
      id: returnId,
      organizationId,
      number: input.number,
      supplierId: input.supplierId,
      billId: input.billId ?? null,
      grnLineId: input.grnLineId ?? null,
      reasonCode: input.reasonCode.trim(),
      status: RETURN_STATUS.DRAFT,
      amountMinor: amount,
      taxMinor: tax,
      totalMinor: (BigInt(amount) + BigInt(tax)).toString(),
      supplierTaxIdSnapshot: input.supplierTaxIdSnapshot ?? null,
      currency: input.currency.toUpperCase(),
      returnedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      lines,
    });
  }

  static fromJSON(data: SupplierReturnData): SupplierReturn {
    return new SupplierReturn(data);
  }

  toJSON(): SupplierReturnData {
    return { ...this.data, lines: this.data.lines.map((l) => ({ ...l })) };
  }

  get id(): string {
    return this.data.id;
  }

  get number(): string {
    return this.data.number;
  }

  get status(): SupplierReturnStatus {
    return this.data.status;
  }

  get supplierId(): string {
    return this.data.supplierId;
  }

  get billId(): string | null {
    return this.data.billId;
  }

  get reasonCode(): string {
    return this.data.reasonCode;
  }

  /** The positive returned value (the ledger entry is signed negative). */
  get amountMinor(): string {
    return this.data.amountMinor;
  }

  /** ACC-11: the return's tax total (Σ line taxes). */
  get taxMinor(): string {
    return this.data.taxMinor;
  }

  /** ACC-11: the gross AP reduction (net + tax). */
  get totalMinor(): string {
    return this.data.totalMinor;
  }

  get currency(): string {
    return this.data.currency;
  }

  /** ACC-11: the supplier's tax id snapshot from the source bill. */
  get supplierTaxIdSnapshot(): string | null {
    return this.data.supplierTaxIdSnapshot;
  }

  get returnedAt(): string | null {
    return this.data.returnedAt;
  }

  get lines(): SupplierReturnLineData[] {
    return this.data.lines.map((l) => ({ ...l }));
  }

  /**
   * PUR-11: approve the return (Draft → Approved). The caller removes stock
   * (INVENTORY_MOVEMENT_PORT.returnToSupplier) and writes the negative AP
   * ledger entry in the same transaction; the supplier_return.approved event
   * is published after commit.
   */
  approve(userId: string | null, now: Date): void {
    if (this.data.status !== RETURN_STATUS.DRAFT) {
      throw new PurchasingDomainError(
        PURCHASING_ERROR_CODE.RETURN_EXCEEDS_BILL,
        `Return ${this.data.number} is ${this.data.status}; only a draft can be approved (PUR-11).`,
        { number: this.data.number, status: this.data.status },
      );
    }
    this.data.status = RETURN_STATUS.APPROVED;
    this.data.returnedAt = now.toISOString();
    this.data.updatedAt = now.toISOString();
  }
}

/** Parse a decimal quantity into ×10⁴ integer units (same as money.ts). */
function parseQuantityScaled(value: string): bigint {
  const [whole = '0', frac = '0'] = value.split('.');
  const fracPadded = frac.padEnd(4, '0').slice(0, 4);
  return BigInt(whole) * 10000n + BigInt(fracPadded);
}

/** exact line net = unitCost × qty(4dp), rounded half-up — minor units (hard rule #3). */
function scaledMultiply(unitCostMinor: string, quantity: string): string {
  const qty = parseQuantityScaled(quantity);
  const gross = BigInt(unitCostMinor) * qty;
  return ((gross + 5000n) / 10000n).toString();
}
