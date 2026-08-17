// Event payload schemas
// Each module declares its event payload types here.
// Naming: `<Module><Aggregate><Action>V1` schema + inferred type.
//
// Events are named `<module>.<aggregate>.<pastTense>.v<major>`.
//
// Example:
// ```typescript
// import { z } from 'zod';
//
// export const inventoryStockDepletedV1Schema = z.object({
//   variantId: z.string().uuid(),
//   warehouseId: z.string().uuid(),
//   quantityOnHand: z.string(),
//   reorderPoint: z.string(),
// });
// export type InventoryStockDepletedV1 = z.infer<typeof inventoryStockDepletedV1Schema>;
// ```
//
// Every payload carries `organizationId` (the payload is the event's source of
// truth for tenant context — handlers run without the publishing tenant context)
// and `occurredAt` (ISO 8601) per MODULE_GUIDE.md Step 1.
import { z } from 'zod';

import { minorUnitsString, currencyCode, decimalString } from './primitives.js';

// ─── Shared primitives (re-exported for back-compat; defined in primitives.ts) ─
export {
  minorUnitsString,
  signedMinorUnitsString,
  currencyCode,
  decimalString,
  signedDecimalString,
} from './primitives.js';

// ─── CRM events ─────────────────────────────────────────────────────────────
//
// @see PLAN.md §4.1 — Declare contracts first
// @see DATA_MODEL.md §7 — CRM schema (`crm_`)
// @see BUSINESS_RULES.md §9 — CRM rules

/** Stable CRM event names. Consumed by the module descriptor (`publishes`). */
export const CRM_EVENTS = {
  CONTACT_CREATED_V1: 'crm.contact.created.v1',
  CONTACT_UPDATED_V1: 'crm.contact.updated.v1',
  DEAL_STAGE_CHANGED_V1: 'crm.deal.stage_changed.v1',
  DEAL_WON_V1: 'crm.deal.won.v1',
  DEAL_LOST_V1: 'crm.deal.lost.v1',
} as const;

// A contact requires at least one of email or phone (BUSINESS_RULES CRM-1).
// Events are projections of already-validated aggregates, but encoding the
// invariant here keeps the contract self-validating for any consumer.
const contactIdentity = {
  organizationId: z.string().uuid(),
  contactId: z.string().uuid(),
  companyId: z.string().uuid().nullable(),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email().nullable(),
  phone: z.string().nullable(),
  // Optional for backward compatibility with events published before the
  // field existed — absent in old payloads, null/string in new ones.
  secondaryPhone: z.string().nullable().optional(),
  ownerUserId: z.string().uuid().nullable(),
  occurredAt: z.string().datetime(),
};

/** Payload of `crm.contact.created.v1` — emitted when a contact is created. */
export const crmContactCreatedV1Schema = z
  .object(contactIdentity)
  .refine((c) => c.email !== null || c.phone !== null, 'CRM-1: a contact requires at least one of email or phone');
export type CrmContactCreatedV1 = z.infer<typeof crmContactCreatedV1Schema>;

/** Payload of `crm.contact.updated.v1` — emitted when a contact is updated. */
export const crmContactUpdatedV1Schema = z
  .object(contactIdentity)
  .refine((c) => c.email !== null || c.phone !== null, 'CRM-1: a contact requires at least one of email or phone');
export type CrmContactUpdatedV1 = z.infer<typeof crmContactUpdatedV1Schema>;

/**
 * Payload of `crm.deal.stage_changed.v1` — emitted on every deal stage move.
 * `fromStageId` is nullable for import/backfill producers; normal CRM moves
 * carry the persisted current stage.
 *
 * @see BUSINESS_RULES.md CRM-6 — every stage change appends to `crm_deal_stage_history`
 */
export const crmDealStageChangedV1Schema = z.object({
  organizationId: z.string().uuid(),
  dealId: z.string().uuid(),
  fromStageId: z.string().uuid().nullable(),
  toStageId: z.string().uuid(),
  movedBy: z.string().uuid(),
  occurredAt: z.string().datetime(),
});
export type CrmDealStageChangedV1 = z.infer<typeof crmDealStageChangedV1Schema>;

/**
 * Payload of `crm.deal.won.v1` — emitted when a deal is closed as won.
 * Carries the final deal value plus the FX snapshot used at write time so
 * consumers can compute base-currency totals without re-querying (CRM-8:
 * "pipeline totals are reported in the base currency").
 *
 * @see BUSINESS_RULES.md CRM-8 — deal value carries its own currency + FX snapshot
 * @see BUSINESS_RULES.md CRM-9 — closing sets `closed_at` and `status`
 * @see DATA_MODEL.md §5 — Money (exchange_rate, base_amount_minor)
 */
export const crmDealWonV1Schema = z.object({
  organizationId: z.string().uuid(),
  dealId: z.string().uuid(),
  valueAmountMinor: minorUnitsString,
  valueCurrency: currencyCode,
  // Present only when valueCurrency differs from the org base currency
  // (DATA_MODEL §5 — conversion stored at write time).
  exchangeRate: decimalString.optional(),
  baseAmountMinor: minorUnitsString.optional(),
  closedAt: z.string().datetime(),
  ownerUserId: z.string().uuid().nullable(),
  occurredAt: z.string().datetime(),
});
export type CrmDealWonV1 = z.infer<typeof crmDealWonV1Schema>;

/**
 * Payload of `crm.deal.lost.v1` — emitted when a deal is closed as lost.
 *
 * @see BUSINESS_RULES.md CRM-7 — moving to a lost stage requires a `lost_reason_code`
 */
export const crmDealLostV1Schema = z.object({
  organizationId: z.string().uuid(),
  dealId: z.string().uuid(),
  lostReasonCode: z.string().min(1),
  closedAt: z.string().datetime(),
  ownerUserId: z.string().uuid().nullable(),
  occurredAt: z.string().datetime(),
});
export type CrmDealLostV1 = z.infer<typeof crmDealLostV1Schema>;

// ─── Inventory events ───────────────────────────────────────────────────────
//
// @see PLAN.md §5.1 — Declare contracts first
// @see DATA_MODEL.md §8 — Inventory schema (`inv_`)
// @see BUSINESS_RULES.md §8 — Inventory rules

export {
  INVENTORY_EVENTS,
  STOCK_MOVEMENT_TYPES,
  inventoryProductCreatedV1Schema,
  inventoryProductArchivedV1Schema,
  inventoryProductRestoredV1Schema,
  inventoryStockLevelChangedV1Schema,
  inventoryStockDepletedV1Schema,
  inventoryReorderPointReachedV1Schema,
  inventoryStockMovementRecordedV1Schema,
} from './inventory.js';
export type {
  InventoryProductCreatedV1,
  InventoryProductArchivedV1,
  InventoryProductRestoredV1,
  InventoryStockLevelChangedV1,
  InventoryStockDepletedV1,
  InventoryReorderPointReachedV1,
  InventoryStockMovementRecordedV1,
} from './inventory.js';

// ─── POS events ─────────────────────────────────────────────────────────────
//
// @see PLAN.md §6.1 — Declare contracts first
// @see DATA_MODEL.md §9 — POS schema (`pos_`)
// @see BUSINESS_RULES.md §7 — POS rules

export {
  POS_EVENTS,
  posSaleCompletedV1Schema,
  posSaleRefundedV1Schema,
  posShiftOpenedV1Schema,
  posShiftClosedV1Schema,
} from './pos.js';
export type { PosSaleCompletedV1, PosSaleRefundedV1, PosShiftOpenedV1, PosShiftClosedV1 } from './pos.js';

// ─── Accounting events ───────────────────────────────────────────────────────
//
// @see PLAN.md §7.1 — Declare contracts first
// @see DATA_MODEL.md §10 — Accounting schema (`acc_`)
// @see BUSINESS_RULES.md §13 — Accounting and invoicing rules (ACC-*)

export {
  ACCOUNTING_EVENTS,
  accountingInvoiceIssuedV1Schema,
  accountingInvoicePaidV1Schema,
  accountingCreditNoteIssuedV1Schema,
  accountingJournalPostedV1Schema,
  accountingPaymentReceivedV1Schema,
} from './accounting.js';
export type {
  AccountingInvoiceIssuedV1,
  AccountingInvoicePaidV1,
  AccountingCreditNoteIssuedV1,
  AccountingJournalPostedV1,
  AccountingPaymentReceivedV1,
} from './accounting.js';

// ─── Purchasing events (co-declared in Phase 7 for Accounting's handlers) ───
//
// @see PLAN.md §7.1.4 — Accounting co-declares the Phase 8 purchasing events
// @see BUSINESS_RULES.md §14 — Purchasing and suppliers rules (PUR-*)

export {
  PURCHASING_EVENTS,
  purchasingBillApprovedV1Schema,
  purchasingPaymentRecordedV1Schema,
  purchasingSupplierReturnApprovedV1Schema,
} from './purchasing.js';
export type {
  PurchasingBillApprovedV1,
  PurchasingPaymentRecordedV1,
  PurchasingSupplierReturnApprovedV1,
} from './purchasing.js';
