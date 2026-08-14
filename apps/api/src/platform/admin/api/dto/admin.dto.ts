import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// ─── Request bodies ─────────────────────────────────────────────────────────

/**
 * Enable a module for an org — PLT-8.
 * - `skipTrial`  — grant full access directly (no trial). The grant is FREE:
 *                  no Stripe item is created and the org is never billed
 *                  (BILL-14).
 * - `trialDays`  — optional admin-specified trial length (1–365), overrides
 *                  the catalog default when a trial is granted.
 * - `accessUntil` — optional ISO end date bounding a free full-access grant;
 *                  omitted = unlimited (PLT-8). Ignored for trial grants.
 */
export const adminEnableModuleSchema = z
  .object({
    skipTrial: z.boolean().optional().default(false),
    trialDays: z.number().int().min(1).max(365).optional(),
    accessUntil: z.string().datetime().optional(),
  })
  .strict();

export class AdminEnableModuleDto extends createZodDto(adminEnableModuleSchema) {}

/** Disable a module for an org — no body. */
export const adminDisableModuleSchema = z.object({}).strict();

export class AdminDisableModuleDto extends createZodDto(adminDisableModuleSchema) {}

/** Empty body for action-only endpoints (stop trial / suspend / activate). */
export const adminEmptyActionSchema = z.object({}).strict();

export class AdminEmptyActionDto extends createZodDto(adminEmptyActionSchema) {}

/** Extend a module's trial by N days (PLT-8). */
export const adminExtendTrialSchema = z
  .object({
    days: z.number().int().min(1).max(365),
  })
  .strict();

export class AdminExtendTrialDto extends createZodDto(adminExtendTrialSchema) {}

/** Update a module's list prices (integer minor units + ISO currency, PLT-6). */
export const adminUpdatePricingSchema = z
  .object({
    priceMonthlyMinor: z.string().regex(/^\d+$/, 'Must be non-negative integer minor units'),
    priceYearlyMinor: z.string().regex(/^\d+$/, 'Must be non-negative integer minor units'),
    currency: z.string().length(3).toUpperCase(),
  })
  .strict();

export class AdminUpdatePricingDto extends createZodDto(adminUpdatePricingSchema) {}

/** Update SaaS settings — keys are allow-listed in the use case (PLT-7). */
export const adminUpdateSettingsSchema = z.record(z.string(), z.unknown());

export class AdminUpdateSettingsDto extends createZodDto(adminUpdateSettingsSchema) {}

// ─── Response envelopes (match the `{ data }` wire format) ─────────────────

const messageEnvelopeSchema = z.object({ data: z.object({ message: z.string() }) });
export class AdminMessageEnvelopeResponse extends createZodDto(messageEnvelopeSchema) {}

const orgSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  status: z.string(),
  createdAt: z.string(),
  memberCount: z.number(),
  subscriptionStatus: z.string().nullable(),
  activeModuleCount: z.number(),
});

const organizationsEnvelopeSchema = z.object({
  data: z.object({
    items: z.array(orgSummarySchema),
    total: z.number(),
    page: z.number(),
    pageSize: z.number(),
  }),
});
export class AdminOrganizationsEnvelopeResponse extends createZodDto(organizationsEnvelopeSchema) {}

const orgDetailSchema = z.object({
  organization: z.object({
    id: z.string(),
    name: z.string(),
    slug: z.string(),
    status: z.string(),
    createdAt: z.string(),
  }),
  members: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      email: z.string(),
      roleId: z.string(),
    }),
  ),
  subscription: z
    .object({
      id: z.string(),
      status: z.string(),
      billingCurrency: z.string(),
      currentPeriodEnd: z.string().nullable(),
    })
    .nullable(),
  entitlements: z.array(
    z.object({
      moduleKey: z.string(),
      moduleName: z.string(),
      state: z.string(),
      trialStartedAt: z.string().nullable(),
      trialEndsAt: z.string().nullable(),
      activatedAt: z.string().nullable(),
      disabledAt: z.string().nullable(),
      /** End date of a free admin grant (PLT-8); null = unlimited grant. */
      accessUntil: z.string().nullable(),
      /** True when the module is on a paid Stripe subscription item (PLT-8). */
      isPaid: z.boolean(),
    }),
  ),
});

const orgDetailEnvelopeSchema = z.object({ data: orgDetailSchema });
export class AdminOrgDetailEnvelopeResponse extends createZodDto(orgDetailEnvelopeSchema) {}

const orgActivityEntrySchema = z.object({
  id: z.string(),
  action: z.string(),
  actorUserId: z.string().nullable(),
  actorEmail: z.string().nullable(),
  before: z.record(z.string(), z.unknown()).nullable(),
  after: z.record(z.string(), z.unknown()).nullable(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
  occurredAt: z.string(),
});

const orgActivityEnvelopeSchema = z.object({
  data: z.object({ items: z.array(orgActivityEntrySchema) }),
});
export class AdminOrgActivityEnvelopeResponse extends createZodDto(orgActivityEnvelopeSchema) {}

const overviewSchema = z.object({
  organizations: z.object({
    total: z.number(),
    active: z.number(),
    pendingDeletion: z.number(),
  }),
  totalUsers: z.number(),
  subscriptions: z.object({ active: z.number(), other: z.number() }),
  modulesEnabledByKey: z.record(z.string(), z.number()),
});

const overviewEnvelopeSchema = z.object({ data: overviewSchema });
export class AdminOverviewEnvelopeResponse extends createZodDto(overviewEnvelopeSchema) {}

const pricingRowSchema = z.object({
  moduleKey: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  icon: z.string().nullable(),
  dependsOn: z.array(z.string()),
  trialDays: z.number(),
  priceMonthlyMinor: z.string(),
  priceYearlyMinor: z.string(),
  currency: z.string(),
});

const modulesEnvelopeSchema = z.object({ data: z.array(pricingRowSchema) });
export class AdminModulesEnvelopeResponse extends createZodDto(modulesEnvelopeSchema) {}

const settingsEnvelopeSchema = z.object({
  data: z.record(z.string(), z.unknown()),
});
export class AdminSettingsEnvelopeResponse extends createZodDto(settingsEnvelopeSchema) {}
