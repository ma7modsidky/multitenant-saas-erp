/**
 * StripePort — abstraction over Stripe API calls.
 *
 * Implementations:
 *   - FakeStripeAdapter  (development — simulates Stripe)
 *   - LiveStripeAdapter  (production — calls Stripe SDK)
 *
 * @see BILL-1 — Stripe adapter
 */
export interface StripePort {
  /**
   * Create a Stripe customer for an organization.
   * Returns the Stripe customer ID.
   */
  createCustomer(organizationId: string, name: string, email: string): Promise<{ customerId: string }>;

  /**
   * Create a subscription with base plan and optional module items.
   * Returns the Stripe subscription ID and current period end.
   */
  createSubscription(params: {
    customerId: string;
    billingCurrency: string;
    priceKeys: string[];
  }): Promise<{ subscriptionId: string; currentPeriodEnd: Date }>;

  /**
   * Add a subscription item (module) to an existing subscription.
   */
  addSubscriptionItem(params: {
    subscriptionId: string;
    priceKey: string;
  }): Promise<{ subscriptionItemId: string }>;

  /**
   * Remove a subscription item from a subscription.
   */
  removeSubscriptionItem(subscriptionItemId: string): Promise<void>;

  /**
   * Get the current subscription items from Stripe.
   * Returns the item IDs and price keys.
   */
  getSubscriptionItems(subscriptionId: string): Promise<Array<{ id: string; priceKey: string }>>;

  /**
   * Verify a webhook signature and return the parsed event.
   * Returns null if signature is invalid.
   */
  verifyWebhookSignature(payload: string, signature: string, secret: string): Promise<Record<string, unknown> | null>;
}

export const STRIPE_PORT = Symbol('STRIPE_PORT');
