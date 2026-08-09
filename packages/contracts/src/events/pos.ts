// POS event payload schemas
//
// @see PLAN.md §6.1 — Declare contracts first
// @see DATA_MODEL.md §9 — POS schema (`pos_`)
// @see BUSINESS_RULES.md §7 — POS rules
//
// Every payload carries `organizationId` (the payload is the event's source of
// truth for tenant context — handlers run without the publishing tenant
// context) and `occurredAt` (ISO 8601) per MODULE_GUIDE.md Step 1.
import { z } from 'zod';

// Import the primitives directly (not via ./index.js) so the module never
// participates in an import cycle with its own barrel (depcruise no-circular).
import { currencyCode, decimalString, minorUnitsString, signedMinorUnitsString } from './primitives.js';

/** Stable POS event names. Consumed by the module descriptor (`publishes`). */
export const POS_EVENTS = {
  SALE_COMPLETED_V1: 'pos.sale.completed.v1',
  SALE_REFUNDED_V1: 'pos.sale.refunded.v1',
  SHIFT_OPENED_V1: 'pos.shift.opened.v1',
  SHIFT_CLOSED_V1: 'pos.shift.closed.v1',
} as const;

/** The money block every completed sale carries (all in one currency — POS-11). */
const saleMoney = {
  subtotalAmountMinor: minorUnitsString,
  discountAmountMinor: minorUnitsString,
  taxAmountMinor: minorUnitsString,
  totalAmountMinor: minorUnitsString,
  currency: currencyCode,
};

/**
 * Payload of `pos.sale.completed.v1` — emitted after a sale is persisted with
 * its stock effect (POS-15).
 */
export const posSaleCompletedV1Schema = z.object({
  organizationId: z.string().uuid(),
  saleId: z.string().uuid(),
  shiftId: z.string().uuid(),
  registerId: z.string().uuid(),
  /**
   * Authoritative, gap-free receipt number (POS-9). Offline sales receive the
   * server-assigned number at sync time (POS-27).
   */
  receiptNumber: z.string().min(1),
  ...saleMoney,
  // A completed sale has at least one line (POS-10: payments equal the total).
  lineCount: z.number().int().positive(),
  // FX snapshot when the sale currency differs from the org base currency
  // (DATA_MODEL §5 — conversion stored at write time).
  exchangeRate: decimalString.optional(),
  baseTotalAmountMinor: minorUnitsString.optional(),
  // Optional CRM contact link — plain id, no FK (POS-18). Null when the sale
  // was not linked to a contact.
  customerContactId: z.string().uuid().nullable().optional(),
  // POS-19: the locale the sale was completed in, so the receipt can be
  // regenerated identically later.
  locale: z.string().min(1),
  soldAt: z.string().datetime(),
  occurredAt: z.string().datetime(),
});
export type PosSaleCompletedV1 = z.infer<typeof posSaleCompletedV1Schema>;

/**
 * Payload of `pos.sale.refunded.v1` — emitted after a refund is persisted and
 * its stock effect applied (POS-20 → POS-24). Covers both full and partial
 * refunds; `refundedAmountMinor` is the amount of THIS refund, not cumulative.
 */
export const posSaleRefundedV1Schema = z.object({
  organizationId: z.string().uuid(),
  refundId: z.string().uuid(),
  originalSaleId: z.string().uuid(),
  shiftId: z.string().uuid(),
  registerId: z.string().uuid(),
  refundedAmountMinor: minorUnitsString,
  currency: currencyCode,
  refundedAt: z.string().datetime(),
  occurredAt: z.string().datetime(),
});
export type PosSaleRefundedV1 = z.infer<typeof posSaleRefundedV1Schema>;

/**
 * Payload of `pos.shift.opened.v1` — emitted when a register shift is opened
 * (POS-4 records the opening float and operator).
 */
export const posShiftOpenedV1Schema = z.object({
  organizationId: z.string().uuid(),
  shiftId: z.string().uuid(),
  registerId: z.string().uuid(),
  openedBy: z.string().uuid(),
  openingFloatAmountMinor: minorUnitsString,
  currency: currencyCode,
  openedAt: z.string().datetime(),
  occurredAt: z.string().datetime(),
});
export type PosShiftOpenedV1 = z.infer<typeof posShiftOpenedV1Schema>;

/**
 * Payload of `pos.shift.closed.v1` — emitted when a shift is closed (POS-5
 * computes the cash variance and locks the shift).
 */
export const posShiftClosedV1Schema = z.object({
  organizationId: z.string().uuid(),
  shiftId: z.string().uuid(),
  registerId: z.string().uuid(),
  closedBy: z.string().uuid(),
  expectedCashAmountMinor: minorUnitsString,
  countedCashAmountMinor: minorUnitsString,
  /** POS-5: variance = counted − expected. Negative = shortage. */
  varianceAmountMinor: signedMinorUnitsString,
  currency: currencyCode,
  /**
   * POS-7: true when a MANAGER force-closed the shift despite unsynced
   * offline sales in the client outbox.
   */
  forcedClose: z.boolean().optional(),
  closedAt: z.string().datetime(),
  occurredAt: z.string().datetime(),
});
export type PosShiftClosedV1 = z.infer<typeof posShiftClosedV1Schema>;
