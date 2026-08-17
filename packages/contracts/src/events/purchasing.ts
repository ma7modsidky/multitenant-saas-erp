// Purchasing & Suppliers event payload schemas (co-declared in Phase 7)
//
// @see PLAN.md §7.1.4 — Accounting declares the Phase 8 purchasing events it
//      will consume, so both consumers and producers agree on the payloads now.
// @see PLAN.md §8.1 — Declare contracts first (Purchasing phase)
// @see DATA_MODEL.md §11 — Purchasing schema (`pur_`)
// @see BUSINESS_RULES.md §14 — Purchasing and suppliers rules (PUR-*)
//
// Accounting consumes these to post AP journal entries idempotently (ACC-15).
// The purchasing MODULE does not exist until Phase 8; these schemas are the
// contract surface Accounting's handlers are written against in Phase 7.
import { z } from 'zod';

// Import the primitives directly (not via ./index.js) so the module never
// participates in an import cycle with its own barrel (depcruise no-circular).
import { currencyCode, decimalString, minorUnitsString, signedMinorUnitsString } from './primitives.js';

/** Stable Purchasing event names (co-declared; consumed by Accounting). */
export const PURCHASING_EVENTS = {
  SUPPLIER_CREATED_V1: 'purchasing.supplier.created.v1',
  PO_APPROVED_V1: 'purchasing.po.approved.v1',
  GRN_RECEIVED_V1: 'purchasing.grn.received.v1',
  BILL_APPROVED_V1: 'purchasing.bill.approved.v1',
  PAYMENT_RECORDED_V1: 'purchasing.payment.recorded.v1',
  SUPPLIER_RETURN_APPROVED_V1: 'purchasing.supplier_return.approved.v1',
} as const;

/** The money block every purchasing document carries (single currency). */
const purchasingMoney = {
  subtotalAmountMinor: minorUnitsString,
  discountAmountMinor: minorUnitsString,
  taxAmountMinor: minorUnitsString,
  totalAmountMinor: minorUnitsString,
  currency: currencyCode,
};

/**
 * Payload of `purchasing.bill.approved.v1` — emitted when a purchase bill is
 * approved (PUR-6). Accounting posts the AP journal entry (Dr Inventory/
 * Expense, Cr AP, Cr VAT) idempotently, keyed on `billId` (ACC-15).
 */
export const purchasingBillApprovedV1Schema = z.object({
  organizationId: z.string().uuid(),
  billId: z.string().uuid(),
  billNumber: z.string().min(1),
  supplierId: z.string().uuid(),
  ...purchasingMoney,
  /** FX snapshot when the bill currency differs from the org base currency. */
  exchangeRate: decimalString.optional(),
  baseTotalAmountMinor: minorUnitsString.optional(),
  billDate: z.string().datetime(),
  dueDate: z.string().datetime(),
  approvedAt: z.string().datetime(),
  occurredAt: z.string().datetime(),
});
export type PurchasingBillApprovedV1 = z.infer<typeof purchasingBillApprovedV1Schema>;

/**
 * Payload of `purchasing.payment.recorded.v1` — emitted when a supplier
 * payment is recorded (PUR-7). Accounting posts Dr AP / Cr Bank idempotently,
 * keyed on `paymentId` (ACC-15).
 */
export const purchasingPaymentRecordedV1Schema = z.object({
  organizationId: z.string().uuid(),
  paymentId: z.string().uuid(),
  paymentNumber: z.string().min(1),
  supplierId: z.string().uuid(),
  method: z.enum(['cash', 'bank_transfer', 'card', 'cheque', 'other']),
  amountMinor: minorUnitsString,
  currency: currencyCode,
  /** Number of bills this payment was allocated across. */
  allocationCount: z.number().int().positive(),
  paidAt: z.string().datetime(),
  occurredAt: z.string().datetime(),
});
export type PurchasingPaymentRecordedV1 = z.infer<typeof purchasingPaymentRecordedV1Schema>;

/**
 * Payload of `purchasing.supplier_return.approved.v1` — emitted when a
 * supplier return / debit note is approved (PUR-11). Accounting posts the
 * reversal (Cr Inventory, Dr AP) idempotently, keyed on `returnId` (ACC-15).
 */
export const purchasingSupplierReturnApprovedV1Schema = z.object({
  organizationId: z.string().uuid(),
  returnId: z.string().uuid(),
  returnNumber: z.string().min(1),
  supplierId: z.string().uuid(),
  /** The bill the return reduces (plain id, no FK). */
  billId: z.string().uuid().nullable().optional(),
  reasonCode: z.string().min(1),
  /**
   * Signed total value: a supplier return reduces AP, so the amount is
   * negative in the AP direction — carried as a signed minor-units string
   * (PUR-2: bills +, payments −, debit notes −).
   */
  amountMinor: signedMinorUnitsString,
  currency: currencyCode,
  returnedAt: z.string().datetime(),
  occurredAt: z.string().datetime(),
});
export type PurchasingSupplierReturnApprovedV1 = z.infer<typeof purchasingSupplierReturnApprovedV1Schema>;
