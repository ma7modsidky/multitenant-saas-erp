import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ReconcileEntitlementsUseCase } from '../application/reconcile-entitlements.use-case.js';

describe('ReconcileEntitlementsUseCase (BILL-4)', () => {
  let billingRepo: {
    findByOrgId: ReturnType<typeof vi.fn>;
    findEntitlementsByOrg: ReturnType<typeof vi.fn>;
    updateEntitlementState: ReturnType<typeof vi.fn>;
  };
  let stripe: {
    getSubscriptionItems: ReturnType<typeof vi.fn>;
  };
  let txManager: { run: ReturnType<typeof vi.fn> };
  let useCase: ReconcileEntitlementsUseCase;

  const subscription = {
    id: 'sub-1',
    organizationId: 'org-1',
    stripeCustomerId: 'cus_123',
    stripeSubscriptionId: 'sub_123',
    status: 'active',
    billingCurrency: 'USD',
    currentPeriodEnd: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    billingRepo = {
      findByOrgId: vi.fn().mockResolvedValue(subscription),
      findEntitlementsByOrg: vi.fn().mockResolvedValue([]),
      updateEntitlementState: vi.fn().mockResolvedValue(undefined),
    };
    stripe = {
      getSubscriptionItems: vi.fn().mockResolvedValue([{ id: 'si_1', priceKey: 'crm' }]),
    };
    txManager = {
      run: vi.fn().mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn('tx')),
    };

    useCase = new ReconcileEntitlementsUseCase(billingRepo as never, stripe as never, txManager as never);
  });

  it('BILL-4: Stripe wins — a suspended PAID module present in Stripe is reactivated', async () => {
    billingRepo.findEntitlementsByOrg.mockResolvedValue([
      {
        id: 'ent-1',
        moduleKey: 'crm',
        state: 'suspended',
        stripeSubscriptionItemId: 'si_1',
        trialEndsAt: null,
        accessUntil: null,
      },
    ]);

    const result = await useCase.execute({ organizationId: 'org-1' });

    expect(result.updated).toBe(1);
    expect(result.alerts).toHaveLength(1);
    expect(result.alerts[0]).toMatch(/reactivated/);
    expect(billingRepo.updateEntitlementState).toHaveBeenCalledWith('org-1', 'crm', 'active', 'tx');
  });

  it('BILL-4: Stripe wins — a local PAID module missing from Stripe is disabled', async () => {
    billingRepo.findEntitlementsByOrg.mockResolvedValue([
      {
        id: 'ent-1',
        moduleKey: 'crm',
        state: 'active',
        stripeSubscriptionItemId: 'si_1',
        trialEndsAt: null,
        accessUntil: null,
      },
      {
        id: 'ent-2',
        moduleKey: 'inventory',
        state: 'active',
        stripeSubscriptionItemId: 'si_2',
        trialEndsAt: null,
        accessUntil: null,
      },
    ]);
    stripe.getSubscriptionItems.mockResolvedValue([{ id: 'si_1', priceKey: 'crm' }]);

    const result = await useCase.execute({ organizationId: 'org-1' });

    expect(result.updated).toBe(1);
    expect(result.alerts[0]).toMatch(/not found in Stripe/);
    // CRM stays active (in Stripe); Inventory is disabled (not in Stripe).
    expect(billingRepo.updateEntitlementState).toHaveBeenCalledTimes(1);
    expect(billingRepo.updateEntitlementState).toHaveBeenCalledWith('org-1', 'inventory', 'disabled', 'tx');
  });

  it('BILL-14: a FREE admin grant (no Stripe item) is never reconciled against Stripe', async () => {
    // Active, no Stripe item, unlimited grant — Stripe has no such module item.
    billingRepo.findEntitlementsByOrg.mockResolvedValue([
      {
        id: 'ent-1',
        moduleKey: 'crm',
        state: 'active',
        stripeSubscriptionItemId: null,
        trialEndsAt: null,
        accessUntil: null,
      },
    ]);
    stripe.getSubscriptionItems.mockResolvedValue([]);

    const result = await useCase.execute({ organizationId: 'org-1' });

    expect(result.updated).toBe(0);
    expect(billingRepo.updateEntitlementState).not.toHaveBeenCalled();
  });

  it('BILL-3: a lapsed trial moves to expired (read-only grace)', async () => {
    billingRepo.findEntitlementsByOrg.mockResolvedValue([
      {
        id: 'ent-1',
        moduleKey: 'crm',
        state: 'trialing',
        stripeSubscriptionItemId: 'si_1',
        trialEndsAt: new Date(Date.now() - 1000),
        accessUntil: null,
      },
    ]);

    const result = await useCase.execute({ organizationId: 'org-1' });

    expect(result.updated).toBe(1);
    expect(result.alerts[0]).toMatch(/trial expired/);
    expect(billingRepo.updateEntitlementState).toHaveBeenCalledWith('org-1', 'crm', 'expired', 'tx');
  });

  it('BILL-14: a lapsed time-boxed free grant moves to expired', async () => {
    billingRepo.findEntitlementsByOrg.mockResolvedValue([
      {
        id: 'ent-1',
        moduleKey: 'crm',
        state: 'active',
        stripeSubscriptionItemId: null,
        trialEndsAt: null,
        accessUntil: new Date(Date.now() - 1000),
      },
    ]);

    const result = await useCase.execute({ organizationId: 'org-1' });

    expect(result.updated).toBe(1);
    expect(result.alerts[0]).toMatch(/grant access ended/);
    expect(billingRepo.updateEntitlementState).toHaveBeenCalledWith('org-1', 'crm', 'expired', 'tx');
  });

  it('BILL-14: an unexpired free grant is left untouched', async () => {
    billingRepo.findEntitlementsByOrg.mockResolvedValue([
      {
        id: 'ent-1',
        moduleKey: 'crm',
        state: 'active',
        stripeSubscriptionItemId: null,
        trialEndsAt: null,
        accessUntil: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
      },
    ]);

    const result = await useCase.execute({ organizationId: 'org-1' });

    expect(result.updated).toBe(0);
    expect(billingRepo.updateEntitlementState).not.toHaveBeenCalled();
  });

  it('reports an alert when the org has no subscription', async () => {
    billingRepo.findByOrgId.mockResolvedValue(undefined);

    const result = await useCase.execute({ organizationId: 'org-1' });

    expect(result).toEqual({ updated: 0, alerts: ['No subscription found'] });
    expect(stripe.getSubscriptionItems).not.toHaveBeenCalled();
  });

  it('is a no-op when local state already matches Stripe', async () => {
    billingRepo.findEntitlementsByOrg.mockResolvedValue([
      {
        id: 'ent-1',
        moduleKey: 'crm',
        state: 'active',
        stripeSubscriptionItemId: 'si_1',
        trialEndsAt: null,
        accessUntil: null,
      },
    ]);
    stripe.getSubscriptionItems.mockResolvedValue([{ id: 'si_1', priceKey: 'crm' }]);

    const result = await useCase.execute({ organizationId: 'org-1' });

    expect(result.updated).toBe(0);
    expect(result.alerts).toEqual([]);
    expect(billingRepo.updateEntitlementState).not.toHaveBeenCalled();
  });

  it('leaves read-only/disabled states untouched (they are not active)', async () => {
    billingRepo.findEntitlementsByOrg.mockResolvedValue([
      {
        id: 'ent-1',
        moduleKey: 'crm',
        state: 'expired',
        stripeSubscriptionItemId: null,
        trialEndsAt: new Date('2026-01-01T00:00:00Z'),
        accessUntil: null,
      },
      {
        id: 'ent-2',
        moduleKey: 'inventory',
        state: 'disabled',
        stripeSubscriptionItemId: null,
        trialEndsAt: null,
        accessUntil: null,
      },
    ]);

    const result = await useCase.execute({ organizationId: 'org-1' });

    expect(result.updated).toBe(0);
    expect(billingRepo.updateEntitlementState).not.toHaveBeenCalled();
  });
});
