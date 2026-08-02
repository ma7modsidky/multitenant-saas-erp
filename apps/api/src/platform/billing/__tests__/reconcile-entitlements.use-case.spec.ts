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

  it('BILL-4: Stripe wins — a suspended module present in Stripe is reactivated', async () => {
    billingRepo.findEntitlementsByOrg.mockResolvedValue([{ id: 'ent-1', moduleKey: 'crm', state: 'suspended' }]);

    const result = await useCase.execute({ organizationId: 'org-1' });

    expect(result.updated).toBe(1);
    expect(result.alerts).toHaveLength(1);
    expect(result.alerts[0]).toMatch(/reactivated/);
    expect(billingRepo.updateEntitlementState).toHaveBeenCalledWith('org-1', 'crm', 'active', 'tx');
  });

  it('BILL-4: Stripe wins — a local active module missing from Stripe is disabled', async () => {
    billingRepo.findEntitlementsByOrg.mockResolvedValue([
      { id: 'ent-1', moduleKey: 'crm', state: 'active' },
      { id: 'ent-2', moduleKey: 'inventory', state: 'active' },
    ]);
    stripe.getSubscriptionItems.mockResolvedValue([{ id: 'si_1', priceKey: 'crm' }]);

    const result = await useCase.execute({ organizationId: 'org-1' });

    expect(result.updated).toBe(1);
    expect(result.alerts[0]).toMatch(/not found in Stripe/);
    // CRM stays active (in Stripe); Inventory is disabled (not in Stripe).
    expect(billingRepo.updateEntitlementState).toHaveBeenCalledTimes(1);
    expect(billingRepo.updateEntitlementState).toHaveBeenCalledWith('org-1', 'inventory', 'disabled', 'tx');
  });

  it('reports an alert when the org has no subscription', async () => {
    billingRepo.findByOrgId.mockResolvedValue(undefined);

    const result = await useCase.execute({ organizationId: 'org-1' });

    expect(result).toEqual({ updated: 0, alerts: ['No subscription found'] });
    expect(stripe.getSubscriptionItems).not.toHaveBeenCalled();
  });

  it('is a no-op when local state already matches Stripe', async () => {
    billingRepo.findEntitlementsByOrg.mockResolvedValue([{ id: 'ent-1', moduleKey: 'crm', state: 'active' }]);
    stripe.getSubscriptionItems.mockResolvedValue([{ id: 'si_1', priceKey: 'crm' }]);

    const result = await useCase.execute({ organizationId: 'org-1' });

    expect(result.updated).toBe(0);
    expect(result.alerts).toEqual([]);
    expect(billingRepo.updateEntitlementState).not.toHaveBeenCalled();
  });

  it('leaves read-only/disabled states untouched (they are not active)', async () => {
    billingRepo.findEntitlementsByOrg.mockResolvedValue([
      { id: 'ent-1', moduleKey: 'crm', state: 'expired' },
      { id: 'ent-2', moduleKey: 'inventory', state: 'disabled' },
    ]);

    const result = await useCase.execute({ organizationId: 'org-1' });

    expect(result.updated).toBe(0);
    expect(billingRepo.updateEntitlementState).not.toHaveBeenCalled();
  });
});
