import { ACCOUNTING_ERROR_CODE, AccountingDomainError } from './errors.js';

export const CREDIT_NOTE_STATUS = {
  DRAFT: 'draft',
  ISSUED: 'issued',
  VOID: 'void',
} as const;

export type CreditNoteStatus = (typeof CREDIT_NOTE_STATUS)[keyof typeof CREDIT_NOTE_STATUS];

export interface CreditNoteLineData {
  id: string;
  creditNoteId: string;
  organizationId: string;
  /** The invoice line being reversed — plain id, no FK. */
  invoiceLineId: string;
  quantity: string;
  unitPriceAmountMinor: string;
  taxAmountMinor: string;
  lineTotalAmountMinor: string;
}

export interface CreditNoteData {
  id: string;
  organizationId: string;
  invoiceId: string;
  invoiceNumber: string;
  creditNoteNumber: string;
  status: CreditNoteStatus;
  /** ACC-7/ACC-10: a credit note always carries a reason — never an edit. */
  reasonCode: string;
  amountMinor: string;
  currency: string;
  issuedAt: string | null;
  createdAt: string;
  updatedAt: string;
  lines: CreditNoteLineData[];
}

export interface CreditNoteLineInput {
  invoiceLineId: string;
  quantity?: string;
  unitPriceAmountMinor: string;
  taxAmountMinor?: string;
}

/**
 * CreditNote — reverses an issued invoice (ACC-10). The note is immutable
 * once issued; the domain guarantees the cumulative credited amount for the
 * invoice never exceeds the invoice net total (the use case checks it against
 * the invoice before persisting — a DB backstop also guards it).
 */
export class CreditNote {
  private constructor(private readonly data: CreditNoteData) {}

  static createDraft(input: {
    id: string;
    organizationId: string;
    invoiceId: string;
    invoiceNumber: string;
    creditNoteNumber: string;
    reasonCode: string;
    currency: string;
    lines: CreditNoteLineInput[];
    now?: Date;
  }): CreditNote {
    const reason = input.reasonCode.trim();
    if (!reason) {
      throw new AccountingDomainError(
        ACCOUNTING_ERROR_CODE.CREDIT_NOTE_EXCEEDS_INVOICE,
        'A credit note requires a reason code (ACC-7/ACC-10).',
      );
    }
    const creditNoteId = input.id;
    const organizationId = input.organizationId;

    const lines: CreditNoteLineData[] = input.lines.map((line, index) => {
      const unitPrice = line.unitPriceAmountMinor;
      if (!/^\d+$/.test(unitPrice)) {
        throw new AccountingDomainError(
          ACCOUNTING_ERROR_CODE.LINE_INVALID,
          `Credit-note line ${index + 1} has an invalid unit price (ACC-4 pattern).`,
          { index },
        );
      }
      const lineTotal = computeLineTotal(unitPrice, line.quantity ?? '1');
      const tax = line.taxAmountMinor ?? '0';
      return {
        id: crypto.randomUUID(),
        creditNoteId,
        organizationId,
        invoiceLineId: line.invoiceLineId,
        quantity: line.quantity ?? '1',
        unitPriceAmountMinor: unitPrice,
        taxAmountMinor: tax,
        lineTotalAmountMinor: lineTotal,
      };
    });

    const amount = lines.reduce((sum, l) => sum + BigInt(l.lineTotalAmountMinor), 0n).toString();

    const timestamp = (input.now ?? new Date()).toISOString();
    return new CreditNote({
      id: creditNoteId,
      organizationId,
      invoiceId: input.invoiceId,
      invoiceNumber: input.invoiceNumber,
      creditNoteNumber: input.creditNoteNumber,
      status: CREDIT_NOTE_STATUS.DRAFT,
      reasonCode: reason,
      amountMinor: amount,
      currency: input.currency.toUpperCase(),
      issuedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      lines,
    });
  }

  static fromJSON(data: CreditNoteData): CreditNote {
    return new CreditNote(data);
  }

  toJSON(): CreditNoteData {
    return {
      ...this.data,
      lines: this.data.lines.map((l) => ({ ...l })),
    };
  }

  get id(): string {
    return this.data.id;
  }

  get creditNoteNumber(): string {
    return this.data.creditNoteNumber;
  }

  get invoiceId(): string {
    return this.data.invoiceId;
  }

  get status(): CreditNoteStatus {
    return this.data.status;
  }

  get amountMinor(): string {
    return this.data.amountMinor;
  }

  get currency(): string {
    return this.data.currency;
  }

  get reasonCode(): string {
    return this.data.reasonCode;
  }

  /** ACC-10: issuing a credit note is the point of no return — it is immutable after. */
  issue(now: Date): void {
    if (this.data.status !== CREDIT_NOTE_STATUS.DRAFT) {
      throw new AccountingDomainError(
        ACCOUNTING_ERROR_CODE.INVOICE_IMMUTABLE,
        `Credit note ${this.data.creditNoteNumber} is already ${this.data.status}; only drafts can be issued (ACC-10).`,
        { creditNoteNumber: this.data.creditNoteNumber, status: this.data.status },
      );
    }
    this.data.status = CREDIT_NOTE_STATUS.ISSUED;
    this.data.issuedAt = now.toISOString();
    this.data.updatedAt = now.toISOString();
  }
}

/** lineTotal = unitPrice × qty (scaled), rounded half-up — exact integer math. */
function computeLineTotal(unitPrice: string, quantity: string): string {
  const qty = parseDecimalScaled(quantity);
  const gross = BigInt(unitPrice) * qty;
  const rounded = (gross + 5000n) / 10000n;
  return rounded.toString();
}

/** Parse a decimal string (e.g. "3.5000") into ×10⁴ integer units. */
function parseDecimalScaled(value: string): bigint {
  const [whole = '0', frac = '0'] = value.split('.');
  const fracPadded = frac.padEnd(4, '0').slice(0, 4);
  return BigInt(whole) * 10000n + BigInt(fracPadded);
}
