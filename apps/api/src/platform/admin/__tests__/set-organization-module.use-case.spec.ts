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
  let auditRepo: { insert: ReturnType<typeof vi.fn> };
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
    auditRepo = { insert: vi.fn().mockResolvedValue(undefined) };
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
