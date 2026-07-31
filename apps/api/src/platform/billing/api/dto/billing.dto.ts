import { z } from 'zod';

export const createSubscriptionSchema = z.object({
  organizationName: z.string().min(1).max(255),
  email: z.string().email(),
  billingCurrency: z.string().length(3),
  priceKeys: z.array(z.string()).optional().default([]),
}).strict();

export type CreateSubscriptionDto = z.infer<typeof createSubscriptionSchema>;

export const enableModuleTrialSchema = z.object({
  moduleKey: z.string().min(1),
  skipTrial: z.boolean().optional().default(false),
}).strict();

export type EnableModuleTrialDto = z.infer<typeof enableModuleTrialSchema>;

export const disableModuleSchema = z.object({
  moduleKey: z.string().min(1),
}).strict();

export type DisableModuleDto = z.infer<typeof disableModuleSchema>;

export interface BillingResponse {
  subscription: {
    id: string;
    stripeCustomerId: string;
    status: string;
    billingCurrency: string;
    currentPeriodEnd: string | null;
  } | null;
  entitlements: Array<{
    moduleKey: string;
    state: string;
    trialEndsAt: string | null;
    activatedAt: string | null;
  }>;
}
