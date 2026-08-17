import { ACCOUNTING_ERROR_CODE, AccountingDomainError } from './errors.js';

/**
 * A single journal line (ACC-4): exactly one account, exactly one side
 * (debit XOR credit), positive minor units. All lines of an entry share one
 * currency (enforced at the entry level).
 */
export interface JournalLineData {
  id: string;
  entryId: string;
  organizationId: string;
  accountId: string;
  /** ACC-4: exactly one of these is > 0, the other is 0. */
  debitAmountMinor: string;
  creditAmountMinor: string;
  memo: string | null;
}

export const JOURNAL_ENTRY_STATUS = {
  DRAFT: 'draft',
  POSTED: 'posted',
  REVERSED: 'reversed',
} as const;

export type JournalEntryStatus = (typeof JOURNAL_ENTRY_STATUS)[keyof typeof JOURNAL_ENTRY_STATUS];

export interface JournalEntryData {
  id: string;
  organizationId: string;
  /** ACC-3: sequential + gap-free per org, allocated atomically. */
  entryNumber: number;
  entryDate: string; // ISO date (yyyy-mm-dd)
  description: string;
  currency: string;
  status: JournalEntryStatus;
  /** ACC-15: what produced the entry (e.g. invoice_issuance + invoice id). */
  sourceType: string;
  sourceId: string | null;
  postedAt: string | null;
  postedBy: string | null;
  /** ACC-2: the reversal entry that nullified this one. */
  reversedByEntryId: string | null;
  idempotencyKey: string | null;
  createdAt: string;
  updatedAt: string;
  lines: JournalLineData[];
}

export interface JournalLineInput {
  accountId: string;
  /** Exactly one of debit/credit must be a positive minor-unit string. */
  debitAmountMinor?: string;
  creditAmountMinor?: string;
  memo?: string | null;
}

/**
 * JournalEntry — the double-entry core (ACC-1..ACC-4).
 *
 * Pure domain invariants:
 *  - ACC-1: total debits equal total credits (balanced).
 *  - ACC-2: a posted entry is immutable; corrections are reversal entries.
 *  - ACC-3: entry numbers are allocated atomically, gap-free (the use case
 *    mints the next number inside the transaction; a failed post never
 *    consumes it).
 *  - ACC-4: every line references one account and sets exactly one side with
 *    positive minor units; all lines share one currency.
 */
export class JournalEntry {
  private constructor(private readonly data: JournalEntryData) {}

  static createDraft(input: {
    id: string;
    organizationId: string;
    entryNumber: number;
    entryDate: string;
    description?: string;
    currency: string;
    sourceType: string;
    sourceId?: string | null;
    idempotencyKey?: string | null;
    lines: JournalLineInput[];
    now?: Date;
  }): JournalEntry {
    const currency = input.currency.toUpperCase();
    const entryId = input.id;
    const organizationId = input.organizationId;

    const lines: JournalLineData[] = input.lines.map((line, index) =>
      buildLine({
        id: crypto.randomUUID(),
        entryId,
        organizationId,
        line,
        index,
      }),
    );

    const entry = new JournalEntry({
      id: entryId,
      organizationId,
      entryNumber: input.entryNumber,
      entryDate: input.entryDate,
      description: input.description ?? '',
      currency,
      status: JOURNAL_ENTRY_STATUS.DRAFT,
      sourceType: input.sourceType,
      sourceId: input.sourceId ?? null,
      postedAt: null,
      postedBy: null,
      reversedByEntryId: null,
      idempotencyKey: input.idempotencyKey ?? null,
      createdAt: (input.now ?? new Date()).toISOString(),
      updatedAt: (input.now ?? new Date()).toISOString(),
      lines,
    });

    // ACC-1: a draft is balanced by construction at creation.
    entry.assertBalanced();
    // ACC-4: every line shares the entry currency.
    return entry;
  }

  static fromJSON(data: JournalEntryData): JournalEntry {
    const entry = new JournalEntry(data);
    if (entry.data.status !== JOURNAL_ENTRY_STATUS.DRAFT) {
      // Only drafts round-trip through fromJSON in the mutable lifecycle;
      // posted/reversed rows come from the append-only ledger read-only.
      entry.assertBalanced();
    }
    return entry;
  }

  /** Rebuild a read-only posted entry (no mutation methods available). */
  static fromLedger(data: JournalEntryData): JournalEntry {
    return new JournalEntry(data);
  }

  toJSON(): JournalEntryData {
    return {
      ...this.data,
      lines: this.data.lines.map((l) => ({ ...l })),
    };
  }

  get id(): string {
    return this.data.id;
  }

  get status(): JournalEntryStatus {
    return this.data.status;
  }

  get currency(): string {
    return this.data.currency;
  }

  get entryNumber(): number {
    return this.data.entryNumber;
  }

  get sourceType(): string {
    return this.data.sourceType;
  }

  get sourceId(): string | null {
    return this.data.sourceId;
  }

  get idempotencyKey(): string | null {
    return this.data.idempotencyKey;
  }

  get lines(): JournalLineData[] {
    return this.data.lines.map((l) => ({ ...l }));
  }

  get debitTotal(): string {
    return this.data.lines.reduce((sum, l) => addMinorUnits(sum, l.debitAmountMinor), '0');
  }

  get creditTotal(): string {
    return this.data.lines.reduce((sum, l) => addMinorUnits(sum, l.creditAmountMinor), '0');
  }

  /** ACC-1: total debits must equal total credits. */
  assertBalanced(): void {
    if (this.debitTotal !== this.creditTotal) {
      throw new AccountingDomainError(
        ACCOUNTING_ERROR_CODE.ENTRY_UNBALANCED,
        `Journal entry ${this.data.entryNumber} is unbalanced: debits=${this.debitTotal}, credits=${this.creditTotal} (ACC-1).`,
        { entryNumber: this.data.entryNumber, debitTotal: this.debitTotal, creditTotal: this.creditTotal },
      );
    }
  }

  /** ACC-2: only a draft may be edited; a posted entry can only be reversed. */
  assertMutable(): void {
    if (this.data.status !== JOURNAL_ENTRY_STATUS.DRAFT) {
      throw new AccountingDomainError(
        ACCOUNTING_ERROR_CODE.ENTRY_IMMUTABLE,
        `Journal entry ${this.data.entryNumber} is ${this.data.status}; only drafts are mutable (ACC-2).`,
        { entryNumber: this.data.entryNumber, status: this.data.status },
      );
    }
  }

  /**
   * Post the entry: flips the status to `posted` and stamps the time/actor.
   * The balance invariant was already asserted; this is the point of no return.
   */
  post(now: Date, postedBy: string): void {
    this.assertMutable();
    this.assertBalanced();
    this.data.status = JOURNAL_ENTRY_STATUS.POSTED;
    this.data.postedAt = now.toISOString();
    this.data.postedBy = postedBy;
    this.data.updatedAt = now.toISOString();
  }

  /** ACC-2: reversal marks the original `reversed`, referencing the reversal entry. */
  markReversed(reversedByEntryId: string, now: Date): void {
    if (this.data.status !== JOURNAL_ENTRY_STATUS.POSTED) {
      throw new AccountingDomainError(
        ACCOUNTING_ERROR_CODE.ENTRY_IMMUTABLE,
        `Only a posted entry can be reversed; ${this.data.entryNumber} is ${this.data.status} (ACC-2).`,
        { entryNumber: this.data.entryNumber, status: this.data.status },
      );
    }
    this.data.status = JOURNAL_ENTRY_STATUS.REVERSED;
    this.data.reversedByEntryId = reversedByEntryId;
    this.data.updatedAt = now.toISOString();
  }
}

/** ACC-4: build one line, validating exactly-one-side + positive amounts. */
function buildLine(input: {
  id: string;
  entryId: string;
  organizationId: string;
  line: JournalLineInput;
  index: number;
}): JournalLineData {
  const debit = input.line.debitAmountMinor ?? '0';
  const credit = input.line.creditAmountMinor ?? '0';
  const isDebit = isPositiveMinor(debit);
  const isCredit = isPositiveMinor(credit);

  // ACC-4: exactly one side, positive minor units.
  if (isDebit === isCredit) {
    throw new AccountingDomainError(
      ACCOUNTING_ERROR_CODE.LINE_INVALID,
      `Journal line ${input.index + 1} must set exactly one of debit or credit with a positive minor-unit amount (ACC-4).`,
      { index: input.index, debit, credit },
    );
  }

  return {
    id: input.id,
    entryId: input.entryId,
    organizationId: input.organizationId,
    accountId: input.line.accountId,
    debitAmountMinor: isDebit ? debit : '0',
    creditAmountMinor: isCredit ? credit : '0',
    memo: input.line.memo ?? null,
  };
}

/** True when the string is a positive integer minor-unit amount. */
function isPositiveMinor(value: string): boolean {
  return /^[1-9]\d*$/.test(value);
}

/** Exact integer addition on minor-unit strings (hard rule #3). */
function addMinorUnits(a: string, b: string): string {
  return (BigInt(a) + BigInt(b)).toString();
}
