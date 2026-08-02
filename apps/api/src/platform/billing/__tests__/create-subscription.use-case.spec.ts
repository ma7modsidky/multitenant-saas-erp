import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ConflictError } from '../../../core/common/errors.js';
import { SUBSCRIPTION_ALREADY_EXISTS } from '../domain/errors.js';
import { CreateSubscriptionUseCase } from '../application/create-subscription.use-case.js';

describe('CreateSubscriptionUseCase', () => {
  let billingRepo: {
    findByOrgId: ReturnType<typeof vi.fn>;
    findModuleByStripePriceKey: ReturnType<typeof vi.fn>;
    insert: ReturnType<typeof vi.fn>;
    upsertEntitlement: ReturnType<typeof vi.fn>;
  };
  let stripe: {
    createCustomer: ReturnType<typeof vi.fn>;
    createSubscription: ReturnType<typeof vi.fn>;
  };
  let txManager: { run: ReturnType<typeof vi.fn> };
  let useCase: CreateSubscriptionUseCase;

  const input = {
    organizationId: 'org-1',
    organizationName: 'Acme Inc',
    email: 'owner@acme.test',
    billingCurrency: 'USD',
    priceKeys: ['price_crm_monthly'],
  };

  beforeEach(() => {
    billingRepo = {
      findByOrgId: vi.fn().mockResolvedValue(undefined),
      findModuleByStripePriceKey: vi.fn().mockResolvedValue({ key: 'crm' }),
      insert: vi.fn().mockImplementation((data: unknown) => Promise.resolve(data)),
      upsertEntitlement: vi.fn().mockResolvedValue(undefined),
    };
    stripe = {
      createCustomer: vi.fn().mockResolvedValue({ customerId: 'cus_123' }),
      createSubscription: vi
        .fn()
        .mockResolvedValue({ subscriptionId: 'sub_123', currentPeriodEnd: new Date('2026-09-01T00:00:00Z') }),
    };
    txManager = {
      run: vi.fn().mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn('tx')),
    };

    useCase = new CreateSubscriptionUseCase(billingRepo as never, stripe as never, txManager as never);
  });

  it('BILL-1: creates a Stripe customer and base subscription, then persists them', async () => {
    const result = await useCase.execute(input);

    expect(stripe.createCustomer).toHaveBeenCalledWith('org-1', 'Acme Inc', 'owner@acme.test');
    expect(stripe.createSubscription).toHaveBeenCalledWith({
      customerId: 'cus_123',
      billingCurrency: 'USD',
      priceKeys: ['price_crm_monthly'],
    });

    expect(billingRepo.insert).toHaveBeenCalledTimes(1);
    const inserted = billingRepo.insert.mock.calls[0]?.[0] as {
      id: string;
      organizationId: string;
      stripeCustomerId: string;
      stripeSubscriptionId: string;
      status: string;
      billingCurrency: string;
    };
    expect(inserted.id).toBeTruthy();
    expect(inserted.organizationId).toBe('org-1');
    expect(inserted.stripeCustomerId).toBe('cus_123');
    expect(inserted.stripeSubscriptionId).toBe('sub_123');
    expect(inserted.status).toBe('active');
    expect(inserted.billingCurrency).toBe('USD');
    expect(result.subscriptionId).toBe(inserted.id);
  });

  it('BILL-1: rejects a second subscription for an org that already has one', async () => {
    billingRepo.findByOrgId.mockResolvedValue({
      id: 'sub-existing',
      organizationId: 'org-1',
      stripeCustomerId: 'cus_old',
      stripeSubscriptionId: 'sub_old',
      status: 'active',
      billingCurrency: 'USD',
      currentPeriodEnd: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await expect(useCase.execute(input)).rejects.toBeInstanceOf(ConflictError);
    await expect(useCase.execute(input)).rejects.toMatchObject({ code: SUBSCRIPTION_ALREADY_EXISTS });

    // Stripe must never be called when a subscription already exists.
    expect(stripe.createCustomer).not.toHaveBeenCalled();
    expect(stripe.createSubscription).not.toHaveBeenCalled();
    expect(billingRepo.insert).not.toHaveBeenCalled();
  });

  it('BILL-10: resolves price keys through the catalog to active module entitlements', async () => {
    await useCase.execute({ ...input, priceKeys: ['price_crm_monthly', 'price_inventory_monthly'] });

    // Two catalog lookups for the two price keys.
    expect(billingRepo.findModuleByStripePriceKey).toHaveBeenCalledTimes(2);
    expect(billingRepo.findModuleByStripePriceKey).toHaveBeenCalledWith('price_crm_monthly');
    expect(billingRepo.findModuleByStripePriceKey).toHaveBeenCalledWith('price_inventory_monthly');

    // Each known module becomes an ACTIVE entitlement for the org.
    expect(billingRepo.upsertEntitlement).toHaveBeenCalledTimes(2);
    const first = billingRepo.upsertEntitlement.mock.calls[0]?.[0] as {
      organizationId: string;
      moduleKey: string;
      state: string;
    };
    expect(first.organizationId).toBe('org-1');
    expect(first.moduleKey).toBe('crm');
    expect(first.state).toBe('active');
  });

  it('BILL-10: silently skips price keys that are not in the module catalog', async () => {
    billingRepo.findModuleByStripePriceKey.mockResolvedValue(undefined);

    await useCase.execute({ ...input, priceKeys: ['price_unknown_module'] });

    expect(billingRepo.findModuleByStripePriceKey).toHaveBeenCalledTimes(1);
    expect(billingRepo.upsertEntitlement).not.toHaveBeenCalled();
  });

  it('creates a subscription with no module price keys', async () => {
    const result = await useCase.execute({
      organizationId: 'org-1',
      organizationName: 'Acme Inc',
      email: 'owner@acme.test',
      billingCurrency: 'USD',
    });

    expect(stripe.createSubscription).toHaveBeenCalledWith({
      customerId: 'cus_123',
      billingCurrency: 'USD',
      priceKeys: [],
    });
    expect(billingRepo.insert).toHaveBeenCalledTimes(1);
    expect(result.subscriptionId).toBeTruthy();
  });
});
