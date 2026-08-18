import { PURCHASING_ERROR_CODE, PurchasingDomainError } from './errors.js';

export const LEDGER_ENTRY_TYPE = {
  OPENING_BALANCE: 'opening_balance',
  BILL: 'bill',
  PAYMENT: 'payment',
  DEBIT_NOTE: 'debit_note',
} as const;

export type LedgerEntryType = (typeof LEDGER_ENTRY_TYPE)[keyof typeof LEDGER_ENTRY_TYPE];

export interface VendorLedgerEntryData {
  id: string;
  organizationId: string;
  supplierId: string;
  type: LedgerEntryType;
  /** SIGNED minor units: bills +, payments −, debit notes −, opening ±. */
  amountMinor: string;
  currency: string;
  referenceType: string;
  referenceId: string | null;
  entryDate: string;
  idempotencyKey: string | null;
  createdAt: string;
  createdBy: string | null;
}

/**
 * VendorLedgerEntry — one append-only line of the AP ledger (PUR-2).
 *
 * The ledger is the SOURCE OF TRUTH for accounts payable: a supplier's balance
 * is ALWAYS the signed sum of its entries — derived, never edited directly.
 * Rows are written once (the 0003_append_only.sql trigger rejects any
 * UPDATE/DELETE). The domain knows the signing convention: bills positive,
 * payments negative, debit notes negative, opening balance ±.
 */
export class VendorLedgerEntry {
  private constructor(private readonly data: VendorLedgerEntryData) {}

  static create(input: {
    id: string;
    organizationId: string;
    supplierId: string;
    type: LedgerEntryType;
    amountMinor: string;
    currency: string;
    referenceType: string;
    referenceId?: string | null;
    entryDate?: string;
    idempotencyKey?: string | null;
    now?: Date;
  }): VendorLedgerEntry {
    // Sign the amount per type (PUR-2): bills +, payments −, debit notes −.
    let signed = input.amountMinor;
    if (input.type === LEDGER_ENTRY_TYPE.PAYMENT || input.type === LEDGER_ENTRY_TYPE.DEBIT_NOTE) {
      signed = `-${input.amountMinor.replace(/^-/, '')}`;
    } else if (input.type === LEDGER_ENTRY_TYPE.OPENING_BALANCE) {
      signed = input.amountMinor;
    }
    const timestamp = (input.now ?? new Date()).toISOString();
    const today = (input.now ?? new Date()).toISOString().slice(0, 10);
    return new VendorLedgerEntry({
      id: input.id,
      organizationId: input.organizationId,
      supplierId: input.supplierId,
      type: input.type,
      amountMinor: signed,
      currency: input.currency.toUpperCase(),
      referenceType: input.referenceType,
      referenceId: input.referenceId ?? null,
      entryDate: input.entryDate ?? today,
      idempotencyKey: input.idempotencyKey ?? null,
      createdAt: timestamp,
      createdBy: null,
    });
  }

  static fromJSON(data: VendorLedgerEntryData): VendorLedgerEntry {
    return new VendorLedgerEntry(data);
  }

  toJSON(): VendorLedgerEntryData {
    return { ...this.data };
  }

  get id(): string {
    return this.data.id;
  }

  get organizationId(): string {
    return this.data.organizationId;
  }

  get supplierId(): string {
    return this.data.supplierId;
  }

  get type(): LedgerEntryType {
    return this.data.type;
  }

  /** The signed amount (bills +, payments −, debit notes −). */
  get amountMinor(): string {
    return this.data.amountMinor;
  }

  get referenceId(): string | null {
    return this.data.referenceId;
  }

  get idempotencyKey(): string | null {
    return this.data.idempotencyKey;
  }

  /** PUR-2: the balance contribution of this entry. */
  get signedMinor(): bigint {
    return BigInt(this.data.amountMinor);
  }

  /** PUR-2: reject any mutation — the ledger is append-only. */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- API-shape guard; never called by valid flows
  static assertImmutable(): void {
    throw new PurchasingDomainError(
      PURCHASING_ERROR_CODE.LEDGER_APPEND_ONLY,
      'The vendor ledger is append-only — corrections are new entries (PUR-2).',
    );
  }
}

/** PUR-2: a supplier's balance is the signed sum of its ledger entries. */
export function vendorBalance(entries: Array<Pick<VendorLedgerEntryData, 'amountMinor'>>): string {
  return entries.reduce((sum, entry) => sum + BigInt(entry.amountMinor), 0n).toString();
}
