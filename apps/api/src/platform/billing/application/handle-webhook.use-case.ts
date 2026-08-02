import { Inject, Injectable } from '@nestjs/common';

import { ConflictError } from '../../../core/common/errors.js';
import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { validateStateTransition, WEBHOOK_ALREADY_PROCESSED, type SubscriptionStatus } from '../domain/index.js';
import { BILLING_REPOSITORY, STRIPE_PORT, type BillingRepository, type StripePort } from '../ports/index.js';

@Injectable()
export class HandleWebhookUseCase {
  // In-memory tracker for idempotency; TODO: persist to DB in production
  private readonly processedEvents = new Set<string>();

  constructor(
    @Inject(BILLING_REPOSITORY)
    private readonly billingRepo: BillingRepository,
    @Inject(STRIPE_PORT)
    private readonly stripe: StripePort,
    private readonly txManager: TransactionManager,
  ) {}

  async execute(input: { payload: string; signature: string; secret: string }): Promise<{ received: boolean }> {
    // Verify webhook signature (BILL-5)
    const event = await this.stripe.verifyWebhookSignature(input.payload, input.signature, input.secret);
    if (!event) {
      return { received: false };
    }

    const eventId = event.id as string | undefined;
    const eventType = event.type as string | undefined;

    if (!eventId || !eventType) return { received: false };

    // Idempotency: skip already processed events
    if (this.processedEvents.has(eventId)) {
      throw new ConflictError(WEBHOOK_ALREADY_PROCESSED, `Webhook event ${eventId} already processed`);
    }

    this.processedEvents.add(eventId);

    try {
      // Extract the event data object — Stripe nests the resource under 'data.object'
      const eventData = (event.data as Record<string, unknown> | undefined)?.object as
        Record<string, unknown> | undefined;
      await this.processEvent(eventType, eventData);
    } catch {
      // Don't fail the webhook response — Stripe will retry
    }

    return { received: true };
  }

  private async processEvent(eventType: string, data?: Record<string, unknown>): Promise<void> {
    switch (eventType) {
      case 'invoice.paid':
        await this.handleInvoicePaid(data);
        break;
      case 'invoice.payment_failed':
        await this.handlePaymentFailed(data);
        break;
      case 'customer.subscription.updated':
        await this.handleSubscriptionUpdated(data);
        break;
      case 'customer.subscription.deleted':
        await this.handleSubscriptionDeleted(data);
        break;
      default:
        break;
    }
  }

  private async handleInvoicePaid(data?: Record<string, unknown>): Promise<void> {
    const subscriptionId = data?.subscription as string | undefined;
    if (!subscriptionId) return;

    const subscription = await this.billingRepo.findByStripeSubscriptionId(subscriptionId);
    if (!subscription) return;

    await this.txManager.run(async (tx) => {
      await this.billingRepo.update(
        subscription.id,
        {
          status: 'active',
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
        tx,
      );

      const entitlements = await this.billingRepo.findEntitlementsByOrg(subscription.organizationId, tx);
      for (const ent of entitlements) {
        if (ent.state === 'past_due') {
          validateStateTransition('past_due', 'active');
          await this.billingRepo.updateEntitlementState(subscription.organizationId, ent.moduleKey, 'active', tx);
        }
      }
    });
  }

  private async handlePaymentFailed(data?: Record<string, unknown>): Promise<void> {
    const subscriptionId = data?.subscription as string | undefined;
    if (!subscriptionId) return;

    const subscription = await this.billingRepo.findByStripeSubscriptionId(subscriptionId);
    if (!subscription) return;

    await this.txManager.run(async (tx) => {
      await this.billingRepo.update(subscription.id, { status: 'past_due' }, tx);

      const entitlements = await this.billingRepo.findActiveSubscriptionItems(subscription.organizationId, tx);
      for (const ent of entitlements) {
        if (ent.state === 'active') {
          validateStateTransition('active', 'past_due');
          await this.billingRepo.updateEntitlementState(subscription.organizationId, ent.moduleKey, 'past_due', tx);
        }
      }
    });
  }

  private async handleSubscriptionUpdated(data?: Record<string, unknown>): Promise<void> {
    const subscriptionId = data?.id as string | undefined;
    const status = data?.status as string | undefined;
    if (!subscriptionId || !status) return;

    const subscription = await this.billingRepo.findByStripeSubscriptionId(subscriptionId);
    if (!subscription) return;

    await this.txManager.run(async (tx) => {
      await this.billingRepo.update(subscription.id, { status: status as SubscriptionStatus }, tx);
    });
  }

  private async handleSubscriptionDeleted(data?: Record<string, unknown>): Promise<void> {
    const subscriptionId = data?.id as string | undefined;
    if (!subscriptionId) return;

    const subscription = await this.billingRepo.findByStripeSubscriptionId(subscriptionId);
    if (!subscription) return;

    await this.txManager.run(async (tx) => {
      // BILL-6: a deleted subscription ends the commercial relationship.
      // Active/trialing modules are treated as cancelled → disabled. Modules
      // still in dunning have no valid path to disabled, so they drop to
      // suspended (the terminal access-denied state) instead.
      const DELETED_TARGET: Record<string, string> = {
        active: 'disabled',
        trialing: 'disabled',
        expired: 'disabled',
        past_due: 'suspended',
      };

      const entitlements = await this.billingRepo.findEntitlementsByOrg(subscription.organizationId, tx);
      for (const ent of entitlements) {
        const target = DELETED_TARGET[ent.state];
        if (!target) continue;
        validateStateTransition(ent.state, target);
        await this.billingRepo.updateEntitlementState(subscription.organizationId, ent.moduleKey, target, tx);
      }
    });
  }
}
