import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TenantContext } from '../../../core/tenancy/tenant-context.js';
import { SYSTEM_ROLES } from '../../roles/domain/index.js';
import { UpdateMembershipRoleUseCase } from '../application/update-membership-role.use-case.js';
import { type MembershipData } from '../domain/index.js';

describe('UpdateMembershipRoleUseCase', () => {
  let membershipRepo: {
    findById: ReturnType<typeof vi.fn>;
    countByOrgIdAndRoleId: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  let jwtTokenService: {
    revokeAllUserSessions: ReturnType<typeof vi.fn>;
  };
  let txManager: { run: ReturnType<typeof vi.fn> };
  let useCase: UpdateMembershipRoleUseCase;

  const input = {
    membershipId: 'membership-1',
    newRoleId: 'role-admin',
    newRoleKey: SYSTEM_ROLES.ADMIN,
    currentUserId: 'user-1',
    // Actor defaults to OWNER so the pre-existing AUTHZ-1 last-owner tests
    // reach the last-owner guard (AUTHZ-2's OWNER-only guard is tested below).
    currentUserRoleKey: SYSTEM_ROLES.OWNER,
    organizationId: 'org-1',
  };

  const makeMembership = (overrides: Partial<MembershipData> = {}): MembershipData => ({
    id: 'membership-1',
    organizationId: 'org-1',
    userId: 'user-2',
    roleId: 'role-manager',
    roleKey: SYSTEM_ROLES.MANAGER,
    status: 'active',
    joinedAt: new Date('2026-01-01'),
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    createdBy: 'user-1',
    updatedBy: null,
    deletedAt: null,
    ...overrides,
  });

  beforeEach(() => {
    membershipRepo = {
      findById: vi.fn().mockResolvedValue(undefined),
      countByOrgIdAndRoleId: vi.fn().mockResolvedValue(2),
      update: vi.fn().mockResolvedValue(undefined),
    };
    txManager = {
      // Run the callback with a fake tx, like the real TransactionManager.
      // The callback receives 'tx' and forwards it to the repository, which is
      // exactly how the RLS fix works: reads happen on the tenant-bound tx.
      run: vi.fn().mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn('tx')),
    };
    jwtTokenService = {
      revokeAllUserSessions: vi.fn().mockResolvedValue(undefined),
    };

    useCase = new UpdateMembershipRoleUseCase(membershipRepo as never, txManager as never, jwtTokenService as never);
  });

  const runInContext = <T>(fn: () => Promise<T>) =>
    TenantContext.run(
      {
        userId: 'user-1',
        sessionId: 'session-1',
        organizationId: 'org-1',
        roles: [],
        permissions: [],
        locale: 'en',
      },
      fn,
    );

  it('RLS: reads the membership inside the tenant-bound transaction, not on the pool connection', async () => {
    membershipRepo.findById.mockResolvedValue(makeMembership());

    await runInContext(() => useCase.execute(input));

    // findById must be invoked via txManager.run() with the transaction handle
    // (core_memberships has FORCE RLS — a pool read fails closed to zero rows).
    const call = membershipRepo.findById.mock.calls[0] as [string, unknown];
    expect(call[0]).toBe('membership-1');
    expect(call[1]).toBe('tx');
    expect(txManager.run).toHaveBeenCalledTimes(2);
  });

  it('MEMBERSHIP_NOT_FOUND: rejects a missing membership (404)', async () => {
    // NotFoundError exposes the generic code 'NOT_FOUND'; the domain context
    // (MEMBERSHIP_NOT_FOUND + membershipId) is carried in message + params.
    await expect(runInContext(() => useCase.execute(input))).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'MEMBERSHIP_NOT_FOUND',
      params: { membershipId: 'membership-1' },
    });

    expect(membershipRepo.update).not.toHaveBeenCalled();
  });

  it('MEMBERSHIP_NOT_FOUND: rejects a membership from another organization', async () => {
    membershipRepo.findById.mockResolvedValue(makeMembership({ organizationId: 'org-2' }));

    await expect(runInContext(() => useCase.execute(input))).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'MEMBERSHIP_NOT_FOUND',
      params: { membershipId: 'membership-1' },
    });

    expect(membershipRepo.update).not.toHaveBeenCalled();
  });

  it('AUTHZ-3: rejects changing your own role', async () => {
    membershipRepo.findById.mockResolvedValue(makeMembership({ userId: 'user-1' }));

    await expect(runInContext(() => useCase.execute(input))).rejects.toMatchObject({
      code: 'CANNOT_CHANGE_OWN_ROLE',
    });

    expect(membershipRepo.update).not.toHaveBeenCalled();
  });

  it('AUTHZ-1: rejects demoting the last OWNER', async () => {
    membershipRepo.findById.mockResolvedValue(makeMembership({ roleKey: SYSTEM_ROLES.OWNER }));
    membershipRepo.countByOrgIdAndRoleId.mockResolvedValue(1);

    await expect(runInContext(() => useCase.execute(input))).rejects.toMatchObject({
      code: 'LAST_OWNER_CANNOT_DEMOTE',
    });

    expect(membershipRepo.update).not.toHaveBeenCalled();
  });

  it('AUTHZ-1: allows demoting an OWNER when another owner exists', async () => {
    membershipRepo.findById.mockResolvedValue(makeMembership({ roleKey: SYSTEM_ROLES.OWNER }));
    membershipRepo.countByOrgIdAndRoleId.mockResolvedValue(2);

    await runInContext(() => useCase.execute(input));

    // The count is scoped to the org and the owner role row.
    const countCall = membershipRepo.countByOrgIdAndRoleId.mock.calls[0] as [string, string, unknown];
    expect(countCall[0]).toBe('org-1');
    expect(countCall[1]).toBe('role-manager');
    expect(countCall[2]).toBe('tx');
    expect(membershipRepo.update).toHaveBeenCalledTimes(1);
  });

  it('AUTHZ-2: rejects an ADMIN demoting an OWNER even when another owner exists', async () => {
    membershipRepo.findById.mockResolvedValue(makeMembership({ roleKey: SYSTEM_ROLES.OWNER }));
    membershipRepo.countByOrgIdAndRoleId.mockResolvedValue(2);

    // The actor is an ADMIN — ownership is OWNER-managed (AUTHZ-2), so the
    // demotion is rejected even though the last-owner guard would not fire.
    await expect(
      runInContext(() => useCase.execute({ ...input, currentUserRoleKey: SYSTEM_ROLES.ADMIN })),
    ).rejects.toMatchObject({
      code: 'ONLY_OWNER_CAN_DEMOTE',
    });

    expect(membershipRepo.update).not.toHaveBeenCalled();
  });

  it('AUTHZ-2: an OWNER can demote ANOTHER owner (not themselves — AUTHZ-3) when another owner exists', async () => {
    membershipRepo.findById.mockResolvedValue(makeMembership({ roleKey: SYSTEM_ROLES.OWNER, userId: 'user-2' }));
    membershipRepo.countByOrgIdAndRoleId.mockResolvedValue(2);

    await runInContext(() => useCase.execute(input));

    expect(membershipRepo.update).toHaveBeenCalledTimes(1);
  });

  it('AUTHZ-1: does not count role holders for non-owner members (only the last OWNER is protected)', async () => {
    membershipRepo.findById.mockResolvedValue(makeMembership({ roleKey: SYSTEM_ROLES.MANAGER }));

    await runInContext(() => useCase.execute(input));

    expect(membershipRepo.countByOrgIdAndRoleId).not.toHaveBeenCalled();
    expect(membershipRepo.update).toHaveBeenCalledTimes(1);
  });

  it('applies the new role and records the actor', async () => {
    membershipRepo.findById.mockResolvedValue(makeMembership({ roleKey: SYSTEM_ROLES.MANAGER }));

    await runInContext(() => useCase.execute(input));

    const updateCall = membershipRepo.update.mock.calls[0] as [string, { roleId: string; updatedBy: string }, unknown];
    expect(updateCall[0]).toBe('membership-1');
    expect(updateCall[1]).toEqual({
      roleId: 'role-admin',
      updatedBy: 'user-1',
    });
    expect(updateCall[2]).toBe('tx');
  });

  it("AUTHZ-5: revokes the member's sessions so their next token is minted from the NEW role", async () => {
    membershipRepo.findById.mockResolvedValue(makeMembership({ roleKey: SYSTEM_ROLES.MANAGER, userId: 'user-2' }));

    await runInContext(() => useCase.execute(input));

    // The stale-claims window closes immediately: the demoted/promoted
    // member's refresh sessions are revoked, so a refresh cannot re-mint
    // the OLD elevated permissions from the session snapshot.
    expect(jwtTokenService.revokeAllUserSessions).toHaveBeenCalledTimes(1);
    expect(jwtTokenService.revokeAllUserSessions).toHaveBeenCalledWith('user-2', 'ROLE_CHANGED');
  });

  it('AUTHZ-5: does NOT revoke sessions when the role change is rejected', async () => {
    membershipRepo.findById.mockResolvedValue(makeMembership({ roleKey: SYSTEM_ROLES.OWNER }));
    membershipRepo.countByOrgIdAndRoleId.mockResolvedValue(1);

    await expect(runInContext(() => useCase.execute(input))).rejects.toMatchObject({
      code: 'LAST_OWNER_CANNOT_DEMOTE',
    });

    expect(jwtTokenService.revokeAllUserSessions).not.toHaveBeenCalled();
  });
});
