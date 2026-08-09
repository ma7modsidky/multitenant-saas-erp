import { DomainError } from '../../../core/common/errors.js';

/**
 * Stable, machine-readable error codes for the POS module.
 *
 * Every code maps to a BUSINESS_RULES.md §7 rule id and is surfaced by the API
 * as an error code (CODING_STANDARDS.md §7 — API returns codes, not sentences).
 */
export const POS_ERROR_CODE = {
  /** A register id does not exist in the org (or is soft-deleted). */
  REGISTER_NOT_FOUND: 'POS_REGISTER_NOT_FOUND',
  /** Register codes are unique per org among non-deleted registers. */
  REGISTER_DUPLICATE_CODE: 'POS_REGISTER_DUPLICATE_CODE',
  /** Selling from a deactivated register is rejected. */
  REGISTER_INACTIVE: 'POS_REGISTER_INACTIVE',
  /** POS-2 — opening a shift while one is already open on the register. */
  SHIFT_ALREADY_OPEN: 'POS_SHIFT_ALREADY_OPEN',
  /** POS-6 — a closed shift is immutable. */
  SHIFT_CLOSED_IMMUTABLE: 'POS_SHIFT_CLOSED_IMMUTABLE',
  /** POS-7 — closing while unsynced offline sales remain requires a force-close. */
  SHIFT_HAS_UNSYNCED_SALES: 'POS_SHIFT_HAS_UNSYNCED_SALES',
  /** POS-3 — selling requires an open shift on the register. */
  NO_OPEN_SHIFT: 'POS_NO_OPEN_SHIFT',
  /** POS-23 — a refund requires an open shift on the register. */
  REFUND_REQUIRES_OPEN_SHIFT: 'POS_REFUND_REQUIRES_OPEN_SHIFT',
  /** POS-10 — sum of payments must equal the sale total. */
  PAYMENTS_DO_NOT_EQUAL_TOTAL: 'POS_PAYMENTS_DO_NOT_EQUAL_TOTAL',
  /** POS-11 — all lines and payments share the register's currency. */
  CURRENCY_MISMATCH: 'POS_CURRENCY_MISMATCH',
  /** POS-16 — a discount cannot make a line or sale total negative. */
  DISCOUNT_EXCEEDS_SUBTOTAL: 'POS_DISCOUNT_EXCEEDS_SUBTOTAL',
  /** A sale id does not exist in the org. */
  SALE_NOT_FOUND: 'POS_SALE_NOT_FOUND',
  /** POS-13 — a completed (or already corrected) sale cannot be edited. */
  SALE_IMMUTABLE: 'POS_SALE_IMMUTABLE',
  /** POS-14 — void only in the same open shift and with no captured payment. */
  SALE_NOT_VOIDABLE: 'POS_SALE_NOT_VOIDABLE',
  /** POS-20 — a refund must reference a completed sale in the same org. */
  REFUND_SALE_NOT_REFUNDABLE: 'POS_REFUND_SALE_NOT_REFUNDABLE',
  /** POS-21 — cumulative refunds can never exceed the original sale. */
  REFUND_EXCEEDS_SALE: 'POS_REFUND_EXCEEDS_SALE',
  /** POS-23 — a refund requires a reason code. */
  REFUND_REQUIRES_REASON: 'POS_REFUND_REQUIRES_REASON',
  /** A sale line / refund line is missing or not part of the original sale. */
  REFUND_LINE_INVALID: 'POS_REFUND_LINE_INVALID',
} as const;

export type PosErrorCode = (typeof POS_ERROR_CODE)[keyof typeof POS_ERROR_CODE];

/**
 * PosError — a POS business-rule violation (422).
 *
 * Extends the shared DomainError so the global exception filter maps it to the
 * standard error response (ERR-1).
 */
export class PosError extends DomainError {
  constructor(code: PosErrorCode, message: string, params?: Record<string, unknown>) {
    super(code, message, { ...params, code });
    this.name = 'PosError';
  }
}
