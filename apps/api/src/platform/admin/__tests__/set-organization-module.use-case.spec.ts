import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SetOrganizationModuleUseCase } from '../application/set-organization-module.use-case.js';

const CATALOG_CRM = { key: 'crm', stripePriceKey: 'price_crm', dependsOn: [], trialDays: 14 };
const CATALOG_POS = { key: 'pos', stripePriceKey: 'price_pos', dependsOn: ['inventory'], trialDays: 14 };
const CATALOG_INVENTORY = { key: 'inventory', stripePriceKey: null, dependsOn: [], trialDays: 14 };

describe('SetOrganizationModuleUseCase (PLT-3/4/5, BILL-8/9)', () => {
  let billingRepo: {
    getModuleFromCatalog: ReturnType<typeof vi.fn>;
    findByOrgId: ReturnType<typeof vi.fn>;
    findEntitlement: ReturnType<typeof vi.fn>;
    getDependentModules: ReturnType<typeof vi.fn>;
    getOrganizationBaseCurrency: ReturnType<typeof vi.fn>;
    insert: ReturnType<typeof vi.fn>;
    upsertEntitlement: ReturnType<typeof vi.fn>;
  };
  let stripe: {
    createCustomer: ReturnType<typeof vi.fn>;
    createSubscription: ReturnType<typeof vi.fn>;
    addSubscriptionItem: ReturnType<typeof vi.fn>;
    removeSubscriptionItem: ReturnType<typeof vi.fn>;
  };
  let auditRepo: { insert: ReturnType<typeof vi.fn>; listByOrg: ReturnType<typeof vi.fn> };
  let txManager: { runWithOrg: ReturnType<typeof vi.fn> };
  let useCase: SetOrganizationModuleUseCase;

  const actor = { actorUserId: 'admin-1', actorEmail: 'admin@modubiz.app' };
  const orgId = 'org-target';

  beforeEach(() => {
    billingRepo = {
      getModuleFromCatalog: vi.fn().mockResolvedValue(CATALOG_CRM),
      findByOrgId: vi.fn().mockResolvedValue(undefined),
      findEntitlement: vi.fn().mockResolvedValue(undefined),
      getDependentModules: vi.fn().mockResolvedValue([]),
      getOrganizationBaseCurrency: vi.fn().mockResolvedValue('USD'),
      insert: vi.fn().mockResolvedValue({ stripeSubscriptionId: 'sub_1' }),
      upsertEntitlement: vi.fn().mockResolvedValue(undefined),
    };
    stripe = {
      createCustomer: vi.fn().mockResolvedValue({ customerId: 'cus_1' }),
      createSubscription: vi.fn().mockResolvedValue({ subscriptionId: 'sub_1', currentPeriodEnd: new Date() }),
      addSubscriptionItem: vi.fn().mockResolvedValue({ subscriptionItemId: 'si_1' }),
      removeSubscriptionItem: vi.fn().mockResolvedValue(undefined),
    };
    auditRepo = { insert: vi.fn().mockResolvedValue(undefined), listByOrg: vi.fn().mockResolvedValue([]) };
    txManager = {
      // runWithOrg binds the TARGET org — the RLS-safe cross-tenant path (PLT-3).
      runWithOrg: vi.fn(async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) => fn('tx')),
    };
    useCase = new SetOrganizationModuleUseCase(billingRepo as never, stripe as never, auditRepo, txManager as never);
  });

  it('PLT-5/BILL-8: rejects enabling a module whose dependency is not entitled', async () => {
    billingRepo.getModuleFromCatalog.mockResolvedValue(CATALOG_POS);

    await expect(
      useCase.execute({ targetOrgId: orgId, moduleKey: 'pos', action: 'enable', ...actor }),
    ).rejects.toMatchObject({ code: 'MODULE_DEPENDENCY_MISSING', httpStatus: 409 });

    expect(billingRepo.upsertEntitlement).not.toHaveBeenCalled();
  });

  it('PLT-5/BILL-9: rejects disabling a module another entitled module depends on', async () => {
    billingRepo.getModuleFromCatalog.mockResolvedValue(CATALOG_INVENTORY);
    billingRepo.getDependentModules.mockResolvedValue(['pos']);
    // The target entitlement is active; the dependent POS entitlement is active too.
    billingRepo.findEntitlement.mockImplementation(async (_org: string, moduleKey: string) => {
      if (moduleKey === 'inventory') return { state: 'active', stripeSubscriptionItemId: null };
      if (moduleKey === 'pos') return { state: 'active', stripeSubscriptionItemId: null };
      return undefined;
    });

    await expect(
      useCase.execute({ targetOrgId: orgId, moduleKey: 'inventory', action: 'disable', ...actor }),
    ).rejects.toMatchObject({ code: 'MODULE_DEPENDENCY_CONFLICT', httpStatus: 409 });
  });

  it('PLT-5/BILL-2: admin cannot restart a trial once it was used (even from disabled)', async () => {
    // The org used its trial, then the module was disabled — the permanent
    // trialStartedAt stamp blocks a fresh trial, exactly like the tenant path.
    billingRepo.findEntitlement.mockResolvedValue({
      state: 'disabled',
      trialStartedAt: new Date(),
      stripeSubscriptionItemId: null,
    });

    await expect(
      useCase.execute({ targetOrgId: orgId, moduleKey: 'crm', action: 'enable', ...actor }),
    ).rejects.toMatchObject({ code: 'TRIAL_ALREADY_USED', httpStatus: 409 });
    expect(billingRepo.upsertEntitlement).not.toHaveBeenCalled();
  });

  it('PLT-5/BILL-2: admin can still grant the module directly (skipTrial) after a used trial', async () => {
    const stamp = new Date('2026-07-01T00:00:00Z');
    billingRepo.findEntitlement.mockResolvedValue({
      state: 'disabled',
      trialStartedAt: stamp,
      stripeSubscriptionItemId: null,
    });

    const result = await useCase.execute({
      targetOrgId: orgId,
      moduleKey: 'crm',
      action: 'enable',
      skipTrial: true,
      ...actor,
    });

    expect(result.message).toContain('enabled');
    // BILL-2: the full-access grant must PRESERVE the permanent stamp — wiping
    // it would let the org restart its trial through the tenant self-service.
    expect(billingRepo.upsertEntitlement).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: orgId, moduleKey: 'crm', state: 'active', trialStartedAt: stamp }),
      'tx',
    );
  });

  it('PLT-8: admin can override the trial length with trialDays when granting a trial', async () => {
    billingRepo.getModuleFromCatalog.mockResolvedValue({ ...CATALOG_CRM, trialDays: 14 });
    billingRepo.findEntitlement.mockResolvedValue(undefined);

    await useCase.execute({
      targetOrgId: orgId,
      moduleKey: 'crm',
      action: 'enable',
      trialDays: 30,
      ...actor,
    });

    const call = billingRepo.upsertEntitlement.mock.calls[0]?.[0] as { trialEndsAt: Date; state: string };
    expect(call.state).toBe('trialing');
    // 30 admin-specified days, not the 14-day catalog default.
    const approx = Date.now() + 30 * 24 * 60 * 60 * 1000;
    expect(Math.abs(call.trialEndsAt.getTime() - approx)).toBeLessThan(60_000);
  });

  it('PLT-8: full access grant on a module with no prior trial keeps the stamp null', async () => {
    billingRepo.findEntitlement.mockResolvedValue(undefined);

    await useCase.execute({
      targetOrgId: orgId,
      moduleKey: 'crm',
      action: 'enable',
      skipTrial: true,
      ...actor,
    });

    const call = billingRepo.upsertEntitlement.mock.calls[0]?.[0] as { trialStartedAt: Date | null; state: string };
    expect(call.state).toBe('active');
    expect(call.trialStartedAt).toBeNull();
  });

  it('BILL-14: a full-access grant is FREE — no Stripe customer/subscription/item is created', async () => {
    billingRepo.findEntitlement.mockResolvedValue(undefined);

    await useCase.execute({
      targetOrgId: orgId,
      moduleKey: 'crm',
      action: 'enable',
      skipTrial: true,
      ...actor,
    });

    // Grants never touch Stripe: no customer, no base subscription, no item.
    expect(stripe.createCustomer).not.toHaveBeenCalled();
    expect(stripe.createSubscription).not.toHaveBeenCalled();
    expect(stripe.addSubscriptionItem).not.toHaveBeenCalled();
    expect(billingRepo.insert).not.toHaveBeenCalled();
    // Unlimited by default — accessUntil stays null.
    const call = billingRepo.upsertEntitlement.mock.calls[0]?.[0] as { state: string; accessUntil: Date | null };
    expect(call.state).toBe('active');
    expect(call.accessUntil).toBeNull();
  });

  it('PLT-8: a full-access grant can be bounded with accessUntil', async () => {
    billingRepo.findEntitlement.mockResolvedValue(undefined);
    const until = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    await useCase.execute({
      targetOrgId: orgId,
      moduleKey: 'crm',
      action: 'enable',
      skipTrial: true,
      accessUntil: until.toISOString(),
      ...actor,
    });

    const call = billingRepo.upsertEntitlement.mock.calls[0]?.[0] as { accessUntil: Date };
    expect(call.accessUntil).toBeInstanceOf(Date);
    expect(Math.abs(call.accessUntil.getTime() - until.getTime())).toBeLessThan(1000);
    expect(stripe.addSubscriptionItem).not.toHaveBeenCalled();
  });

  it('PLT-8/BILL-14: a free grant removes a leftover paid Stripe item so billing stops', async () => {
    billingRepo.findEntitlement.mockResolvedValue({
      state: 'expired',
      trialStartedAt: null,
      stripeSubscriptionItemId: 'si_stale',
    });

    await useCase.execute({
      targetOrgId: orgId,
      moduleKey: 'crm',
      action: 'enable',
      skipTrial: true,
      ...actor,
    });

    expect(stripe.removeSubscriptionItem).toHaveBeenCalledWith('si_stale');
    expect(billingRepo.upsertEntitlement).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: orgId,
        moduleKey: 'crm',
        state: 'active',
        stripeSubscriptionItemId: null,
      }),
      'tx',
    );
  });

  it('PLT-8: enabling a blocked module grants full access (blocked → active)', async () => {
    billingRepo.findEntitlement.mockResolvedValue({
      state: 'blocked',
      trialStartedAt: null,
      stripeSubscriptionItemId: null,
    });

    await useCase.execute({
      targetOrgId: orgId,
      moduleKey: 'crm',
      action: 'enable',
      skipTrial: true,
      ...actor,
    });

    expect(billingRepo.upsertEntitlement).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: orgId, moduleKey: 'crm', state: 'active' }),
      'tx',
    );
  });

  it('PLT-3/PLT-4: enable grants access via runWithOrg (target org) and audits', async () => {
    const result = await useCase.execute({ targetOrgId: orgId, moduleKey: 'crm', action: 'enable', ...actor });

    expect(txManager.runWithOrg).toHaveBeenCalled();
    expect(stripe.addSubscriptionItem).toHaveBeenCalledWith({
      subscriptionId: 'sub_1',
      priceKey: 'price_crm',
    });
    expect(billingRepo.upsertEntitlement).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: orgId, moduleKey: 'crm', state: 'trialing' }),
      'tx',
    );
    expect(auditRepo.insert).toHaveBeenCalledTimes(1);
    expect(result.message).toContain('enabled');
  });

  it('PLT-3/PLT-4: disable revokes access via runWithOrg (target org) and audits', async () => {
    billingRepo.getModuleFromCatalog.mockResolvedValue(CATALOG_INVENTORY);
    billingRepo.findEntitlement.mockResolvedValue({ state: 'active', stripeSubscriptionItemId: null });

    const result = await useCase.execute({ targetOrgId: orgId, moduleKey: 'inventory', action: 'disable', ...actor });

    expect(billingRepo.upsertEntitlement).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: orgId, moduleKey: 'inventory', state: 'disabled' }),
      'tx',
    );
    expect(auditRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'module.disabled', entityId: orgId }),
    );
    expect(result.message).toContain('disabled');
  });
});
