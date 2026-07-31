import { Inject, Injectable } from '@nestjs/common';

import { BILLING_REPOSITORY, type BillingRepository } from '../ports/index.js';

@Injectable()
export class GetBillingUseCase {
  constructor(
    @Inject(BILLING_REPOSITORY)
    private readonly billingRepo: BillingRepository,
  ) {}

  async execute(input: { organizationId: string }): Promise<{
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
  }> {
    const [subscription, entitlementEntries] = await Promise.all([
      this.billingRepo.findByOrgId(input.organizationId),
      this.billingRepo.findEntitlementsByOrg(input.organizationId),
    ]);

    // Get full details for each entitlement
    const entitlements = (
      await Promise.all(
        entitlementEntries.map((e) =>
          this.billingRepo.findEntitlement(input.organizationId, e.moduleKey),
        ),
      )
    ).filter(Boolean).map((e) => ({
      moduleKey: e!.moduleKey,
      state: e!.state,
      trialEndsAt: e!.trialEndsAt?.toISOString() ?? null,
      activatedAt: e!.activatedAt?.toISOString() ?? null,
    }));

    return {
      subscription: subscription
        ? {
            id: subscription.id,
            stripeCustomerId: subscription.stripeCustomerId,
            status: subscription.status,
            billingCurrency: subscription.billingCurrency,
            currentPeriodEnd: subscription.currentPeriodEnd?.toISOString() ?? null,
          }
        : null,
      entitlements,
    };
  }
}
