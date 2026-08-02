import { Inject, Injectable } from '@nestjs/common';

import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { BILLING_REPOSITORY, type BillingRepository } from '../ports/index.js';

@Injectable()
export class GetBillingUseCase {
  constructor(
    @Inject(BILLING_REPOSITORY)
    private readonly billingRepo: BillingRepository,
    private readonly txManager: TransactionManager,
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
    // core_subscriptions and core_module_entitlements are RLS-protected;
    // reads must run inside the tenant-bound transaction or they fail closed.
    const [subscription, entitlementEntries] = await this.txManager.run(async (tx) => {
      const [sub, entries] = await Promise.all([
        this.billingRepo.findByOrgId(input.organizationId, tx),
        this.billingRepo.findEntitlementsByOrg(input.organizationId, tx),
      ]);
      return [sub, entries] as const;
    });

    // Get full details for each entitlement
    const entitlements = (
      await this.txManager.run((tx) =>
        Promise.all(
          entitlementEntries.map((e) => this.billingRepo.findEntitlement(input.organizationId, e.moduleKey, tx)),
        ),
      )
    )
      .filter(Boolean)
      .map((e) => ({
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
