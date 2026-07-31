import { Inject, Injectable } from '@nestjs/common';

import { ConflictError, NotFoundError } from '../../../core/common/errors.js';
import { TransactionManager } from '../../../core/database/transaction-manager.js';
import {
  validateStateTransition,
  TRIAL_ALREADY_USED,
  MODULE_NOT_FOUND,
  SUBSCRIPTION_NOT_FOUND,
  MODULE_DEPENDENCY_MISSING,
} from '../domain/index.js';
import { BILLING_REPOSITORY, STRIPE_PORT, type BillingRepository, type StripePort } from '../ports/index.js';

/** States that grant any level of access (full or read-only). */
const ENTITLED_STATES = ['active', 'trialing', 'past_due', 'expired'];

@Injectable()
export class EnableModuleTrialUseCase {
  constructor(
    @Inject(BILLING_REPOSITORY)
    private readonly billingRepo: BillingRepository,
    @Inject(STRIPE_PORT)
    private readonly stripe: StripePort,
    private readonly txManager: TransactionManager,
  ) {}

  async execute(input: {
    organizationId: string;
    moduleKey: string;
    userId: string;
    skipTrial?: boolean;
  }): Promise<void> {
    // Get the module from catalog
    const moduleCatalog = await this.billingRepo.getModuleFromCatalog(input.moduleKey);
    if (!moduleCatalog) {
      throw new NotFoundError(MODULE_NOT_FOUND, { moduleKey: input.moduleKey });
    }

    // Get current subscription
    const subscription = await this.billingRepo.findByOrgId(input.organizationId);
    if (!subscription) {
      throw new NotFoundError(SUBSCRIPTION_NOT_FOUND, { organizationId: input.organizationId });
    }

    // Check current entitlement state
    const entitlement = await this.billingRepo.findEntitlement(input.organizationId, input.moduleKey);

    // If entitlement exists and is trialing/active, reject
    if (entitlement && (entitlement.state === 'trialing' || entitlement.state === 'active')) {
      throw new ConflictError(TRIAL_ALREADY_USED, `Module '${input.moduleKey}' already has an active trial or subscription`);
    }

    // BILL-8: All dependencies must be entitled before enabling this module
    for (const dep of moduleCatalog.dependsOn) {
      const depEntitlement = await this.billingRepo.findEntitlement(input.organizationId, dep);
      const depState = depEntitlement?.state ?? 'available';
      if (!ENTITLED_STATES.includes(depState)) {
        throw new ConflictError(
          MODULE_DEPENDENCY_MISSING,
          `Cannot enable '${input.moduleKey}': dependency '${dep}' is not entitled (state: ${depState})`,
        );
      }
    }

    const isTrial = !input.skipTrial && moduleCatalog.trialDays > 0;
    const targetState = isTrial ? 'trialing' : 'active';
    const trialDays = moduleCatalog.trialDays;

    await this.txManager.run(async (tx) => {
      // Update entitlement state
      await this.billingRepo.upsertEntitlement({
        organizationId: input.organizationId,
        moduleKey: input.moduleKey,
        state: targetState,
        trialStartedAt: isTrial ? new Date() : null,
        trialEndsAt: isTrial ? new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000) : null,
        activatedAt: new Date(),
        stripeSubscriptionItemId: null,
      }, tx);

      // Add to Stripe subscription if there's a price key
      if (moduleCatalog.stripePriceKey) {
        const { subscriptionItemId } = await this.stripe.addSubscriptionItem({
          subscriptionId: subscription.stripeSubscriptionId,
          priceKey: moduleCatalog.stripePriceKey,
        });

        // Update with the Stripe subscription item ID
        await this.billingRepo.upsertEntitlement({
          organizationId: input.organizationId,
          moduleKey: input.moduleKey,
          state: targetState,
          stripeSubscriptionItemId: subscriptionItemId,
        }, tx);
      }
    });
  }
}
