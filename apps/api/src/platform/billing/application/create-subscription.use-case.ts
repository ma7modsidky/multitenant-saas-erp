import * as crypto from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';

import { ConflictError, NotFoundError } from '../../../core/common/errors.js';
import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { Billing, SUBSCRIPTION_ALREADY_EXISTS, MODULE_NOT_FOUND } from '../domain/index.js';
import { BILLING_REPOSITORY, STRIPE_PORT, type BillingRepository, type StripePort } from '../ports/index.js';

@Injectable()
export class CreateSubscriptionUseCase {
  constructor(
    @Inject(BILLING_REPOSITORY)
    private readonly billingRepo: BillingRepository,
    @Inject(STRIPE_PORT)
    private readonly stripe: StripePort,
    private readonly txManager: TransactionManager,
  ) {}

  async execute(input: {
    organizationId: string;
    organizationName: string;
    email: string;
    billingCurrency: string;
    priceKeys?: string[];
  }): Promise<{ subscriptionId: string }> {
    // Check for existing subscription (BILL-1: exactly one per org)
    const existing = await this.billingRepo.findByOrgId(input.organizationId);
    if (existing) {
      throw new ConflictError(SUBSCRIPTION_ALREADY_EXISTS, 'Organization already has a subscription');
    }

    // Create Stripe customer
    const { customerId } = await this.stripe.createCustomer(
      input.organizationId,
      input.organizationName,
      input.email,
    );

    // Create Stripe subscription
    const { subscriptionId, currentPeriodEnd } = await this.stripe.createSubscription({
      customerId,
      billingCurrency: input.billingCurrency,
      priceKeys: input.priceKeys ?? [],
    });

    // Save locally
    const subId = crypto.randomUUID();
    await this.txManager.run(async (tx) => {
      await this.billingRepo.insert({
        id: subId,
        organizationId: input.organizationId,
        stripeCustomerId: customerId,
        stripeSubscriptionId: subscriptionId,
        status: 'active',
        billingCurrency: input.billingCurrency,
        currentPeriodEnd,
        createdAt: new Date(),
        updatedAt: new Date(),
      }, tx);

      // Map price keys to module keys via the catalog
      if (input.priceKeys) {
        for (const priceKey of input.priceKeys) {
          // Find module by stripe_price_key in catalog
          const moduleCatalog = await this.billingRepo.findModuleByStripePriceKey(priceKey);
          if (moduleCatalog) {
            await this.billingRepo.upsertEntitlement({
              organizationId: input.organizationId,
              moduleKey: moduleCatalog.key,
              state: 'active',
              activatedAt: new Date(),
              stripeSubscriptionItemId: null,
            }, tx);
          }
        }
      }
    });

    return { subscriptionId: subId };
  }
}
