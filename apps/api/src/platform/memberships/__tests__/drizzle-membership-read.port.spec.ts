import { describe, expect, it, vi } from 'vitest';

import type { TransactionManager } from '../../../core/database/transaction-manager.js';
import type { MembershipRepository } from '../ports/index.js';
import type { MembershipData } from '../domain/index.js';
import { DrizzleMembershipReadPort } from '../infrastructure/read-ports/drizzle-membership-read.port.js';

/**
 * CRM-14: the active-member set the CRM activity domain validates assignment
 * against must contain ONLY active, non-deleted members of the org.
 */

function makeMember(overrides: Partial<MembershipData>): MembershipData {
  return {
    id: 'm-1',
    organizationId: 'org-1',
    userId: 'user-1',
    roleId: 'role-1',
    status: 'active',
    joinedAt: new Date('2026-01-01T00:00:00.000Z'),
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    createdBy: null,
    updatedBy: null,
    deletedAt: null,
    ...overrides,
  };
}

/** TxManager stub that passes the ambient tx through to the repo call. */
function makeTxManager(): TransactionManager {
  const tx = { __ambient: true };
  return {
    run: vi.fn(async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn(tx)),
    ref: vi.fn(),
  } as unknown as TransactionManager;
}

function makeRepo(members: MembershipData[]) {
  return {
    findByOrgId: vi.fn().mockResolvedValue(members),
  } as unknown as MembershipRepository;
}

describe('DrizzleMembershipReadPort — listActiveMemberIds (CRM-14)', () => {
  it('CRM-14: returns the ids of active, non-deleted members only', async () => {
    const repo = makeRepo([
      makeMember({ userId: 'active-1' }),
      makeMember({ userId: 'active-2' }),
      makeMember({ userId: 'inactive-1', status: 'inactive' }),
      makeMember({ userId: 'removed-1', status: 'active', deletedAt: new Date('2026-02-01T00:00:00.000Z') }),
    ]);
    const port = new DrizzleMembershipReadPort(repo, makeTxManager());

    const ids = await port.listActiveMemberIds('org-1');

    expect(ids.sort()).toEqual(['active-1', 'active-2']);
  });

  it('CRM-14: an org with no active members returns an empty list (fail-closed assignment)', async () => {
    const repo = makeRepo([makeMember({ userId: 'inactive-1', status: 'inactive' })]);
    const port = new DrizzleMembershipReadPort(repo, makeTxManager());

    const ids = await port.listActiveMemberIds('org-1');

    expect(ids).toEqual([]);
  });

  it('delegates to the membership repo scoped to the given organization', async () => {
    const repo = makeRepo([makeMember({ userId: 'u-1' })]);
    const txManager = makeTxManager();
    const port = new DrizzleMembershipReadPort(repo, txManager);

    await port.listActiveMemberIds('org-42');

    expect(repo.findByOrgId).toHaveBeenCalledWith('org-42', expect.anything());
    expect(txManager.run).toHaveBeenCalledTimes(1);
  });
});
