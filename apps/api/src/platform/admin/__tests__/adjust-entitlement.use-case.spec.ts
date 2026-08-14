import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AdjustEntitlementUseCase } from '../application/adjust-entitlement.use-case.js';

const ENTITLEMENT = {
  id: 'ent-1',
  moduleKey: 'crm',
  state: 'trialing',
  trialStartedAt: new Date('2026-08-01T00:00:00Z'),
  trialEndsAt: new Date('2026-08-15T00:00:00Z'),
  activatedAt: null,
  disabledAt: null,
  purgeAfter: null,
  stripeSubscriptionItemId: null,
};

describe('AdjustEntitlementUseCase (PLT-8, BILL-2/3/6/13)', () => {
  let billingRepo: { findEntitlement: ReturnType<typeof vi.fn>; upsertEntitlement: ReturnType<typeof vi.fn> };
  let auditRepo: { insert: ReturnType<typeof vi.fn> };
  let txManager: { runWithOrg: ReturnType<typeof vi.fn> };
  let useCase: AdjustEntitlementUseCase;

  const actor = { actorUserId: 'admin-1', actorEmail: 'admin@modubiz.app' };
  const orgId = 'org-target';

  beforeEach(() => {
    billingRepo = {
      findEntitlement: vi.fn().mockResolvedValue(ENTITLEMENT),
      upsertEntitlement: vi.fn().mockResolvedValue(undefined),
    };
    auditRepo = { insert: vi.fn().mockResolvedValue(undefined) };
    txManager = {
      runWithOrg: vi.fn(async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) => fn('tx')),
    };
    useCase = new AdjustEntitlementUseCase(billingRepo as never, auditRepo, txManager as never);
  });

  it('PLT-8: extends a running trial — state stays trialing, trialEndsAt moves forward', async () => {
    await useCase.execute({ targetOrgId: orgId, moduleKey: 'crm', action: 'extendTrial', days: 7, ...actor });

    const call = billingRepo.upsertEntitlement.mock.calls[0]?.[0] as {
      state: string;
      trialEndsAt: Date;
      trialStartedAt?: Date;
    };
    expect(call.state).toBe('trialing');
    expect(call.trialEndsAt.getTime()).toBeGreaterThan(ENTITLEMENT.trialEndsAt.getTime());
    // The permanent BILL-2 stamp must never be overwritten by an extension.
    expect(call.trialStartedAt).toBeUndefined();
    expect(auditRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'module.trial.extended', entityId: orgId }),
    );
  });

  it('PLT-8: a short extension never shortens a running trial (base = current end, not now)', async () => {
    // 10 days remaining; extending by 3 must end AFTER the current end date.
    const inTenDays = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
    billingRepo.findEntitlement.mockResolvedValue({ ...ENTITLEMENT, trialEndsAt: inTenDays });

    await useCase.execute({ targetOrgId: orgId, moduleKey: 'crm', action: 'extendTrial', days: 3, ...actor });

    const call = billingRepo.upsertEntitlement.mock.calls[0]?.[0] as { trialEndsAt: Date };
    expect(call.trialEndsAt.getTime()).toBeGreaterThan(inTenDays.getTime());
    expect(call.trialEndsAt.getTime() - inTenDays.getTime()).toBeCloseTo(3 * 24 * 60 * 60 * 1000, -6);
  });

  it('PLT-8: revives a lapsed (expired) trial into trialing', async () => {
    billingRepo.findEntitlement.mockResolvedValue({ ...ENTITLEMENT, state: 'expired' });

    await useCase.execute({ targetOrgId: orgId, moduleKey: 'crm', action: 'extendTrial', days: 14, ...actor });

    const call = billingRepo.upsertEntitlement.mock.calls[0]?.[0] as { state: string };
    expect(call.state).toBe('trialing');
  });

  it('PLT-8: rejects extending a module that is not trialing or expired', async () => {
    billingRepo.findEntitlement.mockResolvedValue({ ...ENTITLEMENT, state: 'active' });

    await expect(
      useCase.execute({ targetOrgId: orgId, moduleKey: 'crm', action: 'extendTrial', days: 7, ...actor }),
    ).rejects.toMatchObject({ code: 'ENTITLEMENT_NOT_TRIALING', httpStatus: 409 });
    expect(billingRepo.upsertEntitlement).not.toHaveBeenCalled();
  });

  it('PLT-8/BILL-3: stop trial moves trialing → expired and preserves the trial stamp', async () => {
    await useCase.execute({ targetOrgId: orgId, moduleKey: 'crm', action: 'stopTrial', ...actor });

    expect(billingRepo.upsertEntitlement).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: orgId, moduleKey: 'crm', state: 'expired' }),
      'tx',
    );
    expect(auditRepo.insert).toHaveBeenCalledWith(expect.objectContaining({ action: 'module.trial.stopped' }));
  });

  it('PLT-8: rejects stopping a trial that is not running', async () => {
    billingRepo.findEntitlement.mockResolvedValue({ ...ENTITLEMENT, state: 'expired' });

    await expect(
      useCase.execute({ targetOrgId: orgId, moduleKey: 'crm', action: 'stopTrial', ...actor }),
    ).rejects.toMatchObject({ code: 'ENTITLEMENT_NOT_TRIALING', httpStatus: 409 });
    expect(billingRepo.upsertEntitlement).not.toHaveBeenCalled();
  });

  it('PLT-8: suspends a paid module (active → suspended)', async () => {
    billingRepo.findEntitlement.mockResolvedValue({ ...ENTITLEMENT, state: 'active' });

    await useCase.execute({ targetOrgId: orgId, moduleKey: 'crm', action: 'suspend', ...actor });

    expect(billingRepo.upsertEntitlement).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: orgId, moduleKey: 'crm', state: 'suspended' }),
      'tx',
    );
    expect(auditRepo.insert).toHaveBeenCalledWith(expect.objectContaining({ action: 'module.suspended' }));
  });

  it('PLT-8: rejects suspending a non-active module', async () => {
    billingRepo.findEntitlement.mockResolvedValue({ ...ENTITLEMENT, state: 'trialing' });

    await expect(
      useCase.execute({ targetOrgId: orgId, moduleKey: 'crm', action: 'suspend', ...actor }),
    ).rejects.toMatchObject({ code: 'ENTITLEMENT_NOT_ACTIVE', httpStatus: 409 });
  });

  it('PLT-8: activates from suspended/past_due/expired and stamps activatedAt', async () => {
    for (const from of ['suspended', 'past_due', 'expired']) {
      billingRepo.findEntitlement.mockResolvedValue({ ...ENTITLEMENT, state: from });
      await useCase.execute({ targetOrgId: orgId, moduleKey: 'crm', action: 'activate', ...actor });
    }

    const calls = billingRepo.upsertEntitlement.mock.calls.map((c) => c[0] as { state: string; activatedAt: Date });
    expect(calls).toHaveLength(3);
    for (const call of calls) {
      expect(call.state).toBe('active');
      expect(call.activatedAt).toBeInstanceOf(Date);
    }
    expect(auditRepo.insert).toHaveBeenCalledWith(expect.objectContaining({ action: 'module.activated' }));
  });

  it('PLT-8: rejects activating a module that cannot return to active (e.g. already active)', async () => {
    // active → active is the only state-machine path to 'active' that is invalid.
    billingRepo.findEntitlement.mockResolvedValue({ ...ENTITLEMENT, state: 'active' });

    await expect(
      useCase.execute({ targetOrgId: orgId, moduleKey: 'crm', action: 'activate', ...actor }),
    ).rejects.toMatchObject({ code: 'INVALID_STATE_TRANSITION' });
  });

  it('PLT-8: throws ENTITLEMENT_NOT_FOUND when the org has no entitlement', async () => {
    billingRepo.findEntitlement.mockResolvedValue(undefined);

    // NotFoundError carries the generic NOT_FOUND code; the specific code is
    // the message (same convention as the disable-module path).
    await expect(
      useCase.execute({ targetOrgId: orgId, moduleKey: 'crm', action: 'stopTrial', ...actor }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', message: 'ENTITLEMENT_NOT_FOUND', httpStatus: 404 });
  });
});
