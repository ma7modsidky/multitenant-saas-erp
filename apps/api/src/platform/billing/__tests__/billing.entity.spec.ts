import { describe, expect, it } from 'vitest';

import { Billing, validateStateTransition, ENTITLEMENT_STATE_LABELS, type SubscriptionData } from '../domain/index.js';
import { INVALID_STATE_TRANSITION } from '../domain/errors.js';

function makeSubscriptionData(overrides: Partial<SubscriptionData> = {}): SubscriptionData {
  return {
    id: 'sub-1',
    organizationId: 'org-1',
    stripeCustomerId: 'cus_123',
    stripeSubscriptionId: 'sub_123',
    status: 'active',
    billingCurrency: 'USD',
    currentPeriodEnd: new Date('2026-02-01T00:00:00Z'),
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

function expectInvalidTransition(from: string, to: string): void {
  try {
    validateStateTransition(from, to);
    expect.fail(`Expected INVALID_STATE_TRANSITION from '${from}' to '${to}'`);
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    expect((error as { code: string }).code).toBe(INVALID_STATE_TRANSITION);
  }
}

// ─── State machine transitions ──────────────────────────────────────────────

describe('BILL-3/6/7: Entitlement state machine - VALID transitions', () => {
  const validCases: Array<[string, string]> = [
    ['available', 'trialing'],
    ['available', 'active'],
    ['trialing', 'active'],
    ['trialing', 'expired'],
    ['trialing', 'disabled'],
    ['active', 'past_due'],
    ['active', 'disabled'],
    ['active', 'expired'],
    ['past_due', 'active'],
    ['past_due', 'suspended'],
    ['expired', 'active'],
    ['expired', 'disabled'],
    ['suspended', 'active'],
    ['disabled', 'available'],
    ['disabled', 'active'],
  ];

  for (const [from, to] of validCases) {
    it(`allows transition from '${from}' to '${to}'`, () => {
      expect(() => validateStateTransition(from, to)).not.toThrow();
    });
  }
});

describe('Entitlement state machine - INVALID transitions', () => {
  const invalidCases: Array<[string, string]> = [
    ['available', 'available'], ['available', 'expired'],
    ['available', 'past_due'], ['available', 'suspended'],
    ['available', 'disabled'], ['trialing', 'trialing'],
    ['trialing', 'past_due'], ['trialing', 'suspended'],
    ['active', 'active'], ['active', 'trialing'],
    ['active', 'available'], ['past_due', 'past_due'],
    ['past_due', 'trialing'], ['past_due', 'expired'],
    ['past_due', 'disabled'], ['expired', 'expired'],
    ['expired', 'trialing'], ['expired', 'past_due'],
    ['expired', 'suspended'], ['suspended', 'suspended'],
    ['suspended', 'trialing'], ['suspended', 'past_due'],
    ['suspended', 'expired'], ['suspended', 'disabled'],
    ['disabled', 'disabled'], ['disabled', 'trialing'],
    ['disabled', 'past_due'], ['disabled', 'expired'],
    ['disabled', 'suspended'], ['unknown_state', 'active'],
    ['active', 'unknown_state'],
  ];

  for (const [from, to] of invalidCases) {
    it(`rejects transition from '${from}' to '${to}'`, () => {
      expectInvalidTransition(from, to);
    });
  }
});

// ─── Billing entity behaviour ──────────────────────────────────────────────

describe('Billing.create()', () => {
  it('creates a subscription from data', () => {
    const sub = Billing.create(makeSubscriptionData());
    expect(sub.id).toBe('sub-1');
    expect(sub.stripeCustomerId).toBe('cus_123');
    expect(sub.status).toBe('active');
  });
});

describe('Billing.updateStatus()', () => {
  it('updates the status', () => {
    const sub = Billing.create(makeSubscriptionData());
    sub.updateStatus('past_due');
    expect(sub.status).toBe('past_due');
  });

  it('updates currentPeriodEnd when provided', () => {
    const sub = Billing.create(makeSubscriptionData());
    const newEnd = new Date('2026-03-01T00:00:00Z');
    sub.updateStatus('active', newEnd);
    expect(sub.currentPeriodEnd).toBe(newEnd);
  });

  it('does not change currentPeriodEnd when not provided', () => {
    const sub = Billing.create(makeSubscriptionData({ currentPeriodEnd: new Date('2026-02-01T00:00:00Z') }));
    sub.updateStatus('past_due');
    expect(sub.currentPeriodEnd).toEqual(new Date('2026-02-01T00:00:00Z'));
  });
});

describe('Billing.toJSON()', () => {
  it('returns a copy of the subscription data', () => {
    const data = makeSubscriptionData();
    const sub = Billing.create(data);
    const json = sub.toJSON();
    expect(json.stripeCustomerId).toBe('cus_123');
    expect(json.status).toBe('active');
  });
});

describe('ENTITLEMENT_STATE_LABELS', () => {
  it('has labels for all 7 states', () => {
    expect(ENTITLEMENT_STATE_LABELS.available).toBe('Available');
    expect(ENTITLEMENT_STATE_LABELS.trialing).toBe('Trial');
    expect(ENTITLEMENT_STATE_LABELS.active).toBe('Active');
    expect(ENTITLEMENT_STATE_LABELS.past_due).toBe('Past Due');
    expect(ENTITLEMENT_STATE_LABELS.expired).toBe('Expired');
    expect(ENTITLEMENT_STATE_LABELS.suspended).toBe('Suspended');
    expect(ENTITLEMENT_STATE_LABELS.disabled).toBe('Disabled');
  });
});
