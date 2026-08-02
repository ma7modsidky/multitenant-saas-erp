import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DomainError, NotFoundError } from '../../../core/common/errors.js';
import { Organization, type OrganizationData } from '../domain/index.js';
import { UpdateOrganizationUseCase } from '../application/update-organization.use-case.js';

function makeOrg(overrides: Partial<OrganizationData> = {}): OrganizationData {
  return {
    id: 'org-1',
    name: 'Acme Inc',
    slug: 'acme',
    countryCode: 'US',
    timezone: 'UTC',
    baseCurrency: 'USD',
    defaultLocale: 'en',
    status: 'active',
    deletionScheduledAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('UpdateOrganizationUseCase (CUR-1)', () => {
  let orgRepo: { findById: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  let txManager: { run: ReturnType<typeof vi.fn> };
  let useCase: UpdateOrganizationUseCase;

  beforeEach(() => {
    orgRepo = {
      findById: vi.fn().mockResolvedValue(makeOrg()),
      update: vi
        .fn()
        .mockImplementation(async (_id: string, data: unknown) => Promise.resolve(data as OrganizationData)),
    };
    txManager = {
      run: vi.fn().mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn('tx')),
    };

    useCase = new UpdateOrganizationUseCase(orgRepo as never, txManager as never);
  });

  it('updates allowed profile fields', async () => {
    const result = await useCase.execute({
      organizationId: 'org-1',
      name: 'Acme 2',
      timezone: 'Europe/Paris',
      defaultLocale: 'fr',
    });

    expect(result.name).toBe('Acme 2');
    expect(result.timezone).toBe('Europe/Paris');
    expect(result.defaultLocale).toBe('fr');
  });

  it('CUR-1: allows changing the base currency when no monetary records exist', async () => {
    const result = await useCase.execute({ organizationId: 'org-1', baseCurrency: 'EUR', hasMonetaryRecords: false });

    expect(result.baseCurrency).toBe('EUR');
  });

  it('CUR-1: rejects changing the base currency once monetary records exist', async () => {
    await expect(
      useCase.execute({ organizationId: 'org-1', baseCurrency: 'EUR', hasMonetaryRecords: true }),
    ).rejects.toBeInstanceOf(DomainError);
    await expect(
      useCase.execute({ organizationId: 'org-1', baseCurrency: 'EUR', hasMonetaryRecords: true }),
    ).rejects.toMatchObject({ code: 'BASE_CURRENCY_IMMUTABLE' });
    expect(orgRepo.update).not.toHaveBeenCalled();
  });

  it('CUR-1: keeping the same base currency is allowed even with monetary records', async () => {
    const result = await useCase.execute({ organizationId: 'org-1', baseCurrency: 'USD', hasMonetaryRecords: true });

    expect(result.baseCurrency).toBe('USD');
  });

  it('throws NotFoundError when the organization does not exist', async () => {
    orgRepo.findById.mockResolvedValue(undefined);

    await expect(useCase.execute({ organizationId: 'missing', name: 'x' })).rejects.toBeInstanceOf(NotFoundError);
    expect(orgRepo.update).not.toHaveBeenCalled();
  });

  it('CUR-1: throws the standard domain error type (422) with params', async () => {
    const error = await useCase
      .execute({ organizationId: 'org-1', baseCurrency: 'EUR', hasMonetaryRecords: true })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DomainError);
    expect((error as { httpStatus: number }).httpStatus).toBe(422);
    expect((error as { params: Record<string, unknown> }).params).toEqual({ code: 'BASE_CURRENCY_IMMUTABLE' });
  });

  it('preserves immutability through the domain entity (CUR-1 invariant)', () => {
    const org = Organization.fromPersistence(makeOrg());
    expect(() => org.assertBaseCurrencyMutable(true)).toThrow(/BASE_CURRENCY_IMMUTABLE|immutable|monetary/i);
    expect(() => org.assertBaseCurrencyMutable(false)).not.toThrow();
  });
});
