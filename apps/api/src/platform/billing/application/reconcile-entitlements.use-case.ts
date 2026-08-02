import { Inject, Injectable } from '@nestjs/common';

import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { validateStateTransition } from '../domain/index.js';
import { BILLING_REPOSITORY, STRIPE_PORT, type BillingRepository, type StripePort } from '../ports/index.js';

/**
 * ReconcileEntitlementsUseCase — nightly reconciliation job (BILL-4).
 *
 * Compares local entitlements vs Stripe subscription items.
 * Stripe wins in a conflict — local state is adjusted to match.
 */
@Injectable()
export class ReconcileEntitlementsUseCase {
  constructor(
    @Inject(BILLING_REPOSITORY)
    private readonly billingRepo: BillingRepository,
    @Inject(STRIPE_PORT)
    private readonly stripe: StripePort,
    private readonly txManager: TransactionManager,
  ) {}

  async execute(input: { organizationId: string }): Promise<{ updated: number; alerts: string[] }> {
    // core_subscriptions / core_module_entitlements are RLS-protected — read
    // them inside the tenant-bound transaction or they fail closed.
    const subscription = await this.txManager.run((tx) => this.billingRepo.findByOrgId(input.organizationId, tx));
    if (!subscription) {
      return { updated: 0, alerts: ['No subscription found'] };
    }

    const alerts: string[] = [];
    let updated = 0;

    // Get local entitlements
    const localEntitlements = await this.txManager.run((tx) =>
      this.billingRepo.findEntitlementsByOrg(input.organizationId, tx),
    );

    // Get Stripe subscription items
    const stripeItems = await this.stripe.getSubscriptionItems(subscription.stripeSubscriptionId);
    const stripePriceKeys = new Set(stripeItems.map((item) => item.priceKey));

    await this.txManager.run(async (tx) => {
      for (const local of localEntitlements) {
        const shouldBeActive = stripePriceKeys.has(local.moduleKey);

        if (shouldBeActive && local.state === 'suspended') {
          // Stripe says active, we say suspended → adjust (Stripe wins)
          validateStateTransition('suspended', 'active');
          await this.billingRepo.updateEntitlementState(input.organizationId, local.moduleKey, 'active', tx);
          updated++;
          alerts.push(`Module '${local.moduleKey}' reactivated from Stripe data`);
        }

        if (!shouldBeActive && local.state === 'active') {
          // Stripe says not active, we say active → adjust (BILL-4: Stripe wins).
          // A module absent from the Stripe subscription is treated as cancelled → disabled.
          validateStateTransition('active', 'disabled');
          await this.billingRepo.updateEntitlementState(input.organizationId, local.moduleKey, 'disabled', tx);
          updated++;
          alerts.push(`Module '${local.moduleKey}' disabled — not found in Stripe subscription`);
        }
      }
    });

    return { updated, alerts };
  }
}
