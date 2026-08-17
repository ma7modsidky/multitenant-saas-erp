import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ConflictError, NotFoundError } from '../../../core/common/errors.js';
import { MODULE_BLOCKED, MODULE_DEPENDENCY_MISSING, MODULE_NOT_FOUND, TRIAL_ALREADY_USED } from '../domain/errors.js';
import { EnableModuleTrialUseCase } from '../application/enable-module-trial.use-case.js';

describe('EnableModuleTrialUseCase', () => {
  let billingRepo: {
    getModuleFromCatalog: ReturnType<typeof vi.fn>;
    findByOrgId: ReturnType<typeof vi.fn>;
    getOrganizationBaseCurrency: ReturnType<typeof vi.fn>;
    insert: ReturnType<typeof vi.fn>;
    findEntitlement: ReturnType<typeof vi.fn>;
    upsertEntitlement: ReturnType<typeof vi.fn>;
  };
  let stripe: {
    addSubscriptionItem: ReturnType<typeof vi.fn>;
    createCustomer: ReturnType<typeof vi.fn>;
    createSubscription: ReturnType<typeof vi.fn>;
  };
  let txManager: { run: ReturnType<typeof vi.fn> };
  let useCase: EnableModuleTrialUseCase;

  const moduleCatalog = {
    key: 'pos',
    stripePriceKey: 'price_pos_monthly',
    dependsOn: ['inventory'],
    trialDays: 14,
  };
  const inventoryEntitled = {
    id: 'ent-inventory',
    moduleKey: 'inventory',
    state: 'trialing',
    trialStartedAt: new Date(),
    trialEndsAt: new Date(),
    activatedAt: null,
    disabledAt: null,
    purgeAfter: null,
    features: [],
    stripeSubscriptionItemId: null,
  };

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
      getModuleFromCatalog: vi.fn().mockResolvedValue(moduleCatalog),
      findByOrgId: vi.fn().mockResolvedValue(subscription),
      getOrganizationBaseCurrency: vi.fn().mockResolvedValue('USD'),
      // The persisted subscription mirrors what the Stripe port returned.
      insert: vi.fn().mockImplementation((data: { id: string; stripeSubscriptionId: string }) => ({
        ...subscription,
        id: data.id,
        stripeSubscriptionId: data.stripeSubscriptionId,
      })),
      findEntitlement: vi
        .fn()
        .mockImplementation(async (_orgId: string, moduleKey: string) =>
          moduleKey === 'inventory' ? inventoryEntitled : undefined,
        ),
      upsertEntitlement: vi.fn().mockResolvedValue(undefined),
    };
    stripe = {
      addSubscriptionItem: vi.fn().mockResolvedValue({ subscriptionItemId: 'si_123' }),
      createCustomer: vi.fn().mockResolvedValue({ customerId: 'cus_fake_1' }),
      createSubscription: vi.fn().mockResolvedValue({
        subscriptionId: 'sub_fake_1',
        currentPeriodEnd: new Date('2026-10-01T00:00:00Z'),
      }),
    };
    txManager = {
      run: vi.fn().mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn('tx')),
    };

    useCase = new EnableModuleTrialUseCase(billingRepo as never, stripe as never, txManager as never);
  });

  const execute = () => useCase.execute({ organizationId: 'org-1', moduleKey: 'pos', userId: 'user-1' });

  it('BILL-8: dependency must be entitled before enabling the module', async () => {
    // Inventory is NOT entitled (no entitlement row → available state).
    billingRepo.findEntitlement.mockResolvedValue(undefined);

    await expect(execute()).rejects.toBeInstanceOf(ConflictError);
    await expect(execute()).rejects.toMatchObject({ code: MODULE_DEPENDENCY_MISSING });

    // No entitlement write and no Stripe item when the dependency gate fails.
    expect(billingRepo.upsertEntitlement).not.toHaveBeenCalled();
    expect(stripe.addSubscriptionItem).not.toHaveBeenCalled();
  });

  it('BILL-8: a read-only dependency (expired) still satisfies the dependency gate', async () => {
    // Only the DEPENDENCY is expired (read-only but entitled); the target
    // module itself never used a trial, so the fresh trial proceeds (BILL-2).
    billingRepo.findEntitlement.mockImplementation(async (_orgId: string, moduleKey: string) =>
      moduleKey === 'inventory' ? { ...inventoryEntitled, state: 'expired' } : undefined,
    );

    await expect(execute()).resolves.toBeUndefined();
    expect(billingRepo.upsertEntitlement).toHaveBeenCalled();
  });

  it('BILL-2: rejects a second trial when a trial is already active', async () => {
    billingRepo.findEntitlement.mockResolvedValue({ ...inventoryEntitled, state: 'trialing' });

    await expect(execute()).rejects.toBeInstanceOf(ConflictError);
    await expect(execute()).rejects.toMatchObject({ code: TRIAL_ALREADY_USED });
  });

  it('BILL-2: rejects enabling a module that is already actively subscribed', async () => {
    billingRepo.findEntitlement.mockResolvedValue({ ...inventoryEntitled, state: 'active' });

    await expect(execute()).rejects.toMatchObject({ code: TRIAL_ALREADY_USED });
  });

  it('PLT-8: rejects self-enabling a module blocked by the platform admin (block until paid)', async () => {
    billingRepo.findEntitlement.mockResolvedValue({ ...inventoryEntitled, state: 'blocked', trialStartedAt: null });

    await expect(execute()).rejects.toMatchObject({ code: MODULE_BLOCKED, httpStatus: 409 });
    expect(billingRepo.upsertEntitlement).not.toHaveBeenCalled();
  });

  it('BILL-2: rejects a fresh trial after a trial was already used — even from disabled', async () => {
    // The org disabled the module after its trial — the state is now 'disabled'
    // but trialStartedAt is permanent, so the trial can never be restarted
    // (no disable → re-enable reset loop).
    billingRepo.findEntitlement.mockImplementation(async (_orgId: string, moduleKey: string) => {
      if (moduleKey === 'inventory') return inventoryEntitled;
      if (moduleKey === 'pos') {
        return { ...inventoryEntitled, moduleKey: 'pos', state: 'disabled', trialStartedAt: new Date() };
      }
      return undefined;
    });

    await expect(execute()).rejects.toMatchObject({ code: TRIAL_ALREADY_USED });
    expect(billingRepo.upsertEntitlement).not.toHaveBeenCalled();
  });

  it('BILL-2: rejects a fresh trial when the trial already expired', async () => {
    billingRepo.findEntitlement.mockImplementation(async (_orgId: string, moduleKey: string) => {
      if (moduleKey === 'inventory') return inventoryEntitled;
      if (moduleKey === 'pos') {
        return { ...inventoryEntitled, moduleKey: 'pos', state: 'expired', trialStartedAt: new Date() };
      }
      return undefined;
    });

    await expect(execute()).rejects.toMatchObject({ code: TRIAL_ALREADY_USED });
  });

  it('throws MODULE_NOT_FOUND when the module is not in the catalog', async () => {
    billingRepo.getModuleFromCatalog.mockResolvedValue(undefined);

    await expect(execute()).rejects.toBeInstanceOf(NotFoundError);
    await expect(execute()).rejects.toMatchObject({ message: MODULE_NOT_FOUND });
  });

  it('BILL-1/BILL-2: bootstraps a base subscription when the org has none, then starts the trial', async () => {
    // Fresh org / dev environment — no subscription row exists yet.
    billingRepo.findByOrgId.mockResolvedValue(undefined);

    await execute();

    // The base subscription is created lazily (BILL-1) using the org currency.
    expect(stripe.createCustomer).toHaveBeenCalledWith('org-1', 'Organization', 'org-1@local.dev');
    expect(stripe.createSubscription).toHaveBeenCalledWith({
      customerId: 'cus_fake_1',
      billingCurrency: 'USD',
      priceKeys: [],
    });
    expect(billingRepo.insert).toHaveBeenCalled();

    // The trial item attaches to the freshly created subscription.
    expect(stripe.addSubscriptionItem).toHaveBeenCalledWith({
      subscriptionId: 'sub_fake_1',
      priceKey: 'price_pos_monthly',
    });
    expect(billingRepo.upsertEntitlement).toHaveBeenCalled();
  });

  it('BILL-2: falls back to USD when the org has no base currency', async () => {
    billingRepo.findByOrgId.mockResolvedValue(undefined);
    billingRepo.getOrganizationBaseCurrency.mockResolvedValue(undefined);

    await execute();

    expect(stripe.createSubscription).toHaveBeenCalledWith({
      customerId: 'cus_fake_1',
      billingCurrency: 'USD',
      priceKeys: [],
    });
  });

  it('BILL-2: starts a 14-day trial (state trialing, no card required) when trialDays > 0', async () => {
    await execute();

    expect(billingRepo.upsertEntitlement).toHaveBeenCalledTimes(2);
    const first = billingRepo.upsertEntitlement.mock.calls[0]?.[0] as {
      state: string;
      trialStartedAt: Date;
      trialEndsAt: Date;
    };
    expect(first.state).toBe('trialing');
    expect(first.trialStartedAt).toBeInstanceOf(Date);
    const trialEnd = first.trialEndsAt.getTime();
    const trialStart = first.trialStartedAt.getTime();
    expect(trialEnd - trialStart).toBeCloseTo(14 * 24 * 60 * 60 * 1000, -6);
  });

  it('PLAN 7.0.1: computes the plan-gated feature set at enable time from the catalog', async () => {
    await useCase.execute({ organizationId: 'org-1', moduleKey: 'pos', userId: 'user-1' });

    const first = billingRepo.upsertEntitlement.mock.calls[0]?.[0] as { features: string[] };
    // POS declares no plan-gated features — the enabled set is empty.
    expect(first.features).toEqual([]);
  });

  it('BILL-2: adds a Stripe subscription item for the module price key', async () => {
    await execute();

    expect(stripe.addSubscriptionItem).toHaveBeenCalledWith({
      subscriptionId: 'sub_123',
      priceKey: 'price_pos_monthly',
    });

    // The entitlement is updated with the Stripe subscription item id.
    const last = billingRepo.upsertEntitlement.mock.calls[1]?.[0] as { stripeSubscriptionItemId: string };
    expect(last.stripeSubscriptionItemId).toBe('si_123');
  });

  it('enables a module directly (skipTrial) when explicitly requested', async () => {
    await useCase.execute({ organizationId: 'org-1', moduleKey: 'pos', userId: 'user-1', skipTrial: true });

    const first = billingRepo.upsertEntitlement.mock.calls[0]?.[0] as { state: string };
    expect(first.state).toBe('active');
  });
});
