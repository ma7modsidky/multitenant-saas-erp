import * as crypto from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import { ConflictError, NotFoundError } from '../../../core/common/errors.js';
import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { TRIAL_ALREADY_USED, MODULE_NOT_FOUND, MODULE_DEPENDENCY_MISSING, MODULE_BLOCKED } from '../domain/index.js';
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

    // Get current subscription — core_subscriptions is RLS-protected, so reads
    // must run inside the tenant-bound transaction or they fail closed.
    const subscription = await this.txManager.run((tx) => this.billingRepo.findByOrgId(input.organizationId, tx));

    // Check current entitlement state
    const entitlement = await this.txManager.run((tx) =>
      this.billingRepo.findEntitlement(input.organizationId, input.moduleKey, tx),
    );

    // If entitlement exists and is trialing/active, reject
    if (entitlement && (entitlement.state === 'trialing' || entitlement.state === 'active')) {
      throw new ConflictError(
        TRIAL_ALREADY_USED,
        `Module '${input.moduleKey}' already has an active trial or subscription`,
      );
    }

    // PLT-8: a module blocked by the platform admin (block until paid) cannot
    // be self-enabled — the org must subscribe (or the admin grants access).
    if (entitlement?.state === 'blocked') {
      throw new ConflictError(MODULE_BLOCKED, `Module '${input.moduleKey}' is blocked by the platform administrator`);
    }

    // BILL-2: a module may be trialled ONCE per organization. `trialStartedAt`
    // is a permanent stamp — a trial that expired, was stopped, or was disabled
    // can never be started again, so an org cannot reset its trial days by
    // disabling and re-enabling. Admin overrides use extend-trial / enable-now,
    // never a fresh trial.
    if (!input.skipTrial && moduleCatalog.trialDays > 0 && entitlement?.trialStartedAt) {
      throw new ConflictError(
        TRIAL_ALREADY_USED,
        `Module '${input.moduleKey}' trial has already been used by this organization`,
      );
    }

    // BILL-8: All dependencies must be entitled before enabling this module
    for (const dep of moduleCatalog.dependsOn) {
      const depEntitlement = await this.txManager.run((tx) =>
        this.billingRepo.findEntitlement(input.organizationId, dep, tx),
      );
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
      // BILL-1: exactly one base subscription per org. BILL-2: a trial requires
      // no payment method — so when the org has no subscription yet (fresh
      // signup, or a dev/bootstrap environment), create the base subscription
      // lazily so the trial module item has a subscription to attach to.
      let activeSubscription = subscription;
      if (!activeSubscription) {
        const billingCurrency = (await this.billingRepo.getOrganizationBaseCurrency(input.organizationId, tx)) ?? 'USD';
        const { customerId } = await this.stripe.createCustomer(
          input.organizationId,
          'Organization',
          `${input.organizationId}@local.dev`,
        );
        const created = await this.stripe.createSubscription({
          customerId,
          billingCurrency,
          priceKeys: [],
        });
        activeSubscription = await this.billingRepo.insert(
          {
            id: crypto.randomUUID(),
            organizationId: input.organizationId,
            stripeCustomerId: customerId,
            stripeSubscriptionId: created.subscriptionId,
            status: 'active',
            billingCurrency,
            currentPeriodEnd: created.currentPeriodEnd,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          tx,
        );
      }

      // Update entitlement state
      await this.billingRepo.upsertEntitlement(
        {
          organizationId: input.organizationId,
          moduleKey: input.moduleKey,
          state: targetState,
          trialStartedAt: isTrial ? new Date() : null,
          trialEndsAt: isTrial ? new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000) : null,
          activatedAt: new Date(),
          stripeSubscriptionItemId: null,
        },
        tx,
      );

      // Add to Stripe subscription if there's a price key
      if (moduleCatalog.stripePriceKey) {
        const { subscriptionItemId } = await this.stripe.addSubscriptionItem({
          subscriptionId: activeSubscription.stripeSubscriptionId,
          priceKey: moduleCatalog.stripePriceKey,
        });

        // Update with the Stripe subscription item ID
        await this.billingRepo.upsertEntitlement(
          {
            organizationId: input.organizationId,
            moduleKey: input.moduleKey,
            state: targetState,
            stripeSubscriptionItemId: subscriptionItemId,
          },
          tx,
        );
      }
    });
  }
}
