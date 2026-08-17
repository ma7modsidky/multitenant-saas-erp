import { DomainError } from '../../../core/common/errors.js';

/**
 * Domain error for the accounting module.
 * Codes are stable machine-readable strings surfaced by the API as error codes
 * (never user-facing text — the frontend renders i18n keys from them).
 *
 * Extends the shared DomainError (422) so the global exception filter maps a
 * violated invariant to a 4xx with its stable code — not a 500 (ERR-1/ERR-6,
 * same pattern as InventoryError and PosError).
 */
export class AccountingDomainError extends DomainError {
  constructor(code: string, message: string, params?: Record<string, unknown>) {
    super(code, message, params);
    this.name = 'AccountingDomainError';
  }
}

/** Stable, machine-readable accounting error codes (BUSINESS_RULES §13). */
export const ACCOUNTING_ERROR_CODE = {
  /** ACC-1 — debits do not equal credits. */
  ENTRY_UNBALANCED: 'ACCOUNTING_ENTRY_UNBALANCED',
  /** ACC-6 — an invoice requires a customer (name snapshot; CRM ids optional). */
  INVOICE_CUSTOMER_REQUIRED: 'ACCOUNTING_INVOICE_CUSTOMER_REQUIRED',
  /** ACC-2 — a posted entry can only be reversed, never edited. */
  ENTRY_IMMUTABLE: 'ACCOUNTING_ENTRY_IMMUTABLE',
  /** ACC-3 — a failed post must not consume an entry number (gap-free). */
  ENTRY_NUMBER_GAP: 'ACCOUNTING_ENTRY_NUMBER_GAP',
  /** ACC-4 — a line with both debit and credit, a zero amount, or a mixed currency. */
  LINE_INVALID: 'ACCOUNTING_LINE_INVALID',
  /** ACC-5 — system accounts cannot be deleted or renumbered. */
  SYSTEM_ACCOUNT_IMMUTABLE: 'ACCOUNTING_SYSTEM_ACCOUNT_IMMUTABLE',
  /** ACC-5/ACC-16 — the COA is read-only when the advanced_coa feature is off. */
  COA_READ_ONLY: 'ACCOUNTING_COA_READ_ONLY',
  /** ACC-5/ACC-16 — a custom account code already exists in the org's chart. */
  ACCOUNT_CODE_EXISTS: 'ACCOUNTING_ACCOUNT_CODE_EXISTS',
  /** ACC-5 — an account name cannot be empty (update path). */
  ACCOUNT_NAME_REQUIRED: 'ACCOUNTING_ACCOUNT_NAME_REQUIRED',
  /** ACC-5 — a required system account is missing from the seeded chart. */
  COA_INCOMPLETE: 'ACCOUNTING_COA_INCOMPLETE',
  /** ACC-6 — an invoice may only be issued from Draft. */
  INVOICE_NOT_DRAFT: 'ACCOUNTING_INVOICE_NOT_DRAFT',
  /** ACC-7 — an issued invoice is immutable; corrections are credit notes. */
  INVOICE_IMMUTABLE: 'ACCOUNTING_INVOICE_IMMUTABLE',
  /** ACC-8 — an illegal invoice status transition. */
  INVOICE_ILLEGAL_TRANSITION: 'ACCOUNTING_INVOICE_ILLEGAL_TRANSITION',
  /** ACC-9 — payment allocations exceed the invoice total. */
  PAYMENT_OVER_ALLOCATED: 'ACCOUNTING_PAYMENT_OVER_ALLOCATED',
  /** ACC-10 — cumulative credit notes exceed the invoice net total. */
  CREDIT_NOTE_EXCEEDS_INVOICE: 'ACCOUNTING_CREDIT_NOTE_EXCEEDS_INVOICE',
  /** ACC-11 — line tax does not match the sum of line taxes / rate snapshot. */
  TAX_MISMATCH: 'ACCOUNTING_TAX_MISMATCH',
  /** ACC-13 — an invoice already exists for the source (idempotency). */
  DUPLICATE_SOURCE: 'ACCOUNTING_DUPLICATE_SOURCE',
  /** ACC-14 — goods lines require inventory entitlement. */
  GOODS_REQUIRES_INVENTORY: 'ACCOUNTING_GOODS_REQUIRES_INVENTORY',
  /** ACC-14 — the stock operation failed; issuance fails with it. */
  STOCK_ISSUE_FAILED: 'ACCOUNTING_STOCK_ISSUE_FAILED',
  /** ACC-15 — a replayed source event was already posted (idempotency no-op). */
  SOURCE_ALREADY_POSTED: 'ACCOUNTING_SOURCE_ALREADY_POSTED',
  /** ACC-12 — compliance adapter missing for the configured provider. */
  E_INVOICE_PROVIDER_UNAVAILABLE: 'ACCOUNTING_E_INVOICE_PROVIDER_UNAVAILABLE',
  /** ACC-16 — the required plan-gated feature is not enabled. */
  FEATURE_NOT_ENABLED: 'ACCOUNTING_FEATURE_NOT_ENABLED',
} as const;

export type AccountingErrorCode = (typeof ACCOUNTING_ERROR_CODE)[keyof typeof ACCOUNTING_ERROR_CODE];
