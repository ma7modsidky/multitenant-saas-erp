import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TenantContext } from '../../../core/tenancy/tenant-context.js';
import { InviteUserUseCase } from '../application/invite-user.use-case.js';

describe('InviteUserUseCase', () => {
  let membershipRepo: { findByUserAndOrg: ReturnType<typeof vi.fn> };
  let invitationRepo: { findPendingByEmail: ReturnType<typeof vi.fn>; insert: ReturnType<typeof vi.fn> };
  let userRepo: { findByEmail: ReturnType<typeof vi.fn> };
  let txManager: { run: ReturnType<typeof vi.fn> };
  let useCase: InviteUserUseCase;

  const input = {
    name: '  Invitee User  ',
    email: 'Invitee@Example.com',
    roleId: 'role-1',
    organizationId: 'org-1',
    invitedBy: 'inviter-1',
  };

  beforeEach(() => {
    membershipRepo = {
      findByUserAndOrg: vi.fn().mockResolvedValue(undefined),
    };
    invitationRepo = {
      findPendingByEmail: vi.fn().mockResolvedValue(undefined),
      insert: vi.fn().mockImplementation((data: unknown) => Promise.resolve(data)),
    };
    userRepo = {
      findByEmail: vi.fn().mockResolvedValue(undefined),
    };
    txManager = {
      // Run the callback with a fake tx, like the real TransactionManager.
      run: vi.fn().mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn('tx')),
    };

    useCase = new InviteUserUseCase(
      membershipRepo as never,
      invitationRepo as never,
      userRepo as never,
      txManager as never,
    );
  });

  const runInContext = <T>(fn: () => Promise<T>) =>
    TenantContext.run(
      {
        userId: 'inviter-1',
        sessionId: 'session-1',
        organizationId: 'org-1',
        roles: [],
        permissions: [],
        locale: 'en',
      },
      fn,
    );

  it('AUTHZ-8: normalizes the invited email to lowercase and trims the invitee name', async () => {
    await runInContext(() => useCase.execute(input));

    const email = (userRepo.findByEmail.mock.calls[0] as [string])[0];
    expect(email).toBe('invitee@example.com');
    const inserted = (invitationRepo.insert.mock.calls[0] as [{ email: string; name: string }])[0];
    expect(inserted.email).toBe('invitee@example.com');
    // The invitee name typed next to the email is trimmed before persistence
    // (invitations list + public invite page show it, migration 0012).
    expect(inserted.name).toBe('Invitee User');
  });

  it('AUTHZ-8: rejects an email that already has an active membership', async () => {
    userRepo.findByEmail.mockResolvedValue({ id: 'invitee-1', email: 'invitee@example.com' });
    membershipRepo.findByUserAndOrg.mockResolvedValue({ id: 'membership-1' });

    await expect(runInContext(() => useCase.execute(input))).rejects.toMatchObject({
      code: 'MEMBERSHIP_ALREADY_EXISTS',
    });

    expect(invitationRepo.insert).not.toHaveBeenCalled();
  });

  it('AUTHZ-8: checks the invitee membership in the target organization', async () => {
    userRepo.findByEmail.mockResolvedValue({ id: 'invitee-1', email: 'invitee@example.com' });

    await runInContext(() => useCase.execute(input));

    const call = membershipRepo.findByUserAndOrg.mock.calls[0] as [string, string];
    expect(call[0]).toBe('invitee-1');
    expect(call[1]).toBe('org-1');
  });

  it('AUTHZ-8: does not reject when the email has no account yet (new signup)', async () => {
    await runInContext(() => useCase.execute(input));

    expect(membershipRepo.findByUserAndOrg).not.toHaveBeenCalled();
    expect(invitationRepo.insert).toHaveBeenCalledTimes(1);
  });

  it('AUTHZ-8: rejects a duplicate pending invitation for the same email', async () => {
    userRepo.findByEmail.mockResolvedValue({ id: 'invitee-1', email: 'invitee@example.com' });
    invitationRepo.findPendingByEmail.mockResolvedValue({ id: 'pending-1' });

    await expect(runInContext(() => useCase.execute(input))).rejects.toMatchObject({
      code: 'INVITATION_ALREADY_PENDING',
    });

    expect(invitationRepo.insert).not.toHaveBeenCalled();
  });

  it('AUTH-9: creates an invitation with a hashed token and 7-day expiry', async () => {
    const result = await runInContext(() => useCase.execute(input));

    const inserted = (
      invitationRepo.insert.mock.calls[0] as [
        { id: string; tokenHash: string; expiresAt: Date; roleId: string; organizationId: string },
      ]
    )[0];
    expect(inserted.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(inserted.expiresAt.getTime()).toBeGreaterThan(Date.now() + 6 * 24 * 60 * 60 * 1000);
    expect(inserted.roleId).toBe('role-1');
    expect(inserted.organizationId).toBe('org-1');

    // Returns the invitation id for the accept link (dev email stand-in).
    expect(result.invitationId).toBe(inserted.id);
  });
});
