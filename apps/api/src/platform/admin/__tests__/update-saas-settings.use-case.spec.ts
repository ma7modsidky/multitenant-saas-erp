import { beforeEach, describe, expect, it, vi } from 'vitest';

import { UNKNOWN_SAAS_SETTING } from '../domain/index.js';
import { UpdateSaasSettingsUseCase } from '../application/update-saas-settings.use-case.js';

describe('UpdateSaasSettingsUseCase (PLT-7 / PLT-4)', () => {
  let settingsRepo: { getAll: ReturnType<typeof vi.fn>; set: ReturnType<typeof vi.fn> };
  let auditRepo: { insert: ReturnType<typeof vi.fn>; listByOrg: ReturnType<typeof vi.fn> };
  let useCase: UpdateSaasSettingsUseCase;

  const actor = { actorUserId: 'admin-1', actorEmail: 'admin@modubiz.app' };

  beforeEach(() => {
    settingsRepo = {
      getAll: vi.fn().mockResolvedValue([]),
      set: vi.fn().mockResolvedValue(undefined),
    };
    auditRepo = { insert: vi.fn().mockResolvedValue(undefined), listByOrg: vi.fn().mockResolvedValue([]) };
    useCase = new UpdateSaasSettingsUseCase(settingsRepo, auditRepo);
  });

  it('PLT-7: rejects an unknown settings key with 400 UNKNOWN_SAAS_SETTING', async () => {
    await expect(useCase.execute({ settings: { totallyNotARealKey: 1 }, ...actor })).rejects.toMatchObject({
      code: UNKNOWN_SAAS_SETTING,
      httpStatus: 400,
    });
    expect(settingsRepo.set).not.toHaveBeenCalled();
  });

  it('PLT-7: validates value types per key', async () => {
    await expect(useCase.execute({ settings: { trialDurationDays: '14' }, ...actor })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });

    await expect(useCase.execute({ settings: { trialDurationDays: 0 }, ...actor })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });

    await expect(useCase.execute({ settings: { allowSelfSignup: 'yes' }, ...actor })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });

    await expect(useCase.execute({ settings: { platformName: '' }, ...actor })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });

  it('PLT-4: persists valid settings and appends one audit entry with before/after', async () => {
    settingsRepo.getAll
      .mockResolvedValueOnce([{ key: 'platformName', value: 'Old', updatedAt: new Date() }])
      .mockResolvedValueOnce([{ key: 'platformName', value: 'New', updatedAt: new Date() }]);

    const result = await useCase.execute({
      settings: { platformName: 'New', allowSelfSignup: true },
      ...actor,
    });

    expect(settingsRepo.set).toHaveBeenCalledWith('platformName', 'New', 'admin-1');
    expect(settingsRepo.set).toHaveBeenCalledWith('allowSelfSignup', true, 'admin-1');
    expect(auditRepo.insert).toHaveBeenCalledTimes(1);
    const entry = auditRepo.insert.mock.calls[0]![0] as { action: string; before: unknown; after: unknown };
    expect(entry.action).toBe('settings.updated');
    expect(entry.before).toEqual({ platformName: 'Old' });
    expect(entry.after).toEqual({ platformName: 'New' });
    expect(result).toEqual({ platformName: 'New', allowSelfSignup: true });
  });
});
