import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  GetOrganizationActivityUseCase,
  ORG_ACTIVITY_MAX_LIMIT,
} from '../application/get-organization-activity.use-case.js';

describe('GetOrganizationActivityUseCase (PLT-4)', () => {
  let directoryRepo: { findOrgById: ReturnType<typeof vi.fn> };
  let auditRepo: { listByOrg: ReturnType<typeof vi.fn> };
  let useCase: GetOrganizationActivityUseCase;

  beforeEach(() => {
    directoryRepo = { findOrgById: vi.fn().mockResolvedValue({ id: 'org-1', name: 'Acme', slug: 'acme' }) };
    auditRepo = {
      listByOrg: vi.fn().mockResolvedValue([
        {
          id: 'a1',
          action: 'module.blocked',
          actorUserId: 'admin-1',
          actorEmail: 'admin@modubiz.app',
          before: { state: 'trialing' },
          after: { state: 'blocked' },
          metadata: { moduleKey: 'crm' },
          occurredAt: new Date('2026-08-14T10:00:00Z'),
        },
      ]),
    };
    useCase = new GetOrganizationActivityUseCase(directoryRepo as never, auditRepo as never);
  });

  it('PLT-4: returns the org audit entries newest-first with ISO timestamps', async () => {
    const result = await useCase.execute({ organizationId: 'org-1' });

    expect(auditRepo.listByOrg).toHaveBeenCalledWith('org-1', 20);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toEqual({
      id: 'a1',
      action: 'module.blocked',
      actorUserId: 'admin-1',
      actorEmail: 'admin@modubiz.app',
      before: { state: 'trialing' },
      after: { state: 'blocked' },
      metadata: { moduleKey: 'crm' },
      occurredAt: '2026-08-14T10:00:00.000Z',
    });
  });

  it('PLT-4: clamps the limit to the allowed maximum', async () => {
    await useCase.execute({ organizationId: 'org-1', limit: 9999 });
    expect(auditRepo.listByOrg).toHaveBeenCalledWith('org-1', ORG_ACTIVITY_MAX_LIMIT);
  });

  it('PLT-4: floors the limit at 1', async () => {
    await useCase.execute({ organizationId: 'org-1', limit: 0 });
    expect(auditRepo.listByOrg).toHaveBeenCalledWith('org-1', 1);
  });

  it('PLT-4: a non-finite limit falls back to the default instead of breaking the SQL', async () => {
    await useCase.execute({ organizationId: 'org-1', limit: Number.NaN });
    expect(auditRepo.listByOrg).toHaveBeenCalledWith('org-1', 20);
  });

  it('PLT-4: throws ORG_NOT_FOUND for an unknown organization', async () => {
    directoryRepo.findOrgById.mockResolvedValue(undefined);

    await expect(useCase.execute({ organizationId: 'missing' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'ORG_NOT_FOUND',
      httpStatus: 404,
    });
    expect(auditRepo.listByOrg).not.toHaveBeenCalled();
  });
});
