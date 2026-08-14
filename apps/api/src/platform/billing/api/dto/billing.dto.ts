import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const createSubscriptionSchema = z
  .object({
    organizationName: z.string().min(1).max(255),
    email: z.string().email(),
    billingCurrency: z.string().length(3),
    priceKeys: z.array(z.string()).optional().default([]),
  })
  .strict();

/**
 * Request DTO for creating a subscription.
 */
export class CreateSubscriptionDto extends createZodDto(createSubscriptionSchema) {}

export const enableModuleTrialSchema = z
  .object({
    moduleKey: z.string().min(1),
    skipTrial: z.boolean().optional().default(false),
  })
  .strict();

/**
 * Request DTO for enabling a module trial.
 */
export class EnableModuleTrialDto extends createZodDto(enableModuleTrialSchema) {}

export const disableModuleSchema = z
  .object({
    moduleKey: z.string().min(1),
  })
  .strict();

/**
 * Request DTO for disabling a module via billing.
 *
 * NOTE: named `BillingDisableModuleDto` (not `DisableModuleDto`) because the
 * class name becomes the OpenAPI `components.schemas` key — `platform/module-
 * registry` already exports `DisableModuleDto` with a different `maxLength`,
 * and a same-name collision would silently collapse one of the two schemas in
 * the generated OpenAPI document.
 */
export class BillingDisableModuleDto extends createZodDto(disableModuleSchema) {}

/**
 * Billing response payload.
 */
export const billingResponseSchema = z.object({
  subscription: z
    .object({
      id: z.string(),
      stripeCustomerId: z.string(),
      status: z.string(),
      billingCurrency: z.string(),
      currentPeriodEnd: z.string().nullable(),
    })
    .nullable(),
  entitlements: z.array(
    z.object({
      moduleKey: z.string(),
      state: z.string(),
      /** Permanent BILL-2 stamp — non-null means the free trial was already used. */
      trialStartedAt: z.string().nullable(),
      trialEndsAt: z.string().nullable(),
      activatedAt: z.string().nullable(),
      /** End date of a free admin grant (PLT-8); null = unlimited grant. */
      accessUntil: z.string().nullable(),
      /** True when the module is on a paid Stripe subscription item. */
      isPaid: z.boolean(),
    }),
  ),
});

/**
 * Billing response DTO.
 */
export class BillingResponse extends createZodDto(billingResponseSchema) {}

// ─── Response envelopes (match the `{ data }` wire format) ────────────────

/** `{ data: BillingResponse }` — get billing. */
export const billingEnvelopeSchema = z.object({
  data: billingResponseSchema,
});

export class BillingEnvelopeResponse extends createZodDto(billingEnvelopeSchema) {}

/** `{ data: { subscriptionId } }` — create subscription. */
export const subscriptionCreatedEnvelopeSchema = z.object({
  data: z.object({ subscriptionId: z.string() }),
});

export class SubscriptionCreatedEnvelopeResponse extends createZodDto(subscriptionCreatedEnvelopeSchema) {}

/** `{ data: { updated; alerts } }` — reconcile entitlements. */
export const reconcileEnvelopeSchema = z.object({
  data: z.object({
    updated: z.number(),
    alerts: z.array(z.string()),
  }),
});

export class ReconcileEnvelopeResponse extends createZodDto(reconcileEnvelopeSchema) {}

/** `{ received }` — Stripe webhook acknowledgement. */
export const webhookResponseSchema = z.object({
  received: z.boolean(),
});

export class WebhookResponse extends createZodDto(webhookResponseSchema) {}

/** `{ data: { message } }` — trial / disable. */
export const billingMessageEnvelopeSchema = z.object({
  data: z.object({ message: z.string() }),
});

export class BillingMessageEnvelopeResponse extends createZodDto(billingMessageEnvelopeSchema) {}
