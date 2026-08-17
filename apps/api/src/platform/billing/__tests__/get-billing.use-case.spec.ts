import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GetBillingUseCase } from '../application/get-billing.use-case.js';

describe('GetBillingUseCase', () => {
  let billingRepo: {
    findByOrgId: ReturnType<typeof vi.fn>;
    findEntitlementsByOrg: ReturnType<typeof vi.fn>;
    findEntitlement: ReturnType<typeof vi.fn>;
  };
  let txManager: { run: ReturnType<typeof vi.fn> };
  let useCase: GetBillingUseCase;

  const subscription = {
    id: 'sub-1',
    organizationId: 'org-1',
    stripeCustomerId: 'cus_123',
    stripeSubscriptionId: 'sub_123',
    status: 'active',
    billingCurrency: 'USD',
    currentPeriodEnd: new Date('2026-09-01T00:00:00Z'),
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    billingRepo = {
      findByOrgId: vi.fn().mockResolvedValue(subscription),
      findEntitlementsByOrg: vi.fn().mockResolvedValue([{ id: 'ent-1', moduleKey: 'crm', state: 'active' }]),
      findEntitlement: vi.fn().mockResolvedValue({
        id: 'ent-1',
        moduleKey: 'crm',
        state: 'active',
        trialStartedAt: null,
        trialEndsAt: null,
        activatedAt: new Date('2026-07-01T00:00:00Z'),
        disabledAt: null,
        purgeAfter: null,
        features: [],
        stripeSubscriptionItemId: 'si_1',
      }),
    };
    txManager = {
      run: vi.fn().mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn('tx')),
    };

    useCase = new GetBillingUseCase(billingRepo as never, txManager as never);
  });

  it('returns the subscription and full entitlement details', async () => {
    const result = await useCase.execute({ organizationId: 'org-1' });

    expect(result.subscription).toEqual({
      id: 'sub-1',
      stripeCustomerId: 'cus_123',
      status: 'active',
      billingCurrency: 'USD',
      currentPeriodEnd: '2026-09-01T00:00:00.000Z',
    });
    expect(result.entitlements).toEqual([
      {
        moduleKey: 'crm',
        state: 'active',
        trialStartedAt: null,
        trialEndsAt: null,
        activatedAt: '2026-07-01T00:00:00.000Z',
        accessUntil: null,
        features: [],
        // si_1 on the entitlement row → paid module (shows the period end).
        isPaid: true,
      },
    ]);
  });

  it('exposes the permanent trialStartedAt stamp so the UI can show the trial-used state', async () => {
    billingRepo.findEntitlement.mockResolvedValue({
      id: 'ent-1',
      moduleKey: 'crm',
      state: 'expired',
      trialStartedAt: new Date('2026-07-01T00:00:00Z'),
      trialEndsAt: new Date('2026-07-15T00:00:00Z'),
      activatedAt: null,
      disabledAt: null,
      purgeAfter: null,
      features: [],
      stripeSubscriptionItemId: null,
    });

    const result = await useCase.execute({ organizationId: 'org-1' });

    expect(result.entitlements[0]).toMatchObject({
      state: 'expired',
      trialStartedAt: '2026-07-01T00:00:00.000Z',
      trialEndsAt: '2026-07-15T00:00:00.000Z',
      accessUntil: null,
      isPaid: false,
    });
  });

  it('returns a null subscription when the org has none', async () => {
    billingRepo.findByOrgId.mockResolvedValue(undefined);
    billingRepo.findEntitlementsByOrg.mockResolvedValue([]);

    const result = await useCase.execute({ organizationId: 'org-1' });

    expect(result.subscription).toBeNull();
    expect(result.entitlements).toEqual([]);
  });

  it('returns an empty entitlements list when the org has none', async () => {
    billingRepo.findEntitlementsByOrg.mockResolvedValue([]);

    const result = await useCase.execute({ organizationId: 'org-1' });

    expect(result.subscription).not.toBeNull();
    expect(result.entitlements).toEqual([]);
  });

  it('normalizes a null currentPeriodEnd to null', async () => {
    billingRepo.findByOrgId.mockResolvedValue({ ...subscription, currentPeriodEnd: null });

    const result = await useCase.execute({ organizationId: 'org-1' });

    expect(result.subscription?.currentPeriodEnd).toBeNull();
  });
});
