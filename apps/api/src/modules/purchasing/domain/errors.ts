import { DomainError } from '../../../core/common/errors.js';

/**
 * Domain error for the purchasing module.
 * Codes are stable machine-readable strings surfaced by the API as error codes
 * (never user-facing text — the frontend renders i18n keys from them).
 *
 * Extends the shared DomainError (422) so the global exception filter maps a
 * violated invariant to a 4xx with its stable code — not a 500 (ERR-1/ERR-6,
 * same pattern as InventoryError / AccountingDomainError).
 */
export class PurchasingDomainError extends DomainError {
  constructor(code: string, message: string, params?: Record<string, unknown>) {
    super(code, message, params);
    this.name = 'PurchasingDomainError';
  }
}

/** Stable, machine-readable purchasing error codes (BUSINESS_RULES §14). */
export const PURCHASING_ERROR_CODE = {
  /** PUR-1 — a supplier requires a name. */
  SUPPLIER_NAME_REQUIRED: 'PURCHASING_SUPPLIER_NAME_REQUIRED',
  /** PUR-1 — the supplier tax id already exists in the org. */
  SUPPLIER_TAX_ID_EXISTS: 'PURCHASING_SUPPLIER_TAX_ID_EXISTS',
  /** PUR-3 — a PO with receipts cannot be cancelled. */
  PO_HAS_RECEIPTS: 'PURCHASING_PO_HAS_RECEIPTS',
  /** PUR-3 — an illegal PO status transition. */
  PO_ILLEGAL_TRANSITION: 'PURCHASING_PO_ILLEGAL_TRANSITION',
  /** PUR-4 — a GRN line exceeds the PO line remaining quantity. */
  GRN_EXCEEDS_PO: 'PURCHASING_GRN_EXCEEDS_PO',
  /** PUR-5 — a received GRN is immutable. */
  GRN_IMMUTABLE: 'PURCHASING_GRN_IMMUTABLE',
  /** PUR-6 — a bill requires a received GRN for goods lines. */
  BILL_MISSING_GRN: 'PURCHASING_BILL_MISSING_GRN',
  /** PUR-6 — an illegal bill status transition. */
  BILL_ILLEGAL_TRANSITION: 'PURCHASING_BILL_ILLEGAL_TRANSITION',
  /** PUR-7 — payment allocations exceed the bill total. */
  PAYMENT_OVER_ALLOCATED: 'PURCHASING_PAYMENT_OVER_ALLOCATED',
  /** PUR-11 — a supplier return requires a reason code. */
  RETURN_REASON_REQUIRED: 'PURCHASING_RETURN_REASON_REQUIRED',
  /** PUR-11 — a supplier return requires a bill or GRN reference. */
  RETURN_REFERENCE_REQUIRED: 'PURCHASING_RETURN_REFERENCE_REQUIRED',
  /** PUR-11 — a returned quantity cannot exceed the referenced bill line. */
  RETURN_EXCEEDS_BILL: 'PURCHASING_RETURN_EXCEEDS_BILL',
  /** PUR-12 — the approval chain requires an approver. */
  APPROVAL_REQUIRED: 'PURCHASING_APPROVAL_REQUIRED',
  /** PUR-12 — the approval feature is not enabled for this org. */
  APPROVAL_FEATURE_DISABLED: 'PURCHASING_APPROVAL_FEATURE_DISABLED',
  /** PUR-2 — vendor ledger entries are append-only. */
  LEDGER_APPEND_ONLY: 'PURCHASING_LEDGER_APPEND_ONLY',
  /** A referenced document was not found. */
  NOT_FOUND: 'PURCHASING_NOT_FOUND',
} as const;

export type PurchasingErrorCode = (typeof PURCHASING_ERROR_CODE)[keyof typeof PURCHASING_ERROR_CODE];
