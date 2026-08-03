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

// ─── Shared primitives ──────────────────────────────────────────────────────
//
// Money is always integer minor units (DATA_MODEL §5 M1). In a JSON event
// payload a bigint would lose precision, so amounts travel as decimal strings —
// the same representation `Money` uses when JSON-serialized
// (packages/money/src/money.ts).

/** Integer minor units as a decimal string (e.g. "250000" = 2500.00). */
export const minorUnitsString = z.string().regex(/^\d+$/, 'minor units must be a non-negative integer string');

/** ISO 4217 currency code, uppercase 3 letters. */
export const currencyCode = z.string().regex(/^[A-Z]{3}$/, 'currency must be an uppercase ISO 4217 code');

/**
 * Fixed-point decimal as a string (e.g. "3.6725") — the JSON-safe form of a
 * `numeric(20,10)` column. Never a JS float, never scientific notation.
 */
export const decimalString = z
  .string()
  .regex(/^\d+(\.\d+)?$/, 'decimal must be a plain decimal string (no floats, no exponents)');

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
  ownerUserId: z.string().uuid(),
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
 * `fromStageId` is null only for the first move (deal created directly in a stage).
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
  ownerUserId: z.string().uuid(),
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
  ownerUserId: z.string().uuid(),
  occurredAt: z.string().datetime(),
});
export type CrmDealLostV1 = z.infer<typeof crmDealLostV1Schema>;
