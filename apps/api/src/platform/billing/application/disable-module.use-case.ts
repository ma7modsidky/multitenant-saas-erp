import { Inject, Injectable } from '@nestjs/common';

import { ConflictError, NotFoundError } from '../../../core/common/errors.js';
import { TransactionManager } from '../../../core/database/transaction-manager.js';
import {
  validateStateTransition,
  ENTITLEMENT_NOT_FOUND,
  MODULE_NOT_FOUND,
  MODULE_DEPENDENCY_CONFLICT,
} from '../domain/index.js';
import { BILLING_REPOSITORY, STRIPE_PORT, type BillingRepository, type StripePort } from '../ports/index.js';

@Injectable()
export class DisableModuleUseCase {
  constructor(
    @Inject(BILLING_REPOSITORY)
    private readonly billingRepo: BillingRepository,
    @Inject(STRIPE_PORT)
    private readonly stripe: StripePort,
    private readonly txManager: TransactionManager,
  ) {}

  async execute(input: { organizationId: string; moduleKey: string }): Promise<void> {
    // Get current entitlement — core_module_entitlements is RLS-protected,
    // so the read must run inside the tenant-bound transaction.
    const entitlement = await this.txManager.run((tx) =>
      this.billingRepo.findEntitlement(input.organizationId, input.moduleKey, tx),
    );
    if (!entitlement) {
      throw new NotFoundError(ENTITLEMENT_NOT_FOUND, { moduleKey: input.moduleKey });
    }

    // Validate state transition to 'disabled'
    validateStateTransition(entitlement.state, 'disabled');

    // BILL-9: Check if any other entitled module depends on this one
    const dependentModules = await this.billingRepo.getDependentModules(input.moduleKey);
    for (const dep of dependentModules) {
      const depEntitlement = await this.txManager.run((tx) =>
        this.billingRepo.findEntitlement(input.organizationId, dep, tx),
      );
      if (depEntitlement && ['trialing', 'active', 'past_due'].includes(depEntitlement.state)) {
        throw new ConflictError(
          MODULE_DEPENDENCY_CONFLICT,
          `Cannot disable '${input.moduleKey}': '${dep}' depends on it`,
        );
      }
    }

    await this.txManager.run(async (tx) => {
      // Disable in Stripe if there's a subscription item
      if (entitlement.stripeSubscriptionItemId) {
        await this.stripe.removeSubscriptionItem(entitlement.stripeSubscriptionItemId);
      }

      // Update local state to disabled
      await this.billingRepo.upsertEntitlement(
        {
          organizationId: input.organizationId,
          moduleKey: input.moduleKey,
          state: 'disabled',
          disabledAt: new Date(),
          // BILL-7: Set purge_after based on data retention policy (default 30 days)
          purgeAfter: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          stripeSubscriptionItemId: null,
        },
        tx,
      );
    });
  }
}
