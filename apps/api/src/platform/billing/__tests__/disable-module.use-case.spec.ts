import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ConflictError, DomainError, NotFoundError } from '../../../core/common/errors.js';
import { ENTITLEMENT_NOT_FOUND, INVALID_STATE_TRANSITION, MODULE_DEPENDENCY_CONFLICT } from '../domain/errors.js';
import { DisableModuleUseCase } from '../application/disable-module.use-case.js';

describe('DisableModuleUseCase', () => {
  let billingRepo: {
    findEntitlement: ReturnType<typeof vi.fn>;
    getDependentModules: ReturnType<typeof vi.fn>;
    upsertEntitlement: ReturnType<typeof vi.fn>;
  };
  let stripe: {
    removeSubscriptionItem: ReturnType<typeof vi.fn>;
  };
  let txManager: { run: ReturnType<typeof vi.fn> };
  let useCase: DisableModuleUseCase;

  const activeEntitlement = {
    id: 'ent-1',
    moduleKey: 'inventory',
    state: 'active',
    trialStartedAt: null,
    trialEndsAt: null,
    activatedAt: new Date(),
    disabledAt: null,
    purgeAfter: null,
    features: [],
    stripeSubscriptionItemId: 'si_inventory',
  };

  beforeEach(() => {
    billingRepo = {
      findEntitlement: vi.fn().mockResolvedValue(activeEntitlement),
      getDependentModules: vi.fn().mockResolvedValue([]),
      upsertEntitlement: vi.fn().mockResolvedValue(undefined),
    };
    stripe = {
      removeSubscriptionItem: vi.fn().mockResolvedValue(undefined),
    };
    txManager = {
      run: vi.fn().mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn('tx')),
    };

    useCase = new DisableModuleUseCase(billingRepo as never, stripe as never, txManager as never);
  });

  const execute = () => useCase.execute({ organizationId: 'org-1', moduleKey: 'inventory' });

  it('throws ENTITLEMENT_NOT_FOUND when the module is not entitled', async () => {
    billingRepo.findEntitlement.mockResolvedValue(undefined);

    await expect(execute()).rejects.toBeInstanceOf(NotFoundError);
    await expect(execute()).rejects.toMatchObject({ message: ENTITLEMENT_NOT_FOUND });
  });

  it('BILL-9: rejects disabling a module that an entitled module depends on', async () => {
    billingRepo.getDependentModules.mockResolvedValue(['pos']);
    billingRepo.findEntitlement.mockImplementation(async (_orgId: string, moduleKey: string) =>
      moduleKey === 'pos' ? { ...activeEntitlement, moduleKey: 'pos', state: 'active' } : activeEntitlement,
    );

    await expect(execute()).rejects.toBeInstanceOf(ConflictError);
    await expect(execute()).rejects.toMatchObject({ code: MODULE_DEPENDENCY_CONFLICT });

    // Stripe item is NOT removed and the entitlement is NOT disabled.
    expect(stripe.removeSubscriptionItem).not.toHaveBeenCalled();
    expect(billingRepo.upsertEntitlement).not.toHaveBeenCalled();
  });

  it('BILL-9: allows disabling when the dependent module is only trialing-readonly-available', async () => {
    billingRepo.getDependentModules.mockResolvedValue(['pos']);
    // The dependent module is NOT in an entitled writable state.
    billingRepo.findEntitlement.mockImplementation(async (_orgId: string, moduleKey: string) =>
      moduleKey === 'pos' ? undefined : activeEntitlement,
    );

    await expect(execute()).resolves.toBeUndefined();
    expect(stripe.removeSubscriptionItem).toHaveBeenCalledWith('si_inventory');
  });

  it('BILL-7: disables the entitlement and sets purge_after from the retention policy', async () => {
    await execute();

    expect(billingRepo.upsertEntitlement).toHaveBeenCalledTimes(1);
    const update = billingRepo.upsertEntitlement.mock.calls[0]?.[0] as {
      state: string;
      disabledAt: Date;
      purgeAfter: Date;
      stripeSubscriptionItemId: null;
    };
    expect(update.state).toBe('disabled');
    expect(update.disabledAt).toBeInstanceOf(Date);
    expect(update.purgeAfter).toBeInstanceOf(Date);
    // purge_after defaults to 30 days (BILL-7 dataRetention.onDisableDays default).
    expect(update.purgeAfter.getTime() - update.disabledAt.getTime()).toBeCloseTo(30 * 24 * 60 * 60 * 1000, -6);
    expect(update.stripeSubscriptionItemId).toBeNull();
  });

  it('BILL-7: removes the Stripe subscription item when one exists', async () => {
    await execute();
    expect(stripe.removeSubscriptionItem).toHaveBeenCalledWith('si_inventory');
  });

  it('BILL-7: does not call Stripe when the entitlement has no subscription item', async () => {
    billingRepo.findEntitlement.mockResolvedValue({ ...activeEntitlement, stripeSubscriptionItemId: null });

    await execute();
    expect(stripe.removeSubscriptionItem).not.toHaveBeenCalled();
  });

  it('rejects an illegal state transition to disabled (e.g. from trialing via Stripe)', async () => {
    // trialing → disabled is a VALID transition per the state machine, so use a
    // state with no path to disabled: suspended (only → active).
    billingRepo.findEntitlement.mockResolvedValue({ ...activeEntitlement, state: 'suspended' });

    await expect(execute()).rejects.toBeInstanceOf(DomainError);
    await expect(execute()).rejects.toMatchObject({ code: INVALID_STATE_TRANSITION });
  });
});
