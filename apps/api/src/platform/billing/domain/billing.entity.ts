import { DomainError } from '../../../core/common/errors.js';
import { INVALID_STATE_TRANSITION } from './errors.js';

/**
 * Subscription status values from Stripe.
 */
export type SubscriptionStatus = 'incomplete' | 'incomplete_expired' | 'trialing' | 'active' | 'past_due' | 'canceled' | 'unpaid';

/**
 * Subscription entity data (persisted to core_subscriptions).
 */
export interface SubscriptionData {
  id: string;
  organizationId: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  status: SubscriptionStatus;
  billingCurrency: string;
  currentPeriodEnd: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Allowed entitlement state transitions per BILL-3, BILL-6, BILL-7.
 */
const VALID_TRANSITIONS: Record<string, string[]> = {
  available:  ['trialing', 'active'],
  trialing:   ['active', 'expired', 'disabled'],
  active:     ['past_due', 'disabled', 'expired'],
  past_due:   ['active', 'suspended'],
  expired:    ['active', 'disabled'],
  suspended:  ['active'],
  disabled:   ['available', 'active'],
};

/**
 * Validate an entitlement state transition.
 * @throws DomainError if the transition is not allowed.
 */
export function validateStateTransition(from: string, to: string): void {
  const allowed = VALID_TRANSITIONS[from];
  if (!allowed?.includes(to)) {
    throw new DomainError(
      INVALID_STATE_TRANSITION,
      `Cannot transition from '${from}' to '${to}'`,
    );
  }
}

/**
 * Billing — domain entity for an organization's subscription.
 *
 * Business rules enforced:
 * - BILL-1: One customer + one base subscription per org
 * - BILL-11: Billing currency is immutable after first subscription
 */
export class Billing {
  private constructor(private readonly data: SubscriptionData) {}

  static create(data: SubscriptionData): Billing {
    return new Billing(data);
  }

  static fromPersistence(data: SubscriptionData): Billing {
    return new Billing(data);
  }

  // ─── Getters ────────────────────────────────────────────────────────────────

  get id(): string { return this.data.id; }
  get organizationId(): string { return this.data.organizationId; }
  get stripeCustomerId(): string { return this.data.stripeCustomerId; }
  get stripeSubscriptionId(): string { return this.data.stripeSubscriptionId; }
  get status(): SubscriptionStatus { return this.data.status; }
  get billingCurrency(): string { return this.data.billingCurrency; }
  get currentPeriodEnd(): Date | null { return this.data.currentPeriodEnd; }

  toJSON(): SubscriptionData {
    return { ...this.data };
  }

  /**
   * Update subscription status from a Stripe webhook event.
   */
  updateStatus(newStatus: SubscriptionStatus, currentPeriodEnd?: Date): void {
    this.data.status = newStatus;
    if (currentPeriodEnd) {
      this.data.currentPeriodEnd = currentPeriodEnd;
    }
  }
}

/**
 * Entitlement state names for human-readable messages.
 */
export const ENTITLEMENT_STATE_LABELS: Record<string, string> = {
  available: 'Available',
  trialing: 'Trial',
  active: 'Active',
  past_due: 'Past Due',
  expired: 'Expired',
  suspended: 'Suspended',
  disabled: 'Disabled',
};
