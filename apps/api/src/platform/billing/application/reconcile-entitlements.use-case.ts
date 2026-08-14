import { Inject, Injectable } from '@nestjs/common';

import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { validateStateTransition } from '../domain/index.js';
import { BILLING_REPOSITORY, STRIPE_PORT, type BillingRepository, type StripePort } from '../ports/index.js';

/**
 * ReconcileEntitlementsUseCase — nightly reconciliation job (BILL-4).
 *
 * 1. Expiry pass: lapsed trials (`trialing` past `trial_ends_at`, BILL-3) and
 *    lapsed time-boxed free grants (`active` past `access_until` with no Stripe
 *    item, BILL-14) move to `expired` (read-only grace).
 * 2. Stripe pass: compares local entitlements vs Stripe subscription items.
 *    Stripe wins in a conflict — but ONLY for PAID modules (those carrying a
 *    Stripe subscription item). Free admin grants are never reconciled against
 *    Stripe, so the job cannot disable a complimentary grant (PLT-8).
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

    // Get local entitlements (full rows: item id + trial/grant expiry dates)
    const localEntitlements = await this.txManager.run((tx) =>
      this.billingRepo.findEntitlementsByOrg(input.organizationId, tx),
    );

    // Get Stripe subscription items
    const stripeItems = await this.stripe.getSubscriptionItems(subscription.stripeSubscriptionId);
    const stripePriceKeys = new Set(stripeItems.map((item) => item.priceKey));

    await this.txManager.run(async (tx) => {
      for (const local of localEntitlements) {
        const now = Date.now();

        // BILL-3: a running trial whose end date passed moves to `expired`
        // (read-only grace) — trial expiry is enforced here nightly.
        if (local.state === 'trialing' && local.trialEndsAt && local.trialEndsAt.getTime() < now) {
          validateStateTransition('trialing', 'expired');
          await this.billingRepo.updateEntitlementState(input.organizationId, local.moduleKey, 'expired', tx);
          updated++;
          alerts.push(`Module '${local.moduleKey}' trial expired`);
          continue;
        }

        // BILL-14: a time-boxed FREE grant whose end date passed moves to
        // `expired` (read-only grace) — a bounded grant is not permanent.
        if (
          local.state === 'active' &&
          !local.stripeSubscriptionItemId &&
          local.accessUntil &&
          local.accessUntil.getTime() < now
        ) {
          validateStateTransition('active', 'expired');
          await this.billingRepo.updateEntitlementState(input.organizationId, local.moduleKey, 'expired', tx);
          updated++;
          alerts.push(`Module '${local.moduleKey}' grant access ended`);
          continue;
        }

        // BILL-4: Stripe is the commercial authority ONLY for paid modules
        // (those with a Stripe subscription item). Free admin grants carry no
        // item and are never reconciled against Stripe — otherwise the nightly
        // job would disable every complimentary grant (PLT-8/BILL-14).
        if (!local.stripeSubscriptionItemId) {
          continue;
        }
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
          // A paid module absent from the Stripe subscription is treated as
          // cancelled → disabled.
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
