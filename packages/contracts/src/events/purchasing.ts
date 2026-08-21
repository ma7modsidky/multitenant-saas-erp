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
 * Payload of `purchasing.supplier.created.v1` — emitted when a supplier is
 * created (PUR-1). No consumer today (declared for the Phase 8 public
 * contract); the directory is the supplier master.
 */
export const purchasingSupplierCreatedV1Schema = z.object({
  organizationId: z.string().uuid(),
  supplierId: z.string().uuid(),
  supplierName: z.string().min(1),
  taxId: z.string().nullable().optional(),
  currency: currencyCode,
  occurredAt: z.string().datetime(),
});
export type PurchasingSupplierCreatedV1 = z.infer<typeof purchasingSupplierCreatedV1Schema>;

/**
 * Payload of `purchasing.po.approved.v1` — emitted when a purchase order is
 * approved (PUR-3). No consumer today (declared for the Phase 8 public
 * contract).
 */
export const purchasingPoApprovedV1Schema = z.object({
  organizationId: z.string().uuid(),
  poId: z.string().uuid(),
  poNumber: z.string().min(1),
  supplierId: z.string().uuid(),
  totalAmountMinor: minorUnitsString,
  currency: currencyCode,
  approvedAt: z.string().datetime(),
  occurredAt: z.string().datetime(),
});
export type PurchasingPoApprovedV1 = z.infer<typeof purchasingPoApprovedV1Schema>;

/**
 * Payload of `purchasing.grn.received.v1` — emitted when goods are received
 * (PUR-4/PUR-5). No consumer today (declared for the Phase 8 public
 * contract); the GRN's stock effect travels as its own
 * `inventory.stock.movement_recorded.v1` events.
 */
export const purchasingGrnReceivedV1Schema = z.object({
  organizationId: z.string().uuid(),
  grnId: z.string().uuid(),
  grnNumber: z.string().min(1),
  poId: z.string().uuid(),
  supplierId: z.string().uuid(),
  /** Inventory warehouse id — plain id, no FK. Null = org default warehouse. */
  warehouseId: z.string().uuid().nullable().optional(),
  lineCount: z.number().int().positive(),
  receivedAt: z.string().datetime(),
  occurredAt: z.string().datetime(),
});
export type PurchasingGrnReceivedV1 = z.infer<typeof purchasingGrnReceivedV1Schema>;

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
  /**
   * Per-line detail so accounting splits Dr Inventory (goods, variantId set)
   * vs Dr Expense (service lines) exactly (ACC-15).
   */
  lines: z
    .array(
      z.object({
        variantId: z.string().uuid().nullable().optional(),
        quantity: decimalString,
        unitCostAmountMinor: minorUnitsString,
        taxRateBpSnapshot: z.number().int().min(0),
      }),
    )
    .min(1),
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
   * (PUR-2: bills +, payments −, debit notes −). This is the NET value.
   */
  amountMinor: signedMinorUnitsString,
  /** ACC-11: return tax (Σ line taxes). Absent on pre-tax events → treat as 0. */
  taxMinor: minorUnitsString.optional(),
  /** ACC-11: signed gross AP reduction = amountMinor + taxMinor. Absent on pre-tax events. */
  totalMinor: signedMinorUnitsString.optional(),
  /** ACC-11: supplier tax id snapshot from the source bill. */
  supplierTaxIdSnapshot: z.string().nullable().optional(),
  currency: currencyCode,
  /**
   * Per-line detail so accounting credits Inventory (goods) vs Expense
   * (service) on the reversal leg (ACC-15).
   */
  lines: z
    .array(
      z.object({
        variantId: z.string().uuid().nullable().optional(),
        quantity: decimalString,
        unitCostAmountMinor: minorUnitsString,
        /** ACC-11: tax-rate snapshot inherited from the bill line. */
        taxRateBpSnapshot: z.number().int().min(0).optional(),
        /** ACC-11: per-line tax, minor units. */
        taxAmountMinor: minorUnitsString.optional(),
      }),
    )
    .min(1),
  returnedAt: z.string().datetime(),
  occurredAt: z.string().datetime(),
});
export type PurchasingSupplierReturnApprovedV1 = z.infer<typeof purchasingSupplierReturnApprovedV1Schema>;
