import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TenantContext } from '../../../core/tenancy/tenant-context.js';
import { RevokeInvitationUseCase } from '../application/revoke-invitation.use-case.js';
import { type InvitationData } from '../domain/index.js';

describe('RevokeInvitationUseCase', () => {
  let invitationRepo: {
    findById: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  let txManager: { run: ReturnType<typeof vi.fn> };
  let useCase: RevokeInvitationUseCase;

  const input = { invitationId: 'inv-1', organizationId: 'org-1' };

  const makeInvitation = (overrides: Partial<InvitationData> = {}): InvitationData => ({
    id: 'inv-1',
    organizationId: 'org-1',
    name: 'Invitee User',
    email: 'invitee@example.com',
    roleId: 'role-member',
    tokenHash: 'hash',
    expiresAt: new Date('2026-01-10'),
    acceptedAt: null,
    revokedAt: null,
    invitedBy: 'user-1',
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    deletedAt: null,
    ...overrides,
  });

  beforeEach(() => {
    invitationRepo = {
      findById: vi.fn().mockResolvedValue(undefined),
      update: vi.fn().mockResolvedValue(undefined),
    };
    txManager = {
      // Run the callback with a fake tx, like the real TransactionManager.
      // The callback receives 'tx' and forwards it to the repository — reads
      // and writes run on the tenant-bound transaction (RLS).
      run: vi.fn().mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn('tx')),
    };

    useCase = new RevokeInvitationUseCase(invitationRepo as never, txManager as never);
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

  it('RLS: reads and writes the invitation inside the tenant-bound transaction', async () => {
    invitationRepo.findById.mockResolvedValue(makeInvitation());

    await runInContext(() => useCase.execute(input));

    const readCall = invitationRepo.findById.mock.calls[0] as [string, unknown];
    expect(readCall[0]).toBe('inv-1');
    expect(readCall[1]).toBe('tx');

    const updateCall = invitationRepo.update.mock.calls[0] as [string, { revokedAt: Date }, unknown];
    expect(updateCall[0]).toBe('inv-1');
    expect(updateCall[1].revokedAt).toBeInstanceOf(Date);
    expect(updateCall[2]).toBe('tx');
    expect(txManager.run).toHaveBeenCalledTimes(2);
  });

  it('AUTH-9: revokes a pending invitation', async () => {
    invitationRepo.findById.mockResolvedValue(makeInvitation());

    await runInContext(() => useCase.execute(input));

    expect(invitationRepo.update).toHaveBeenCalledTimes(1);
  });

  it('NOT_FOUND: rejects a missing invitation (404)', async () => {
    await expect(runInContext(() => useCase.execute(input))).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'INVITATION_NOT_FOUND',
      params: { invitationId: 'inv-1' },
    });

    expect(invitationRepo.update).not.toHaveBeenCalled();
  });

  it('NOT_FOUND: rejects an invitation from another organization (RLS/tenant isolation)', async () => {
    invitationRepo.findById.mockResolvedValue(makeInvitation({ organizationId: 'org-2' }));

    await expect(runInContext(() => useCase.execute(input))).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'INVITATION_NOT_FOUND',
    });

    expect(invitationRepo.update).not.toHaveBeenCalled();
  });

  it('AUTH-9: rejects revoking an already-accepted invitation (409)', async () => {
    invitationRepo.findById.mockResolvedValue(makeInvitation({ acceptedAt: new Date('2026-01-05') }));

    await expect(runInContext(() => useCase.execute(input))).rejects.toMatchObject({
      code: 'INVITATION_ALREADY_ACCEPTED',
    });

    expect(invitationRepo.update).not.toHaveBeenCalled();
  });

  it('AUTH-9: rejects revoking an already-revoked invitation (409)', async () => {
    invitationRepo.findById.mockResolvedValue(makeInvitation({ revokedAt: new Date('2026-01-05') }));

    await expect(runInContext(() => useCase.execute(input))).rejects.toMatchObject({
      code: 'INVITATION_ALREADY_REVOKED',
    });

    expect(invitationRepo.update).not.toHaveBeenCalled();
  });
});
