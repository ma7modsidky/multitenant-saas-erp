import { ACCOUNTING_ERROR_CODE, AccountingDomainError } from './errors.js';
import { calculateLineTax, type TaxBasis, type TaxType } from './tax-engine.js';

export const INVOICE_STATUS = {
  DRAFT: 'draft',
  ISSUED: 'issued',
  PARTIALLY_PAID: 'partially_paid',
  PAID: 'paid',
  OVERDUE: 'overdue',
  VOID: 'void',
} as const;

export type InvoiceStatus = (typeof INVOICE_STATUS)[keyof typeof INVOICE_STATUS];

export const INVOICE_SOURCE_TYPE = {
  MANUAL: 'manual',
  POS_SALE: 'pos_sale',
} as const;

export type InvoiceSourceType = (typeof INVOICE_SOURCE_TYPE)[keyof typeof INVOICE_SOURCE_TYPE];

export interface InvoiceLineData {
  id: string;
  invoiceId: string;
  organizationId: string;
  /** Inventory variant id — plain id, no FK (hard rule #1). Null for service. */
  variantId: string | null;
  itemNameSnapshot: string;
  description: string | null;
  /** Decimal string in UoM units (numeric(18,4)). */
  quantity: string;
  unitPriceAmountMinor: string;
  discountAmountMinor: string;
  taxRateId: string | null;
  taxRateBpSnapshot: number;
  taxTypeSnapshot: string;
  /** ACC-11: exclusive | inclusive — the basis the line tax was computed under. */
  taxBasisSnapshot: TaxBasis;
  taxAmountMinor: string;
  lineTotalAmountMinor: string;
  /** ACC-14: goods lines deduct stock at issuance via the movement port. */
  isGoods: boolean;
}

export interface InvoiceData {
  id: string;
  organizationId: string;
  invoiceNumber: string;
  customerContactId: string | null;
  customerCompanyId: string | null;
  customerNameSnapshot: string;
  customerTaxIdSnapshot: string | null;
  sellerTaxId: string | null;
  status: InvoiceStatus;
  invoiceDate: string;
  dueDate: string;
  currency: string;
  exchangeRate: string | null;
  baseTotalAmountMinor: string | null;
  subtotalAmountMinor: string;
  discountAmountMinor: string;
  taxAmountMinor: string;
  totalAmountMinor: string;
  locale: string;
  sourceType: InvoiceSourceType;
  sourceId: string | null;
  idempotencyKey: string | null;
  eInvoiceUuid: string | null;
  eInvoiceHash: string | null;
  eInvoiceIrn: string | null;
  eInvoiceQr: string | null;
  eInvoiceStatus: string | null;
  createdAt: string;
  updatedAt: string;
  lines: InvoiceLineData[];
  /** Sum of applied payment allocations (ACC-9), read from the ledger. */
  paidAmountMinor: string;
  /** Sum of issued credit-note amounts (ACC-10), read from the ledger. */
  creditedAmountMinor: string;
}

export interface InvoiceLineInput {
  variantId?: string | null;
  itemNameSnapshot: string;
  description?: string | null;
  /** Decimal string in UoM units. */
  quantity?: string;
  unitPriceAmountMinor: string;
  discountAmountMinor?: string;
  taxRateId?: string | null;
  taxRateBpSnapshot?: number;
  taxTypeSnapshot?: string;
  /** ACC-11: the basis the tax was computed under (defaults to exclusive). */
  taxBasisSnapshot?: TaxBasis;
  /**
   * ACC-13 carry-over: when the tax is supplied directly (auto-invoice from a
   * POS sale whose line taxes were already computed per line, POS-17), it is
   * used verbatim instead of re-computing from rateBp. The document tax total
   * is still the sum of line taxes (ACC-11).
   */
  taxAmountMinor?: string;
  /** ACC-14: goods lines deduct stock at issuance. */
  isGoods?: boolean;
}

/**
 * Invoice + lines — the AR aggregate (ACC-6..ACC-12, ACC-14).
 *
 * Exact integer money math only (hard rule #3): every amount is a
 * minor-unit string; line totals and the document totals are computed with
 * BigInt. Line rounding is authoritative (CUR-8): each line computes
 * tax = round(price×rate_bp/10000) once, and the document tax total is the
 * sum of line taxes — never a re-computed document-level rate.
 */
export class Invoice {
  private constructor(private readonly data: InvoiceData) {}

  static createDraft(input: {
    id: string;
    organizationId: string;
    invoiceNumber: string;
    customerContactId?: string | null;
    customerCompanyId?: string | null;
    customerNameSnapshot: string;
    customerTaxIdSnapshot?: string | null;
    sellerTaxId?: string | null;
    invoiceDate?: string;
    dueDate: string;
    currency: string;
    locale?: string;
    sourceType?: InvoiceSourceType;
    sourceId?: string | null;
    idempotencyKey?: string | null;
    lines: InvoiceLineInput[];
    now?: Date;
  }): Invoice {
    // ACC-6: an invoice needs a customer. The CRM ids are optional (a manual
    // invoice may bill a name-only customer — DATA_MODEL §10); the name
    // snapshot is what appears on the document, so it must be present.
    if (!input.customerNameSnapshot || input.customerNameSnapshot.trim() === '') {
      throw new AccountingDomainError('ACCOUNTING_INVOICE_CUSTOMER_REQUIRED', 'An invoice requires a customer name.');
    }
    const currency = input.currency.toUpperCase();
    const invoiceId = input.id;
    const organizationId = input.organizationId;
    const today = (input.now ?? new Date()).toISOString().slice(0, 10);

    const lines: InvoiceLineData[] = input.lines.map((line, index) => {
      const unitPrice = line.unitPriceAmountMinor;
      const quantity = line.quantity ?? '1';
      const discount = line.discountAmountMinor ?? '0';
      const rateBp = line.taxRateBpSnapshot ?? 0;
      const taxType = line.taxTypeSnapshot ?? 'standard';
      const taxBasis = line.taxBasisSnapshot ?? 'exclusive';

      if (!isNonNegativeMinor(unitPrice)) {
        throw new AccountingDomainError(
          ACCOUNTING_ERROR_CODE.LINE_INVALID,
          `Invoice line ${index + 1} has a negative unit price (ACC-4 pattern).`,
          { index },
        );
      }

      const lineTotal = computeLineTotal(unitPrice, quantity, discount);
      // ACC-11: per-line tax, rounded once (CUR-8), exclusive or inclusive per
      // the rate's basis. 0 for exempt/zero rates.
      // ACC-13: an explicit line tax (POS sale carry-over) wins over a
      // re-computation from the rate snapshot.
      const tax =
        line.taxAmountMinor !== undefined
          ? line.taxAmountMinor
          : taxType === 'exempt' || rateBp === 0
            ? '0'
            : calculateLineTax(lineTotal, { rateBp, type: taxType as TaxType, taxBasis }).taxAmountMinor;
      if (!/^\d+$/.test(tax)) {
        throw new AccountingDomainError(
          ACCOUNTING_ERROR_CODE.LINE_INVALID,
          `Invoice line ${index + 1} has an invalid tax amount (ACC-11).`,
          { index },
        );
      }

      return {
        id: crypto.randomUUID(),
        invoiceId,
        organizationId,
        variantId: line.variantId ?? null,
        itemNameSnapshot: line.itemNameSnapshot,
        description: line.description ?? null,
        quantity,
        unitPriceAmountMinor: unitPrice,
        discountAmountMinor: discount,
        taxRateId: line.taxRateId ?? null,
        taxRateBpSnapshot: rateBp,
        taxTypeSnapshot: taxType,
        taxBasisSnapshot: taxBasis,
        taxAmountMinor: tax,
        lineTotalAmountMinor: lineTotal,
        isGoods: line.isGoods ?? false,
      };
    });

    if (lines.length === 0) {
      throw new AccountingDomainError('ACCOUNTING_INVOICE_NO_LINES', 'An invoice requires at least one line.');
    }

    const subtotal = sumMinor(lines.map((l) => l.lineTotalAmountMinor));
    const tax = sumMinor(lines.map((l) => l.taxAmountMinor));
    const total = addMinor(subtotal, tax);

    const timestamp = (input.now ?? new Date()).toISOString();
    return new Invoice({
      id: invoiceId,
      organizationId,
      invoiceNumber: input.invoiceNumber,
      customerContactId: input.customerContactId ?? null,
      customerCompanyId: input.customerCompanyId ?? null,
      customerNameSnapshot: input.customerNameSnapshot,
      customerTaxIdSnapshot: input.customerTaxIdSnapshot ?? null,
      sellerTaxId: input.sellerTaxId ?? null,
      status: INVOICE_STATUS.DRAFT,
      invoiceDate: input.invoiceDate ?? today,
      dueDate: input.dueDate,
      currency,
      exchangeRate: null,
      baseTotalAmountMinor: null,
      subtotalAmountMinor: subtotal,
      discountAmountMinor: '0',
      taxAmountMinor: tax,
      totalAmountMinor: total,
      locale: input.locale ?? 'en',
      sourceType: input.sourceType ?? INVOICE_SOURCE_TYPE.MANUAL,
      sourceId: input.sourceId ?? null,
      idempotencyKey: input.idempotencyKey ?? null,
      eInvoiceUuid: null,
      eInvoiceHash: null,
      eInvoiceIrn: null,
      eInvoiceQr: null,
      eInvoiceStatus: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      lines,
      paidAmountMinor: '0',
      creditedAmountMinor: '0',
    });
  }

  static fromJSON(data: InvoiceData): Invoice {
    return new Invoice(data);
  }

  toJSON(): InvoiceData {
    return {
      ...this.data,
      lines: this.data.lines.map((l) => ({ ...l })),
    };
  }

  get id(): string {
    return this.data.id;
  }

  get invoiceNumber(): string {
    return this.data.invoiceNumber;
  }

  get status(): InvoiceStatus {
    return this.data.status;
  }

  get totalAmountMinor(): string {
    return this.data.totalAmountMinor;
  }

  get currency(): string {
    return this.data.currency;
  }

  get sourceType(): InvoiceSourceType {
    return this.data.sourceType;
  }

  get sourceId(): string | null {
    return this.data.sourceId;
  }

  get idempotencyKey(): string | null {
    return this.data.idempotencyKey;
  }

  get lines(): InvoiceLineData[] {
    return this.data.lines.map((l) => ({ ...l }));
  }

  /** True when at least one line is a goods line (ACC-14). */
  get hasGoodsLines(): boolean {
    return this.data.lines.some((l) => l.isGoods);
  }

  /** ACC-9: the remaining unpaid balance. */
  get balanceDue(): string {
    return subMinor(this.data.totalAmountMinor, this.data.paidAmountMinor);
  }

  /**
   * ACC-6: issue the invoice — Draft → Issued is the point of no return.
   * The caller posts the AR journal entry atomically (ACC-6) and, for goods
   * lines, deducts stock through the movement port in the SAME transaction
   * (ACC-14).
   */
  issue(now: Date): void {
    if (this.data.status !== INVOICE_STATUS.DRAFT) {
      throw new AccountingDomainError(
        ACCOUNTING_ERROR_CODE.INVOICE_NOT_DRAFT,
        `Invoice ${this.data.invoiceNumber} is ${this.data.status}; only a draft can be issued (ACC-6).`,
        { invoiceNumber: this.data.invoiceNumber, status: this.data.status },
      );
    }
    this.data.status = INVOICE_STATUS.ISSUED;
    this.data.updatedAt = now.toISOString();
  }

  /**
   * ACC-8: legal status transitions. `overdue` is computed by the nightly job
   * from the due date + unpaid balance — not an explicit transition here.
   */
  transitionTo(next: InvoiceStatus, now: Date): void {
    const legal: Record<InvoiceStatus, InvoiceStatus[]> = {
      // ACC-8 lifecycle: Draft → Issued → Partially Paid → Paid → Overdue → Void.
      // Draft → Void is the direct cancel (ACC-7: only an unissued draft may be
      // cancelled directly); every other Void transition requires a credit note
      // and is guarded below (ACC-7: voiding an issued invoice is a credit note
      // + status change, never an edit).
      [INVOICE_STATUS.DRAFT]: [INVOICE_STATUS.ISSUED, INVOICE_STATUS.VOID],
      [INVOICE_STATUS.ISSUED]: [
        INVOICE_STATUS.PARTIALLY_PAID,
        INVOICE_STATUS.PAID,
        INVOICE_STATUS.OVERDUE,
        INVOICE_STATUS.VOID,
      ],
      [INVOICE_STATUS.PARTIALLY_PAID]: [INVOICE_STATUS.PAID, INVOICE_STATUS.OVERDUE, INVOICE_STATUS.VOID],
      [INVOICE_STATUS.PAID]: [INVOICE_STATUS.VOID],
      [INVOICE_STATUS.OVERDUE]: [INVOICE_STATUS.PARTIALLY_PAID, INVOICE_STATUS.PAID, INVOICE_STATUS.VOID],
      [INVOICE_STATUS.VOID]: [],
    };

    if (!legal[this.data.status].includes(next)) {
      throw new AccountingDomainError(
        ACCOUNTING_ERROR_CODE.INVOICE_ILLEGAL_TRANSITION,
        `Illegal invoice status transition ${this.data.status} → ${next} (ACC-8).`,
        { from: this.data.status, to: next },
      );
    }
    // ACC-7: an issued invoice is immutable except for the documented status
    // lifecycle; voiding an issued invoice is a credit note + status change,
    // never an edit.
    if (this.data.status !== INVOICE_STATUS.DRAFT && next === INVOICE_STATUS.VOID) {
      // Voiding issued/partially_paid/overdue requires a credit note (ACC-7).
      throw new AccountingDomainError(
        ACCOUNTING_ERROR_CODE.INVOICE_IMMUTABLE,
        `Invoice ${this.data.invoiceNumber} cannot be voided directly; issue a credit note (ACC-7).`,
        { invoiceNumber: this.data.invoiceNumber, status: this.data.status },
      );
    }
    this.data.status = next;
    this.data.updatedAt = now.toISOString();
  }

  /**
   * ACC-7: the credit-note issuance path voids an issued invoice — this is the
   * ONLY sanctioned way to void a non-draft invoice (a credit note + status
   * change, never an edit). The credit-note use case calls this AFTER the note
   * is issued and its reversal entry posts.
   */
  markVoidedViaCreditNote(now: Date): void {
    if (this.data.status === INVOICE_STATUS.DRAFT || this.data.status === INVOICE_STATUS.VOID) {
      throw new AccountingDomainError(
        ACCOUNTING_ERROR_CODE.INVOICE_ILLEGAL_TRANSITION,
        `Invoice ${this.data.invoiceNumber} is ${this.data.status}; only issued invoices are voided via credit note (ACC-7).`,
        { invoiceNumber: this.data.invoiceNumber, status: this.data.status },
      );
    }
    this.data.status = INVOICE_STATUS.VOID;
    this.data.updatedAt = now.toISOString();
  }

  /**
   * ACC-9: apply an allocation of `amount` to this invoice. The total applied
   * (ledger sum + this allocation) can never exceed the invoice total.
   * Returns the new paid amount so the caller can persist the allocation.
   */
  applyPayment(amountMinor: string, now: Date): string {
    if (this.data.status === INVOICE_STATUS.VOID || this.data.status === INVOICE_STATUS.DRAFT) {
      throw new AccountingDomainError(
        ACCOUNTING_ERROR_CODE.INVOICE_ILLEGAL_TRANSITION,
        `Cannot allocate a payment to a ${this.data.status} invoice (ACC-9).`,
        { invoiceNumber: this.data.invoiceNumber, status: this.data.status },
      );
    }
    if (!isNonNegativeMinor(amountMinor)) {
      throw new AccountingDomainError(
        ACCOUNTING_ERROR_CODE.PAYMENT_OVER_ALLOCATED,
        'Allocation must be positive (ACC-9).',
      );
    }
    const newPaid = addMinor(this.data.paidAmountMinor, amountMinor);
    if (compareMinor(newPaid, this.data.totalAmountMinor) > 0) {
      throw new AccountingDomainError(
        ACCOUNTING_ERROR_CODE.PAYMENT_OVER_ALLOCATED,
        `Allocation would exceed the invoice total (${this.data.totalAmountMinor}) (ACC-9).`,
        { invoiceNumber: this.data.invoiceNumber, allocated: newPaid, total: this.data.totalAmountMinor },
      );
    }
    this.data.paidAmountMinor = newPaid;
    this.data.updatedAt = now.toISOString();

    // ACC-8: crossing to fully paid flips the status.
    if (
      compareMinor(this.data.paidAmountMinor, this.data.totalAmountMinor) === 0 &&
      this.data.status !== INVOICE_STATUS.PAID
    ) {
      this.data.status = INVOICE_STATUS.PAID;
    } else if (compareMinor(this.data.paidAmountMinor, '0') > 0 && this.data.status === INVOICE_STATUS.ISSUED) {
      this.data.status = INVOICE_STATUS.PARTIALLY_PAID;
    }
    return this.data.paidAmountMinor;
  }

  /**
   * ACC-10: record an issued credit note against this invoice. Cumulative
   * credited amounts never exceed the invoice net total.
   */
  applyCreditNote(amountMinor: string, now: Date): void {
    if (!isNonNegativeMinor(amountMinor)) {
      throw new AccountingDomainError(
        ACCOUNTING_ERROR_CODE.CREDIT_NOTE_EXCEEDS_INVOICE,
        'Credit-note amount must be positive (ACC-10).',
      );
    }
    const newCredited = addMinor(this.data.creditedAmountMinor, amountMinor);
    if (compareMinor(newCredited, this.data.totalAmountMinor) > 0) {
      throw new AccountingDomainError(
        ACCOUNTING_ERROR_CODE.CREDIT_NOTE_EXCEEDS_INVOICE,
        `Cumulative credit notes (${newCredited}) exceed the invoice total (${this.data.totalAmountMinor}) (ACC-10).`,
        { invoiceNumber: this.data.invoiceNumber, credited: newCredited, total: this.data.totalAmountMinor },
      );
    }
    this.data.creditedAmountMinor = newCredited;
    this.data.updatedAt = now.toISOString();
  }

  /**
   * ACC-12: mark the invoice's e-invoice metadata as provided by the
   * compliance adapter. A compliant invoice must carry a valid hash.
   */
  markEInvoiceCompliance(input: {
    eInvoiceUuid: string;
    eInvoiceHash: string;
    eInvoiceIrn: string | null;
    eInvoiceQr: string | null;
    status: 'submitted' | 'compliant' | 'failed';
  }): void {
    if (input.status === 'compliant' && !input.eInvoiceHash) {
      throw new AccountingDomainError(
        ACCOUNTING_ERROR_CODE.E_INVOICE_PROVIDER_UNAVAILABLE,
        'A compliant invoice must carry a valid e-invoice hash (ACC-12).',
      );
    }
    this.data.eInvoiceUuid = input.eInvoiceUuid;
    this.data.eInvoiceHash = input.eInvoiceHash;
    this.data.eInvoiceIrn = input.eInvoiceIrn;
    this.data.eInvoiceQr = input.eInvoiceQr;
    this.data.eInvoiceStatus = input.status;
  }
}

// ─── exact integer money helpers (hard rule #3) ─────────────────────────────

function isNonNegativeMinor(value: string): boolean {
  return /^\d+$/.test(value);
}

function addMinor(a: string, b: string): string {
  return (BigInt(a) + BigInt(b)).toString();
}

function subMinor(a: string, b: string): string {
  return (BigInt(a) - BigInt(b)).toString();
}

function sumMinor(values: string[]): string {
  return values.reduce((sum, v) => sum + BigInt(v), 0n).toString();
}

function compareMinor(a: string, b: string): number {
  return BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0;
}

/** lineTotal = (unitPrice × qty) − discount, exact, qty scaled by 10⁴. */
function computeLineTotal(unitPrice: string, quantity: string, discount: string): string {
  const qty = parseDecimalScaled(quantity);
  // (unitPrice × qty) / 10⁴, rounded half-up — quantity carries 4 dp.
  const gross = BigInt(unitPrice) * qty;
  const rounded = (gross + 5000n) / 10000n;
  const total = rounded - BigInt(discount);
  return total < 0n ? '0' : total.toString();
}

/** Parse a decimal string (e.g. "3.5000") into ×10⁴ integer units. */
function parseDecimalScaled(value: string): bigint {
  const [whole = '0', frac = '0'] = value.split('.');
  const fracPadded = frac.padEnd(4, '0').slice(0, 4);
  return BigInt(whole) * 10000n + BigInt(fracPadded);
}
