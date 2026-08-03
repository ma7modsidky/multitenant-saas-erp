import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// ─── Shared primitives ──────────────────────────────────────────────────────
//
// Money always travels as integer minor units + ISO 4217 currency (DATA_MODEL
// §5 M1) — never floats (hard rule #3).

/** Non-negative integer minor units as a decimal string (e.g. "250000"). */
const amountMinorString = z.string().regex(/^\d+$/, 'amountMinor must be a non-negative integer string');

/** Uppercase ISO 4217 currency code. */
const currencyCode = z.string().regex(/^[A-Z]{3}$/, 'currency must be an uppercase ISO 4217 code');

// ─── Contacts ───────────────────────────────────────────────────────────────

/**
 * Create-contact request. CRM-1: at least one of email or phone.
 * `.strict()` rejects unknown fields.
 */
export const createContactSchema = z
  .object({
    firstName: z.string().trim().min(1, 'First name is required').max(120),
    lastName: z.string().trim().min(1, 'Last name is required').max(120),
    email: z.string().email('Invalid email address').max(255).nullable().optional(),
    phone: z.string().trim().min(1).max(32).nullable().optional(),
    companyId: z.string().uuid('Company ID must be a valid UUID').nullable().optional(),
    ownerUserId: z.string().uuid('Owner user ID must be a valid UUID').nullable().optional(),
    preferredLocale: z.string().max(10).nullable().optional(),
    preferredCurrency: currencyCode.nullable().optional(),
  })
  .strict()
  .refine((c) => (c.email ?? null) !== null || (c.phone ?? null) !== null, {
    message: 'CRM-1: a contact requires at least one of email or phone',
    path: ['email'],
  });

/** Request DTO for creating a contact. */
export class CreateContactDto extends createZodDto(createContactSchema) {}

/**
 * Update-contact request. All fields optional (partial update); CRM-1 is
 * re-validated by the domain against the resulting identity.
 */
export const updateContactSchema = z
  .object({
    firstName: z.string().trim().min(1).max(120).optional(),
    lastName: z.string().trim().min(1).max(120).optional(),
    email: z.string().email('Invalid email address').max(255).nullable().optional(),
    phone: z.string().trim().min(1).max(32).nullable().optional(),
    companyId: z.string().uuid('Company ID must be a valid UUID').nullable().optional(),
    ownerUserId: z.string().uuid('Owner user ID must be a valid UUID').nullable().optional(),
    preferredLocale: z.string().max(10).nullable().optional(),
    preferredCurrency: currencyCode.nullable().optional(),
  })
  .strict();

/** Request DTO for updating a contact. */
export class UpdateContactDto extends createZodDto(updateContactSchema) {}

/**
 * Merge-contacts request (CRM-12). `sourceContactId` is merged AWAY into
 * `targetContactId`. Self-merge is rejected by the use case.
 */
export const mergeContactsSchema = z
  .object({
    sourceContactId: z.string().uuid('Source contact ID must be a valid UUID'),
    targetContactId: z.string().uuid('Target contact ID must be a valid UUID'),
  })
  .strict()
  .refine((m) => m.sourceContactId !== m.targetContactId, {
    message: 'Cannot merge a contact into itself',
    path: ['sourceContactId'],
  });

/** Request DTO for merging contacts. */
export class MergeContactsDto extends createZodDto(mergeContactsSchema) {}

// ─── Deals ──────────────────────────────────────────────────────────────────

/**
 * Create-deal request. CRM-10: a deal references a contact or a company.
 * `value` carries its own currency (CRM-8); the org base currency + FX rate
 * are resolved by the API layer from platform read ports.
 */
export const createDealSchema = z
  .object({
    title: z.string().trim().min(1, 'Title is required').max(200),
    contactId: z.string().uuid('Contact ID must be a valid UUID').nullable().optional(),
    companyId: z.string().uuid('Company ID must be a valid UUID').nullable().optional(),
    pipelineId: z.string().uuid('Pipeline ID must be a valid UUID').nullable().optional(),
    stageId: z.string().uuid('Stage ID must be a valid UUID').nullable().optional(),
    value: z
      .object({
        amountMinor: amountMinorString,
        currency: currencyCode,
      })
      .strict(),
    expectedCloseDate: z.string().datetime('expectedCloseDate must be an ISO 8601 datetime').nullable().optional(),
    ownerUserId: z.string().uuid('Owner user ID must be a valid UUID').nullable().optional(),
  })
  .strict()
  .refine((d) => (d.contactId ?? null) !== null || (d.companyId ?? null) !== null, {
    message: 'CRM-10: a deal must reference a contact or a company',
    path: ['contactId'],
  });

/** Request DTO for creating a deal. */
export class CreateDealDto extends createZodDto(createDealSchema) {}

/**
 * Move-stage request. CRM-7: `lostReasonCode` is required when the target
 * stage is lost (the domain enforces it — the DTO only carries the field).
 */
export const moveDealStageSchema = z
  .object({
    toStageId: z.string().uuid('Stage ID must be a valid UUID'),
    lostReasonCode: z.string().trim().min(1).max(64).nullable().optional(),
  })
  .strict();

/** Request DTO for moving a deal to another stage. */
export class MoveDealStageDto extends createZodDto(moveDealStageSchema) {}

/** Close-deal request — `outcome` decides the won/lost stage (CRM-7/9). */
export const closeDealSchema = z
  .object({
    outcome: z.enum(['won', 'lost']),
    lostReasonCode: z.string().trim().min(1).max(64).nullable().optional(),
  })
  .strict();

/** Request DTO for closing a deal. */
export class CloseDealDto extends createZodDto(closeDealSchema) {}

// ─── Activities ─────────────────────────────────────────────────────────────

/**
 * Create-activity request. CRM-13: type/subject; CRM-14: `assignedToUserId`
 * is validated by the domain against the org's active members (the API layer
 * resolves the active-member set via the membership read port).
 */
export const createActivitySchema = z
  .object({
    type: z.enum(['call', 'meeting', 'task', 'email']),
    subject: z.string().trim().min(1, 'Subject is required').max(200),
    dueAt: z.string().datetime('dueAt must be an ISO 8601 datetime').nullable().optional(),
    relatedType: z.enum(['contact', 'company', 'deal']).nullable().optional(),
    relatedId: z.string().uuid('relatedId must be a valid UUID').nullable().optional(),
    assignedToUserId: z.string().uuid('assignedToUserId must be a valid UUID').nullable().optional(),
  })
  .strict()
  .refine((a) => (a.relatedType ?? null) === null || (a.relatedId ?? null) !== null, {
    message: 'relatedType and relatedId must be set together or both left null',
    path: ['relatedType'],
  });

/** Request DTO for creating an activity. */
export class CreateActivityDto extends createZodDto(createActivitySchema) {}

// ─── Responses ──────────────────────────────────────────────────────────────

/** Contact response payload. */
export const contactResponseSchema = z.object({
  id: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  companyId: z.string().nullable(),
  ownerUserId: z.string().nullable(),
  preferredLocale: z.string().nullable(),
  preferredCurrency: z.string().nullable(),
});

export class ContactResponse extends createZodDto(contactResponseSchema) {}

/** Deal response payload — value carries minor units + currency (never floats). */
export const dealResponseSchema = z.object({
  id: z.string(),
  title: z.string(),
  pipelineId: z.string(),
  stageId: z.string(),
  contactId: z.string().nullable(),
  companyId: z.string().nullable(),
  value: z.object({
    amountMinor: z.string(),
    currency: z.string(),
  }),
  exchangeRate: z.number().nullable(),
  baseAmountMinor: z.string().nullable(),
  status: z.enum(['open', 'won', 'lost']),
  closedAt: z.string().nullable(),
  expectedCloseDate: z.string().nullable(),
  ownerUserId: z.string().nullable(),
});

export class DealResponse extends createZodDto(dealResponseSchema) {}

/** Activity response payload. */
export const activityResponseSchema = z.object({
  id: z.string(),
  type: z.enum(['call', 'meeting', 'task', 'email']),
  subject: z.string(),
  dueAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  relatedType: z.string().nullable(),
  relatedId: z.string().nullable(),
  assignedToUserId: z.string().nullable(),
});

export class ActivityResponse extends createZodDto(activityResponseSchema) {}

// ─── Response envelopes (match the `{ data }` wire format) ────────────────

/** `{ data: ContactResponse }` — create / update contact. */
export const contactEnvelopeSchema = z.object({ data: contactResponseSchema });
export class ContactEnvelopeResponse extends createZodDto(contactEnvelopeSchema) {}

/** `{ data: ContactResponse }` — merge contacts (surviving target). */
export const mergeEnvelopeSchema = z.object({ data: contactResponseSchema });
export class MergeEnvelopeResponse extends createZodDto(mergeEnvelopeSchema) {}

/** `{ data: DealResponse }` — create / move / close / reopen deal. */
export const dealEnvelopeSchema = z.object({ data: dealResponseSchema });
export class DealEnvelopeResponse extends createZodDto(dealEnvelopeSchema) {}

/** `{ data: ActivityResponse }` — create / complete activity. */
export const activityEnvelopeSchema = z.object({ data: activityResponseSchema });
export class ActivityEnvelopeResponse extends createZodDto(activityEnvelopeSchema) {}
