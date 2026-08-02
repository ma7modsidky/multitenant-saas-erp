import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ConflictError } from '../../../core/common/errors.js';
import { WEBHOOK_ALREADY_PROCESSED } from '../domain/errors.js';
import { HandleWebhookUseCase } from '../application/handle-webhook.use-case.js';

describe('HandleWebhookUseCase', () => {
  let billingRepo: {
    findByStripeSubscriptionId: ReturnType<typeof vi.fn>;
    findEntitlementsByOrg: ReturnType<typeof vi.fn>;
    findActiveSubscriptionItems: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    updateEntitlementState: ReturnType<typeof vi.fn>;
  };
  let stripe: {
    verifyWebhookSignature: ReturnType<typeof vi.fn>;
  };
  let txManager: { run: ReturnType<typeof vi.fn> };
  let useCase: HandleWebhookUseCase;

  const subscription = {
    id: 'sub-1',
    organizationId: 'org-1',
    stripeCustomerId: 'cus_123',
    stripeSubscriptionId: 'sub_123',
    status: 'past_due',
    billingCurrency: 'USD',
    currentPeriodEnd: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    billingRepo = {
      findByStripeSubscriptionId: vi.fn().mockResolvedValue(subscription),
      findEntitlementsByOrg: vi.fn().mockResolvedValue([]),
      findActiveSubscriptionItems: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue(subscription),
      updateEntitlementState: vi.fn().mockResolvedValue(undefined),
    };
    stripe = {
      verifyWebhookSignature: vi.fn().mockImplementation(async () => null),
    };
    txManager = {
      run: vi.fn().mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn('tx')),
    };

    useCase = new HandleWebhookUseCase(billingRepo as never, stripe as never, txManager as never);
  });

  const execute = (event: Record<string, unknown>) =>
    useCase.execute({ payload: JSON.stringify(event), signature: 'test_valid_signature', secret: 'whsec_test' });

  it('BILL-5: returns received:false when the signature is invalid (nothing processed)', async () => {
    stripe.verifyWebhookSignature.mockResolvedValue(null);

    const result = await useCase.execute({ payload: '{}', signature: 'bad', secret: 'whsec_test' });
    expect(result).toEqual({ received: false });
    expect(billingRepo.findByStripeSubscriptionId).not.toHaveBeenCalled();
  });

  it('BILL-5: is idempotent — replaying the same event id raises WEBHOOK_ALREADY_PROCESSED', async () => {
    const event = { id: 'evt_1', type: 'invoice.paid', data: { object: { subscription: 'sub_123' } } };
    stripe.verifyWebhookSignature.mockImplementation(async () => event);

    const first = await execute(event);
    expect(first.received).toBe(true);

    await expect(execute(event)).rejects.toBeInstanceOf(ConflictError);
    await expect(execute(event)).rejects.toMatchObject({ code: WEBHOOK_ALREADY_PROCESSED });
  });

  it('BILL-6: invoice.paid moves past_due entitlements back to active', async () => {
    billingRepo.findEntitlementsByOrg.mockResolvedValue([{ id: 'ent-1', moduleKey: 'crm', state: 'past_due' }]);
    const event = { id: 'evt_2', type: 'invoice.paid', data: { object: { subscription: 'sub_123' } } };
    stripe.verifyWebhookSignature.mockImplementation(async () => event);

    const result = await execute(event);

    expect(result.received).toBe(true);
    expect(billingRepo.update).toHaveBeenCalledWith(
      'sub-1',
      { status: 'active', currentPeriodEnd: expect.any(Date) },
      'tx',
    );
    expect(billingRepo.updateEntitlementState).toHaveBeenCalledWith('org-1', 'crm', 'active', 'tx');
  });

  it('BILL-6: invoice.payment_failed moves active entitlements to past_due', async () => {
    billingRepo.findActiveSubscriptionItems.mockResolvedValue([
      { moduleKey: 'crm', stripeSubscriptionItemId: null, state: 'active' },
    ]);
    const event = { id: 'evt_3', type: 'invoice.payment_failed', data: { object: { subscription: 'sub_123' } } };
    stripe.verifyWebhookSignature.mockImplementation(async () => event);

    await execute(event);

    expect(billingRepo.update).toHaveBeenCalledWith('sub-1', { status: 'past_due' }, 'tx');
    expect(billingRepo.updateEntitlementState).toHaveBeenCalledWith('org-1', 'crm', 'past_due', 'tx');
  });

  it('customer.subscription.updated syncs the subscription status from Stripe', async () => {
    billingRepo.findEntitlementsByOrg.mockResolvedValue([]);
    const event = {
      id: 'evt_4',
      type: 'customer.subscription.updated',
      data: { object: { id: 'sub_123', status: 'trialing' } },
    };
    stripe.verifyWebhookSignature.mockImplementation(async () => event);

    await execute(event);

    expect(billingRepo.update).toHaveBeenCalledWith('sub-1', { status: 'trialing' }, 'tx');
  });

  it('customer.subscription.deleted disables active/trialing modules and suspends past_due', async () => {
    billingRepo.findEntitlementsByOrg.mockResolvedValue([
      { id: 'ent-1', moduleKey: 'crm', state: 'active' },
      { id: 'ent-2', moduleKey: 'inventory', state: 'trialing' },
      { id: 'ent-3', moduleKey: 'pos', state: 'past_due' },
    ]);
    const event = { id: 'evt_5', type: 'customer.subscription.deleted', data: { object: { id: 'sub_123' } } };
    stripe.verifyWebhookSignature.mockImplementation(async () => event);

    await execute(event);

    // active → disabled, trialing → disabled (valid), past_due → suspended (only valid path).
    expect(billingRepo.updateEntitlementState).toHaveBeenCalledTimes(3);
    expect(billingRepo.updateEntitlementState).toHaveBeenCalledWith('org-1', 'crm', 'disabled', 'tx');
    expect(billingRepo.updateEntitlementState).toHaveBeenCalledWith('org-1', 'inventory', 'disabled', 'tx');
    expect(billingRepo.updateEntitlementState).toHaveBeenCalledWith('org-1', 'pos', 'suspended', 'tx');
  });

  it('does not crash on events for unknown subscriptions', async () => {
    billingRepo.findByStripeSubscriptionId.mockResolvedValue(undefined);
    const event = { id: 'evt_6', type: 'invoice.paid', data: { object: { subscription: 'sub_missing' } } };
    stripe.verifyWebhookSignature.mockImplementation(async () => event);

    await expect(execute(event)).resolves.toEqual({ received: true });
    expect(billingRepo.update).not.toHaveBeenCalled();
  });
});
