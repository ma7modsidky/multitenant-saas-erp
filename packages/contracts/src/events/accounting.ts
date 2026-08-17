// Accounting & Invoicing event payload schemas
//
// @see PLAN.md §7.1 — Declare contracts first
// @see DATA_MODEL.md §10 — Accounting schema (`acc_`)
// @see BUSINESS_RULES.md §13 — Accounting and invoicing rules (ACC-*)
//
// Every payload carries `organizationId` (the payload is the event's source of
// truth for tenant context — handlers run without the publishing tenant
// context) and `occurredAt` (ISO 8601) per MODULE_GUIDE.md Step 1.
import { z } from 'zod';

// Import the primitives directly (not via ./index.js) so the module never
// participates in an import cycle with its own barrel (depcruise no-circular).
import { currencyCode, decimalString, minorUnitsString } from './primitives.js';

/** Stable Accounting event names. Consumed by the module descriptor (`publishes`). */
export const ACCOUNTING_EVENTS = {
  INVOICE_ISSUED_V1: 'accounting.invoice.issued.v1',
  INVOICE_PAID_V1: 'accounting.invoice.paid.v1',
  CREDIT_NOTE_ISSUED_V1: 'accounting.credit_note.issued.v1',
  JOURNAL_POSTED_V1: 'accounting.journal.posted.v1',
  PAYMENT_RECEIVED_V1: 'accounting.payment.received.v1',
} as const;

/** The money block every invoice carries (single currency per document — ACC-4). */
const invoiceMoney = {
  subtotalAmountMinor: minorUnitsString,
  discountAmountMinor: minorUnitsString,
  taxAmountMinor: minorUnitsString,
  totalAmountMinor: minorUnitsString,
  currency: currencyCode,
};

/**
 * Payload of `accounting.invoice.issued.v1` — emitted when an invoice moves
 * from Draft to Issued and its AR journal entry posts atomically (ACC-6).
 * Issuance is the point of no return (ACC-7); consumers may rely on the
 * invoice being immutable from here on.
 */
export const accountingInvoiceIssuedV1Schema = z.object({
  organizationId: z.string().uuid(),
  invoiceId: z.string().uuid(),
  /** Sequential, gap-free per organization (ACC-3 pattern for documents). */
  invoiceNumber: z.string().min(1),
  // CRM customer ids — plain ids, no FK (hard rule #1). At least one is set.
  customerContactId: z.string().uuid().nullable().optional(),
  customerCompanyId: z.string().uuid().nullable().optional(),
  /** Snapshot so downstream systems (receipts, reports) work after edits. */
  customerNameSnapshot: z.string().min(1),
  ...invoiceMoney,
  /** FX snapshot when the invoice currency differs from the org base currency. */
  exchangeRate: decimalString.optional(),
  baseTotalAmountMinor: minorUnitsString.optional(),
  invoiceDate: z.string().datetime(),
  dueDate: z.string().datetime(),
  lineCount: z.number().int().positive(),
  /** Where the invoice came from — manual or a completed POS sale (ACC-13). */
  sourceType: z.enum(['manual', 'pos_sale']),
  /** Plain reference to the source document (sale id for pos_sale) — no FK. */
  sourceId: z.string().uuid().nullable().optional(),
  issuedAt: z.string().datetime(),
  occurredAt: z.string().datetime(),
});
export type AccountingInvoiceIssuedV1 = z.infer<typeof accountingInvoiceIssuedV1Schema>;

/**
 * Payload of `accounting.invoice.paid.v1` — emitted when accumulated AR
 * allocations reach the invoice total and the invoice becomes Paid (ACC-9).
 */
export const accountingInvoicePaidV1Schema = z.object({
  organizationId: z.string().uuid(),
  invoiceId: z.string().uuid(),
  invoiceNumber: z.string().min(1),
  /** The payment that completed the invoice (the last allocation). */
  paymentId: z.string().uuid(),
  /** Amount of THIS payment's final allocation, in the payment currency. */
  amountMinor: minorUnitsString,
  currency: currencyCode,
  paidAt: z.string().datetime(),
  occurredAt: z.string().datetime(),
});
export type AccountingInvoicePaidV1 = z.infer<typeof accountingInvoicePaidV1Schema>;

/**
 * Payload of `accounting.credit_note.issued.v1` — emitted when a credit note
 * reverses an issued invoice (ACC-10). Credit notes are themselves immutable
 * once issued.
 */
export const accountingCreditNoteIssuedV1Schema = z.object({
  organizationId: z.string().uuid(),
  creditNoteId: z.string().uuid(),
  /** Sequential, gap-free per organization (ACC-10). */
  creditNoteNumber: z.string().min(1),
  /** The invoice being reversed — plain id, no FK. */
  invoiceId: z.string().uuid(),
  invoiceNumber: z.string().min(1),
  /** Why the note was issued (ACC-7: corrections are credit notes, never edits). */
  reasonCode: z.string().min(1),
  amountMinor: minorUnitsString,
  currency: currencyCode,
  issuedAt: z.string().datetime(),
  occurredAt: z.string().datetime(),
});
export type AccountingCreditNoteIssuedV1 = z.infer<typeof accountingCreditNoteIssuedV1Schema>;

/**
 * Payload of `accounting.journal.posted.v1` — emitted after any journal entry
 * posts (ACC-1/ACC-2). Consumers may replicate the GL or alert on drift; the
 * entry is balanced by construction and immutable once posted.
 */
export const accountingJournalPostedV1Schema = z.object({
  organizationId: z.string().uuid(),
  entryId: z.string().uuid(),
  /** Sequential, gap-free per organization (ACC-3). */
  entryNumber: z.number().int().positive(),
  entryDate: z.string().datetime(),
  currency: currencyCode,
  /** Balance invariant (ACC-1): debit total always equals credit total. */
  debitTotalAmountMinor: minorUnitsString,
  creditTotalAmountMinor: minorUnitsString,
  /** What produced the entry — e.g. `invoice_issuance` + invoice id (ACC-15). */
  sourceType: z.string().min(1),
  sourceId: z.string().uuid().nullable().optional(),
  postedAt: z.string().datetime(),
  occurredAt: z.string().datetime(),
});
export type AccountingJournalPostedV1 = z.infer<typeof accountingJournalPostedV1Schema>;

/**
 * Payload of `accounting.payment.received.v1` — emitted when an AR payment is
 * recorded and allocated to one or more invoices (ACC-9).
 */
export const accountingPaymentReceivedV1Schema = z.object({
  organizationId: z.string().uuid(),
  paymentId: z.string().uuid(),
  method: z.enum(['cash', 'bank_transfer', 'card', 'cheque', 'other']),
  amountMinor: minorUnitsString,
  currency: currencyCode,
  /** Number of invoices this payment was allocated across. */
  allocationCount: z.number().int().positive(),
  receivedAt: z.string().datetime(),
  occurredAt: z.string().datetime(),
});
export type AccountingPaymentReceivedV1 = z.infer<typeof accountingPaymentReceivedV1Schema>;
