import * as crypto from 'node:crypto';
import { Injectable } from '@nestjs/common';

import { type StripePort } from '../../ports/index.js';

/**
 * FakeStripeAdapter — simulates Stripe API for development.
 *
 * In-memory store of customers and subscriptions.
 * Replace with LiveStripeAdapter in production using Stripe SDK.
 */
@Injectable()
export class FakeStripeAdapter implements StripePort {
  private readonly customers = new Map<string, { id: string; name: string; email: string; orgId: string }>();
  private readonly subscriptions = new Map<
    string,
    {
      id: string;
      customerId: string;
      billingCurrency: string;
      items: Array<{ id: string; priceKey: string }>;
      status: string;
      currentPeriodEnd: Date;
    }
  >();

  async createCustomer(organizationId: string, name: string, email: string): Promise<{ customerId: string }> {
    const customerId = `cus_fake_${crypto.randomUUID().slice(0, 8)}`;
    this.customers.set(customerId, { id: customerId, name, email, orgId: organizationId });
    return { customerId };
  }

  async createSubscription(params: {
    customerId: string;
    billingCurrency: string;
    priceKeys: string[];
  }): Promise<{ subscriptionId: string; currentPeriodEnd: Date }> {
    const subscriptionId = `sub_fake_${crypto.randomUUID().slice(0, 8)}`;
    const currentPeriodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

    this.subscriptions.set(subscriptionId, {
      id: subscriptionId,
      customerId: params.customerId,
      billingCurrency: params.billingCurrency,
      items: params.priceKeys.map((pk) => ({
        id: `si_fake_${crypto.randomUUID().slice(0, 8)}`,
        priceKey: pk,
      })),
      status: 'active',
      currentPeriodEnd,
    });

    return { subscriptionId, currentPeriodEnd };
  }

  async addSubscriptionItem(params: {
    subscriptionId: string;
    priceKey: string;
  }): Promise<{ subscriptionItemId: string }> {
    let sub = this.subscriptions.get(params.subscriptionId);
    if (!sub) {
      // Dev resilience: the subscription row may have been created by a
      // previous process (this in-memory store resets on restart). Synthesize
      // a matching entry so trial flows keep working against an existing
      // locally-created subscription instead of failing with a 500.
      sub = {
        id: params.subscriptionId,
        customerId: 'cus_fake_unknown',
        billingCurrency: 'USD',
        items: [],
        status: 'active',
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      };
      this.subscriptions.set(params.subscriptionId, sub);
    }

    const itemId = `si_fake_${crypto.randomUUID().slice(0, 8)}`;
    sub.items.push({ id: itemId, priceKey: params.priceKey });

    return { subscriptionItemId: itemId };
  }

  async removeSubscriptionItem(subscriptionItemId: string): Promise<void> {
    for (const [, sub] of this.subscriptions) {
      sub.items = sub.items.filter((item) => item.id !== subscriptionItemId);
    }
  }

  async getSubscriptionItems(subscriptionId: string): Promise<Array<{ id: string; priceKey: string }>> {
    const sub = this.subscriptions.get(subscriptionId);
    return sub?.items ?? [];
  }

  async verifyWebhookSignature(
    payload: string,
    signature: string,
    _secret: string,
  ): Promise<Record<string, unknown> | null> {
    // In dev mode: accept a known test signature or validate with a simple scheme
    if (signature === 'test_valid_signature') {
      try {
        return JSON.parse(payload) as Record<string, unknown>;
      } catch {
        return null;
      }
    }

    // For real validation, the live adapter would use Stripe SDK:
    // stripe.webhooks.constructEvent(payload, signature, secret)
    return null;
  }
}
