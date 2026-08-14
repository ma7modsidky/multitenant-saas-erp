import { beforeEach, describe, expect, it, vi } from 'vitest';

import { UpdateModulePricingUseCase } from '../application/update-module-pricing.use-case.js';

describe('UpdateModulePricingUseCase (PLT-6 / PLT-4)', () => {
  let pricingRepo: { listWithCatalog: ReturnType<typeof vi.fn>; upsert: ReturnType<typeof vi.fn> };
  let moduleRegistryRepo: { getModule: ReturnType<typeof vi.fn> };
  let auditRepo: { insert: ReturnType<typeof vi.fn>; listByOrg: ReturnType<typeof vi.fn> };
  let useCase: UpdateModulePricingUseCase;

  const actor = { actorUserId: 'admin-1', actorEmail: 'admin@modubiz.app' };
  const input = {
    moduleKey: 'crm',
    priceMonthlyMinor: '2900',
    priceYearlyMinor: '29000',
    currency: 'usd',
    ...actor,
  };

  beforeEach(() => {
    pricingRepo = {
      listWithCatalog: vi.fn(),
      upsert: vi.fn().mockResolvedValue(undefined),
    };
    moduleRegistryRepo = {
      getModule: vi.fn().mockResolvedValue({ key: 'crm', name: 'CRM' }),
    };
    auditRepo = { insert: vi.fn().mockResolvedValue(undefined), listByOrg: vi.fn().mockResolvedValue([]) };
    useCase = new UpdateModulePricingUseCase(pricingRepo, moduleRegistryRepo as never, auditRepo);
  });

  it('PLT-6: rejects non-integer or negative minor-unit prices', async () => {
    await expect(useCase.execute({ ...input, priceMonthlyMinor: '29.5' })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      httpStatus: 400,
    });

    await expect(useCase.execute({ ...input, priceYearlyMinor: '-100' })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      httpStatus: 400,
    });
  });

  it('PLT-6: rejects a module that is not in the catalog', async () => {
    moduleRegistryRepo.getModule.mockResolvedValueOnce(undefined);
    await expect(useCase.execute(input)).rejects.toMatchObject({ code: 'NOT_FOUND', httpStatus: 404 });
  });

  it('PLT-6: normalizes currency to uppercase, upserts pricing, and audits', async () => {
    const result = await useCase.execute(input);

    expect(pricingRepo.upsert).toHaveBeenCalledWith({
      moduleKey: 'crm',
      priceMonthlyMinor: '2900',
      priceYearlyMinor: '29000',
      currency: 'USD',
      updatedBy: 'admin-1',
    });
    expect(auditRepo.insert).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ moduleKey: 'crm', currency: 'USD' });
  });
});
