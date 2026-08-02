import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TenantContext } from '../../../core/tenancy/tenant-context.js';
import { SYSTEM_ROLE_PERMISSIONS, SYSTEM_ROLES } from '../../roles/domain/index.js';
import { SwitchOrgUseCase } from '../application/switch-org.use-case.js';
import { type MembershipData } from '../domain/index.js';

describe('SwitchOrgUseCase', () => {
  let membershipRepo: {
    findByUserAndOrg: ReturnType<typeof vi.fn>;
    resolveRolePermissions: ReturnType<typeof vi.fn>;
  };
  let jwtTokenService: {
    generateRefreshToken: ReturnType<typeof vi.fn>;
    generateAccessToken: ReturnType<typeof vi.fn>;
    revokeSession: ReturnType<typeof vi.fn>;
  };
  let txManager: { run: ReturnType<typeof vi.fn>; runWithOrg: ReturnType<typeof vi.fn> };
  let useCase: SwitchOrgUseCase;

  const input = { userId: 'user-1', newOrganizationId: 'org-1' };

  const makeMembership = (overrides: Partial<MembershipData> = {}): MembershipData => ({
    id: 'membership-1',
    organizationId: 'org-1',
    userId: 'user-1',
    roleId: 'role-owner',
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
      findByUserAndOrg: vi.fn().mockResolvedValue(undefined),
      resolveRolePermissions: vi
        .fn()
        .mockResolvedValue({ roleKey: SYSTEM_ROLES.OWNER, isSystem: true, permissions: [] }),
    };
    jwtTokenService = {
      generateRefreshToken: vi.fn().mockResolvedValue({ refreshToken: 'rt-1', session: { id: 'session-1' } }),
      generateAccessToken: vi.fn().mockImplementation(async (payload: unknown) => `token.${JSON.stringify(payload)}`),
      revokeSession: vi.fn().mockResolvedValue(undefined),
    };
    txManager = {
      // Run the callback with a fake tx, like the real TransactionManager.
      run: vi.fn().mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn('tx')),
      // runWithOrg binds app.current_organization_id to the TARGET org — the
      // RLS-critical path for a fresh login token that carries no org (AUTHZ-5).
      runWithOrg: vi.fn().mockImplementation(async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) => fn('tx')),
    };

    useCase = new SwitchOrgUseCase(membershipRepo as never, jwtTokenService as never, txManager as never);
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

  it('TEN-4: rejects a user with no membership in the target org', async () => {
    await expect(runInContext(() => useCase.execute(input))).rejects.toMatchObject({ code: 'NOT_A_MEMBER' });
    expect(jwtTokenService.generateAccessToken).not.toHaveBeenCalled();
  });

  it('AUTHZ-5: mints the access token with the member role KEY and SYSTEM matrix permissions', async () => {
    membershipRepo.findByUserAndOrg.mockResolvedValue(makeMembership());
    membershipRepo.resolveRolePermissions.mockResolvedValue({
      roleKey: SYSTEM_ROLES.OWNER,
      isSystem: true,
      permissions: [],
    });

    await runInContext(() => useCase.execute(input));

    // RLS regression: the role lookup must run org-bound (runWithOrg) even
    // when the token context has no organizationId — otherwise core_roles
    // fails closed under tenant_isolation and the token mints empty claims.
    expect(txManager.runWithOrg).toHaveBeenCalledWith('org-1', expect.any(Function));
    expect(txManager.run).not.toHaveBeenCalledWith('org-1', expect.any(Function));

    const payload = jwtTokenService.generateAccessToken.mock.calls[0]?.[0] as {
      roles: string[];
      permissions: string[];
      organizationId: string;
    };
    expect(payload.roles).toEqual([SYSTEM_ROLES.OWNER]);
    expect(payload.permissions).toEqual([...SYSTEM_ROLE_PERMISSIONS[SYSTEM_ROLES.OWNER]!]);
    expect(payload.organizationId).toBe('org-1');
  });

  it('AUTHZ-5: mints the token with PERMITTED permissions only — a member gets no member-management perms', async () => {
    membershipRepo.findByUserAndOrg.mockResolvedValue(makeMembership({ roleId: 'role-member' }));
    membershipRepo.resolveRolePermissions.mockResolvedValue({
      roleKey: SYSTEM_ROLES.MEMBER,
      isSystem: true,
      permissions: [],
    });

    await runInContext(() => useCase.execute(input));

    const payload = jwtTokenService.generateAccessToken.mock.calls[0]?.[0] as {
      roles: string[];
      permissions: string[];
    };
    expect(payload.roles).toEqual([SYSTEM_ROLES.MEMBER]);
    expect(payload.permissions).toEqual([...SYSTEM_ROLE_PERMISSIONS[SYSTEM_ROLES.MEMBER]!]);
    expect(payload.permissions).not.toContain('platform:members:assign-role');
    expect(payload.permissions).not.toContain('platform:members:remove');
    expect(payload.permissions).not.toContain('platform:members:invite');
  });

  it('AUTHZ-5: custom roles embed their PERSISTED permissions', async () => {
    membershipRepo.findByUserAndOrg.mockResolvedValue(makeMembership({ roleId: 'role-custom' }));
    membershipRepo.resolveRolePermissions.mockResolvedValue({
      roleKey: 'sales_manager',
      isSystem: false,
      permissions: ['crm:deal:read', 'crm:deal:write'],
    });

    await runInContext(() => useCase.execute(input));

    const payload = jwtTokenService.generateAccessToken.mock.calls[0]?.[0] as {
      roles: string[];
      permissions: string[];
    };
    expect(payload.roles).toEqual(['sales_manager']);
    expect(payload.permissions).toEqual(['crm:deal:read', 'crm:deal:write']);
  });

  it('AUTHZ-5: fails closed to empty claims when the role cannot be resolved', async () => {
    membershipRepo.findByUserAndOrg.mockResolvedValue(makeMembership());
    membershipRepo.resolveRolePermissions.mockResolvedValue(undefined);

    await runInContext(() => useCase.execute(input));

    const payload = jwtTokenService.generateAccessToken.mock.calls[0]?.[0] as {
      roles: string[];
      permissions: string[];
    };
    expect(payload.roles).toEqual([]);
    expect(payload.permissions).toEqual([]);
  });

  it('TEN-4/AUTH-5: revokes the CURRENT session so the old refresh token cannot re-mint old-org claims', async () => {
    membershipRepo.findByUserAndOrg.mockResolvedValue(makeMembership());
    membershipRepo.resolveRolePermissions.mockResolvedValue({
      roleKey: SYSTEM_ROLES.OWNER,
      isSystem: true,
      permissions: [],
    });

    await runInContext(() =>
      useCase.execute({ userId: 'user-1', newOrganizationId: 'org-1', currentSessionId: 'session-0' }),
    );

    expect(jwtTokenService.revokeSession).toHaveBeenCalledTimes(1);
    expect(jwtTokenService.revokeSession).toHaveBeenCalledWith('session-0', 'ORG_SWITCHED');
  });

  it('TEN-4/AUTH-5: does not revoke the NEW session (only the stale previous one)', async () => {
    membershipRepo.findByUserAndOrg.mockResolvedValue(makeMembership());
    membershipRepo.resolveRolePermissions.mockResolvedValue({
      roleKey: SYSTEM_ROLES.OWNER,
      isSystem: true,
      permissions: [],
    });

    await runInContext(() =>
      useCase.execute({ userId: 'user-1', newOrganizationId: 'org-1', currentSessionId: 'session-1' }),
    );

    expect(jwtTokenService.revokeSession).not.toHaveBeenCalled();
  });

  it('TEN-4/AUTH-5: switch succeeds even when session revocation fails (best-effort)', async () => {
    membershipRepo.findByUserAndOrg.mockResolvedValue(makeMembership());
    membershipRepo.resolveRolePermissions.mockResolvedValue({
      roleKey: SYSTEM_ROLES.OWNER,
      isSystem: true,
      permissions: [],
    });
    jwtTokenService.revokeSession.mockRejectedValue(new Error('store down'));

    await expect(
      runInContext(() =>
        useCase.execute({ userId: 'user-1', newOrganizationId: 'org-1', currentSessionId: 'session-0' }),
      ),
    ).resolves.toBeDefined();

    expect(jwtTokenService.generateAccessToken).toHaveBeenCalledTimes(1);
  });
});
