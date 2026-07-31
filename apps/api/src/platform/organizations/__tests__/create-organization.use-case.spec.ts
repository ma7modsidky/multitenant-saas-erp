import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ConflictError } from '../../../core/common/errors.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';
import { SYSTEM_ROLES } from '../../roles/domain/index.js';
import { CreateOrganizationUseCase } from '../application/create-organization.use-case.js';
import type { OrganizationRepository } from '../ports/index.js';

const now = new Date('2026-07-31T00:00:00.000Z');

const orgInput = {
  name: 'Acme Inc',
  slug: 'acme',
  countryCode: 'US',
  timezone: 'UTC',
  baseCurrency: 'USD',
  defaultLocale: 'en',
};

function makeOrgRow(id: string) {
  return {
    id,
    organizationId: id,
    name: orgInput.name,
    slug: orgInput.slug,
    countryCode: 'US',
    timezone: 'UTC',
    baseCurrency: 'USD',
    defaultLocale: 'en',
    status: 'active',
    deletionScheduledAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

describe('CreateOrganizationUseCase', () => {
  let orgRepo: { isSlugTaken: ReturnType<typeof vi.fn>; insert: ReturnType<typeof vi.fn>; upsertSettings: ReturnType<typeof vi.fn> };
  let roleRepo: { insert: ReturnType<typeof vi.fn> };
  let membershipRepo: { insert: ReturnType<typeof vi.fn> };
  let txManager: { run: ReturnType<typeof vi.fn> };
  let useCase: CreateOrganizationUseCase;

  beforeEach(() => {
    orgRepo = {
      isSlugTaken: vi.fn().mockResolvedValue(false),
      insert: vi.fn().mockImplementation((data: unknown) => Promise.resolve({ ...(data as object), organizationId: (data as { id: string }).id })),
      upsertSettings: vi.fn().mockResolvedValue({}),
    };
    roleRepo = {
      insert: vi.fn().mockImplementation((data: unknown) => Promise.resolve(data)),
    };
    membershipRepo = {
      insert: vi.fn().mockImplementation((data: unknown) => Promise.resolve(data)),
    };
    txManager = {
      // Run the callback with a fake tx, like the real TransactionManager.
      run: vi.fn().mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn('tx')),
    };

    useCase = new CreateOrganizationUseCase(
      orgRepo as unknown as OrganizationRepository,
      roleRepo as never,
      membershipRepo as never,
      txManager as never,
    );
  });

  it('AUTH-10: creates an OWNER system role for the new organization', async () => {
    await TenantContext.run(
      { userId: 'user-1', sessionId: 'session-1', organizationId: undefined, roles: [], permissions: [], locale: 'en' },
      async () => useCase.execute(orgInput),
    );

    expect(roleRepo.insert).toHaveBeenCalledTimes(1);
    type RoleCall = { key: string; isSystem: boolean; organizationId: string; createdBy: string };
    const roleData = (roleRepo.insert.mock.calls[0] as [RoleCall])[0];
    expect(roleData).toBeDefined();
    expect(roleData!.key).toBe(SYSTEM_ROLES.OWNER);
    expect(roleData!.isSystem).toBe(true);
    expect(roleData!.organizationId).toBeTruthy();
    expect(roleData!.createdBy).toBe('user-1');
  });

  it('AUTH-10: creates an active OWNER membership for the creating user', async () => {
    await TenantContext.run(
      { userId: 'user-1', sessionId: 'session-1', organizationId: undefined, roles: [], permissions: [], locale: 'en' },
      async () => useCase.execute(orgInput),
    );

    expect(membershipRepo.insert).toHaveBeenCalledTimes(1);
    type MembershipCall = { userId: string; roleId: string; status: string; organizationId: string; createdBy: string };
    const membershipData = (membershipRepo.insert.mock.calls[0] as [MembershipCall])[0];
    expect(membershipData).toBeDefined();
    expect(membershipData!.userId).toBe('user-1');
    expect(membershipData!.status).toBe('active');
    expect(membershipData!.createdBy).toBe('user-1');
    // The membership must reference the role created in the same transaction.
    type RoleIdCall = { id: string };
    const roleData = (roleRepo.insert.mock.calls[0] as [RoleIdCall])[0];
    expect(membershipData!.roleId).toBe(roleData!.id);
  });

  it('AUTH-10: scopes the role and membership writes to the new organization', async () => {
    await TenantContext.run(
      { userId: 'user-1', sessionId: 'session-1', organizationId: undefined, roles: [], permissions: [], locale: 'en' },
      async () => useCase.execute(orgInput),
    );

    type OrgIdCall = { organizationId: string };
    const roleData = (roleRepo.insert.mock.calls[0] as [OrgIdCall])[0];
    const membershipData = (membershipRepo.insert.mock.calls[0] as [OrgIdCall])[0];
    expect(roleData!.organizationId).toBeTruthy();
    expect(membershipData!.organizationId).toBe(roleData!.organizationId);
  });

  it('rejects a duplicate slug with a ConflictError', async () => {
    orgRepo.isSlugTaken.mockResolvedValue(true);

    await TenantContext.run(
      { userId: 'user-1', sessionId: 'session-1', organizationId: undefined, roles: [], permissions: [], locale: 'en' },
      async () => {
        await expect(useCase.execute(orgInput)).rejects.toBeInstanceOf(ConflictError);
      },
    );

    expect(orgRepo.insert).not.toHaveBeenCalled();
    expect(roleRepo.insert).not.toHaveBeenCalled();
    expect(membershipRepo.insert).not.toHaveBeenCalled();
  });

  it('rejects the operation without a tenant context', async () => {
    await expect(useCase.execute(orgInput)).rejects.toThrow('requires an authenticated tenant context');
  });
});
