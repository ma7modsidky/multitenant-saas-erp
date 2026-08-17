import type { TxOrDb } from '../../../../core/database/repository.base.js';
import type { AccountData, CreditNoteData, InvoiceData, JournalEntryData, TaxRateData } from '../../domain/index.js';

/** DI token for the accounting repository. */
export const ACCOUNTING_REPOSITORY = Symbol('ACCOUNTING_REPOSITORY');

/** acc_accounts row. */
export interface AccountRow {
  id: string;
  organizationId: string;
  code: string;
  nameI18n: Record<string, string>;
  type: string;
  parentId: string | null;
  isSystem: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

/** acc_tax_rates row. */
export interface TaxRateRow {
  id: string;
  organizationId: string;
  code: string;
  nameI18n: Record<string, string>;
  rateBp: number;
  type: string;
  effectiveFrom: string;
  isActive: boolean;
}

/** acc_journal_entries + acc_journal_lines row (entry with lines). */
export interface JournalEntryRow extends JournalEntryData {
  /** Who created the entry row (NULL for system-driven paths, e.g. ACC-15). */
  createdBy: string | null;
  postedBy: string | null;
  reversedByEntryId: string | null;
  entryDate: string;
  idempotencyKey: string | null;
}

/** acc_invoices + acc_invoice_lines row. */
export type InvoiceRow = InvoiceData;

/** acc_credit_notes + acc_credit_note_lines row. */
export type CreditNoteRow = CreditNoteData;

/** A paginated result page (shared with the POS module's PageResult). */
export interface PageResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** Filters for the paginated journal listing. */
export interface JournalFilter {
  /** Free-text search — matches the description (case-insensitive) or the entry number (e.g. `JE-0005` or `5`). */
  q?: string;
  fromDate?: string;
  toDate?: string;
  page?: number;
  pageSize?: number;
}

/** Filters for the paginated invoice listing. */
export interface InvoiceFilter {
  /** Free-text search — matches the invoice number (e.g. `INV-000123`) or the customer name (case-insensitive). */
  q?: string;
  status?: string;
  fromDate?: string;
  toDate?: string;
  page?: number;
  pageSize?: number;
}

/** One GL movement row for an account (journal line + its entry header). */
export interface AccountMovementRow {
  id: string;
  entryId: string;
  entryNumber: number;
  entryDate: string;
  description: string;
  status: string;
  postedAt: string | null;
  debitAmountMinor: string;
  creditAmountMinor: string;
  memo: string | null;
  /** Source reference of the journal entry (e.g. 'invoice_issuance'). */
  sourceType: string;
  /** Id of the source document (e.g. the invoice) when one exists. */
  sourceId: string | null;
  /**
   * Cumulative net (debit − credit) after this movement over the whole
   * filtered set — computed by the window function before the page slice,
   * so a page always carries correct running balances.
   */
  runningBalanceMinor: string;
}

/** One payment row allocated to an invoice (payment + allocation amount). */
export interface InvoicePaymentRow {
  id: string;
  method: string;
  amountMinor: string;
  currency: string;
  receivedAt: string;
  reference: string | null;
  /** The allocation amount applied to THIS invoice (≤ amountMinor). */
  allocationAmountMinor: string;
  createdBy: string | null;
}

/** A credit note header issued against an invoice (ACC-10 trail). */
export interface InvoiceCreditNoteRow {
  id: string;
  creditNoteNumber: string;
  status: string;
  reasonCode: string;
  amountMinor: string;
  currency: string;
  issuedAt: string | null;
  createdAt: string;
}

/** One account's period totals (trial balance / statements aggregation). */
export interface AccountPeriodBalanceRow {
  id: string;
  code: string;
  nameI18n: Record<string, string>;
  type: string;
  isSystem: boolean;
  isActive: boolean;
  /** Σ debit lines for the account in the period (minor units). */
  debitTotalMinor: string;
  /** Σ credit lines for the account in the period (minor units). */
  creditTotalMinor: string;
}

/** An open invoice row for the AR aging report (ACC-8/ACC-9). */
export interface AgingInvoiceRow {
  id: string;
  invoiceNumber: string;
  customerNameSnapshot: string;
  invoiceDate: string;
  dueDate: string;
  currency: string;
  totalAmountMinor: string;
  paidAmountMinor: string;
  creditedAmountMinor: string;
}

/** One payment receipt row in the payments list (ACC-9). */
export interface PaymentListRow {
  id: string;
  method: string;
  /** Human-facing receipt reference, e.g. `REC-000004` (ACC-9). */
  receiptNumber: string;
  amountMinor: string;
  currency: string;
  receivedAt: string;
  reference: string | null;
  /** The invoice the payment was allocated to. */
  invoiceId: string;
  invoiceNumber: string;
  customerNameSnapshot: string;
  /** The allocation amount applied to that invoice (≤ amountMinor). */
  allocationAmountMinor: string;
  createdBy: string | null;
}

/** One allocation of a payment to an invoice (ACC-9 receipt breakdown). */
export interface PaymentAllocationRow {
  id: string;
  invoiceId: string;
  invoiceNumber: string;
  customerNameSnapshot: string;
  invoiceDate: string;
  invoiceStatus: string;
  currency: string;
  /** The amount of this payment applied to that invoice. */
  amountMinor: string;
}

/** One payment receipt with its full allocation breakdown (ACC-9). */
export interface PaymentDetailRow {
  id: string;
  method: string;
  /** Human-facing receipt reference, e.g. `REC-000004` (ACC-9). */
  receiptNumber: string;
  amountMinor: string;
  currency: string;
  receivedAt: string;
  reference: string | null;
  createdBy: string | null;
  createdAt: string;
  allocations: PaymentAllocationRow[];
}

/** Filters for the payments list — method + date range + free-text (ACC-9). */
export interface PaymentFilter {
  method?: string;
  fromDate?: string;
  toDate?: string;
  /** Free-text search — matches the customer name or the invoice number (case-insensitive). */
  q?: string;
  page?: number;
  pageSize?: number;
}

/** One credit note header row in the credit-notes list (ACC-10 trail). */
export interface CreditNoteListRow {
  id: string;
  creditNoteNumber: string;
  invoiceId: string;
  invoiceNumber: string;
  customerNameSnapshot: string;
  status: string;
  reasonCode: string;
  amountMinor: string;
  currency: string;
  issuedAt: string | null;
  createdAt: string;
}

/** One credit note with its reversed lines resolved to item names (ACC-10). */
export interface CreditNoteDetailRow {
  id: string;
  creditNoteNumber: string;
  invoiceId: string;
  invoiceNumber: string;
  customerNameSnapshot: string;
  status: string;
  reasonCode: string;
  amountMinor: string;
  currency: string;
  issuedAt: string | null;
  createdAt: string;
  lines: Array<{
    id: string;
    invoiceLineId: string;
    itemNameSnapshot: string;
    quantity: string;
    unitPriceAmountMinor: string;
    taxAmountMinor: string;
    lineTotalAmountMinor: string;
  }>;
}

/** Filters for the credit-notes list (ACC-10). */
export interface CreditNoteFilter {
  /** Free-text search — matches the credit-note number, invoice number, or customer name (case-insensitive). */
  q?: string;
  page?: number;
  pageSize?: number;
}

/**
 * The accounting read/write repository. RLS scopes every query to the org.
 *
 * @see ARCHITECTURE.md §6 — Level 2/3 port boundary (the repository is a port
 *      declared in the application layer, implemented by Drizzle in
 *      infrastructure; the domain never imports it)
 */
export interface AccountingRepository {
  // ─── Chart of accounts (ACC-5) ─────────────────────────────────────────
  listAccounts(tx?: TxOrDb): Promise<AccountRow[]>;
  findAccountByCode(code: string, tx?: TxOrDb): Promise<AccountRow | undefined>;
  findAccountById(id: string, tx?: TxOrDb): Promise<AccountRow | undefined>;
  insertAccounts(accounts: AccountData[], tx?: TxOrDb): Promise<void>;
  /** ACC-5: rename (name_i18n) and/or toggle is_active on an existing account. */
  updateAccount(id: string, patch: { name?: string; isActive?: boolean }, tx?: TxOrDb): Promise<void>;
  /**
   * GL history for one account, oldest first (entry date, then entry number).
   * Optional date-range filter + pagination; the running balance is computed
   * over the whole filtered set before the page slice (window function), so
   * a page always carries correct cumulative balances.
   */
  findAccountMovements(
    accountId: string,
    filter?: { fromDate?: string; toDate?: string; page?: number; pageSize?: number },
    tx?: TxOrDb,
  ): Promise<PageResult<AccountMovementRow>>;
  /** Σ debits and Σ credits across every posted journal line for the account. */
  sumAccountBalances(accountId: string, tx?: TxOrDb): Promise<{ debitTotal: string; creditTotal: string }>;
  /**
   * Report aggregation: per-account debit/credit totals over a date range
   * (every posted line; reversals net naturally). Accounts with no activity
   * in the period are included with zero totals (trial balance row for all).
   */
  sumAccountPeriodBalances(
    filter: { fromDate?: string; toDate?: string },
    tx?: TxOrDb,
  ): Promise<AccountPeriodBalanceRow[]>;
  /** AR aging: every open invoice (issued / partially_paid / overdue). */
  listOpenInvoices(tx?: TxOrDb): Promise<AgingInvoiceRow[]>;
  /** Payments list — every receipt with its invoice, newest first (ACC-9). */
  listPayments(filter: PaymentFilter, tx?: TxOrDb): Promise<PageResult<PaymentListRow>>;
  /** One payment receipt with its allocation breakdown (ACC-9). */
  getPayment(id: string, tx?: TxOrDb): Promise<PaymentDetailRow | undefined>;
  /** ACC-3 pattern: allocate the next gap-free receipt number per org. */
  allocateReceiptNumber(tx?: TxOrDb): Promise<string>;
  /**
   * The organization's seller tax ID from core_organization_settings (ACC-6) —
   * the default source for new invoices and the display fallback for older
   * invoices whose snapshot is empty. RLS scopes the read to the org.
   */
  getOrgSellerTaxId(tx?: TxOrDb): Promise<string | null>;

  // ─── Tax rates (ACC-11) ────────────────────────────────────────────────
  listTaxRates(tx?: TxOrDb): Promise<TaxRateRow[]>;
  insertTaxRate(rate: TaxRateData, tx?: TxOrDb): Promise<void>;

  // ─── Journal (ACC-1/2/3/4) ─────────────────────────────────────────────
  /** ACC-3: allocate the next entry number atomically (UPDATE ... RETURNING). */
  allocateEntryNumber(tx?: TxOrDb): Promise<number>;
  insertJournalEntry(entry: JournalEntryData, tx?: TxOrDb): Promise<void>;
  findJournalEntryById(id: string, tx?: TxOrDb): Promise<JournalEntryRow | undefined>;
  findJournalEntryBySource(sourceType: string, sourceId: string, tx?: TxOrDb): Promise<JournalEntryRow | undefined>;
  /** ACC-15: idempotent GL posting keyed on the source idempotency key. */
  findJournalEntryByIdempotencyKey(idempotencyKey: string, tx?: TxOrDb): Promise<JournalEntryRow | undefined>;
  updateJournalEntryStatus(id: string, status: string, reversedByEntryId: string | null, tx?: TxOrDb): Promise<void>;
  listJournalEntries(filter: JournalFilter, tx?: TxOrDb): Promise<PageResult<JournalEntryRow>>;

  // ─── Invoices (ACC-6/7/8/9/13) ─────────────────────────────────────────
  /** Allocate the next invoice number atomically (per-org sequence). */
  allocateInvoiceNumber(tx?: TxOrDb): Promise<string>;
  insertInvoice(invoice: InvoiceData, tx?: TxOrDb): Promise<void>;
  findInvoiceById(id: string, tx?: TxOrDb): Promise<InvoiceRow | undefined>;
  findInvoiceByNumber(number: string, tx?: TxOrDb): Promise<InvoiceRow | undefined>;
  findInvoiceBySource(sourceType: string, sourceId: string, tx?: TxOrDb): Promise<InvoiceRow | undefined>;
  /** ACC-13: idempotent auto-invoice keyed on the sale idempotency key. */
  findInvoiceByIdempotencyKey(idempotencyKey: string, tx?: TxOrDb): Promise<InvoiceRow | undefined>;
  updateInvoiceStatus(id: string, status: string, tx?: TxOrDb): Promise<void>;
  updateInvoicePaidAmount(id: string, paidAmountMinor: string, tx?: TxOrDb): Promise<void>;
  /** ACC-10: persist the running credited amount (sum of issued credit notes). */
  updateInvoiceCreditedAmount(id: string, creditedAmountMinor: string, tx?: TxOrDb): Promise<void>;
  listInvoices(filter: InvoiceFilter, tx?: TxOrDb): Promise<PageResult<InvoiceRow>>;
  /** ACC-9: the payments allocated to one invoice (payment history timeline). */
  listInvoicePayments(invoiceId: string, tx?: TxOrDb): Promise<InvoicePaymentRow[]>;
  /** ACC-10: credit notes issued against one invoice (reversal trail). */
  listCreditNotesByInvoice(invoiceId: string, tx?: TxOrDb): Promise<InvoiceCreditNoteRow[]>;

  // ─── Payments + allocations (ACC-9) ────────────────────────────────────
  insertPayment(
    data: {
      id: string;
      organizationId: string;
      method: string;
      /** Human-facing receipt reference, e.g. `REC-000004` (ACC-9). */
      receiptNumber: string;
      amountMinor: string;
      currency: string;
      receivedAt: Date;
      reference: string | null;
      idempotencyKey: string | null;
    },
    tx?: TxOrDb,
  ): Promise<void>;
  insertPaymentAllocation(
    data: {
      id: string;
      organizationId: string;
      paymentId: string;
      invoiceId: string;
      amountMinor: string;
      currency: string;
    },
    tx?: TxOrDb,
  ): Promise<void>;
  /** ACC-9: Σ allocations per invoice (minor units). */
  sumAllocationsByInvoice(invoiceId: string, tx?: TxOrDb): Promise<string>;

  // ─── Credit notes (ACC-10) ─────────────────────────────────────────────
  allocateCreditNoteNumber(tx?: TxOrDb): Promise<string>;
  insertCreditNote(note: CreditNoteData, tx?: TxOrDb): Promise<void>;
  findCreditNoteById(id: string, tx?: TxOrDb): Promise<CreditNoteRow | undefined>;
  /** Credit-notes list — every issued note with its invoice + customer, newest first (ACC-10). */
  listCreditNotes(filter: CreditNoteFilter, tx?: TxOrDb): Promise<PageResult<CreditNoteListRow>>;
  /** One credit note with its reversed lines resolved to item names (ACC-10). */
  getCreditNoteDetail(id: string, tx?: TxOrDb): Promise<CreditNoteDetailRow | undefined>;
  /** ACC-10: Σ issued credit-note amounts per invoice. */
  sumIssuedCreditNotesByInvoice(invoiceId: string, tx?: TxOrDb): Promise<string>;
}
