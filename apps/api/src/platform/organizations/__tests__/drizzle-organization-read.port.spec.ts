import { describe, expect, it, vi } from 'vitest';

import { NotFoundError } from '../../../core/common/errors.js';
import type { TransactionManager } from '../../../core/database/transaction-manager.js';
import type { OrganizationRepository } from '../ports/index.js';
import type { OrganizationData } from '../domain/index.js';
import { DrizzleOrganizationReadPort } from '../infrastructure/read-ports/drizzle-organization-read.port.js';

function makeOrg(overrides: Partial<OrganizationData>): OrganizationData {
  return {
    id: 'org-1',
    name: 'Acme',
    slug: 'acme',
    countryCode: 'US',
    timezone: 'UTC',
    baseCurrency: 'USD',
    defaultLocale: 'en',
    status: 'active',
    deletionScheduledAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function makeTxManager(): TransactionManager {
  const tx = { __ambient: true };
  return {
    run: vi.fn(async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn(tx)),
    ref: vi.fn(),
  } as unknown as TransactionManager;
}

function makeRepo(org: OrganizationData | undefined) {
  return {
    findById: vi.fn().mockResolvedValue(org),
  } as unknown as OrganizationRepository;
}

describe('DrizzleOrganizationReadPort — getBaseCurrency (CRM-8)', () => {
  it('CRM-8: returns the organization base currency', async () => {
    const repo = makeRepo(makeOrg({ baseCurrency: 'EUR' }));
    const port = new DrizzleOrganizationReadPort(repo, makeTxManager());

    const currency = await port.getBaseCurrency('org-1');

    expect(currency).toBe('EUR');
    expect(repo.findById).toHaveBeenCalledWith('org-1', expect.anything());
  });

  it('throws NotFoundError ORG_NOT_FOUND when the organization does not exist', async () => {
    const repo = makeRepo(undefined);
    const port = new DrizzleOrganizationReadPort(repo, makeTxManager());

    await expect(port.getBaseCurrency('org-missing')).rejects.toThrow(NotFoundError);
    await expect(port.getBaseCurrency('org-missing')).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'ORG_NOT_FOUND',
    });
  });
});
