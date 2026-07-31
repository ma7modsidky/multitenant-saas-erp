import { describe, expect, it } from 'vitest';

import { Membership, MembershipError, type MembershipData } from '../domain/index.js';

function makeMembershipData(overrides: Partial<MembershipData> = {}): MembershipData {
  return {
    id: 'mem-1',
    organizationId: 'org-1',
    userId: 'user-1',
    roleId: 'role-owner',
    status: 'active',
    joinedAt: new Date('2026-01-01T00:00:00Z'),
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    createdBy: 'user-1',
    updatedBy: null,
    deletedAt: null,
    ...overrides,
  };
}

function expectMembershipError(action: () => void, expectedCode: string): void {
  try {
    action();
    expect.fail('Expected MembershipError to be thrown');
  } catch (error) {
    expect(error).toBeInstanceOf(MembershipError);
    expect((error as MembershipError).code).toBe(expectedCode);
  }
}

describe('Membership.create()', () => {
  it('creates a membership from data', () => {
    const m = Membership.create(makeMembershipData());
    expect(m.id).toBe('mem-1');
    expect(m.userId).toBe('user-1');
    expect(m.roleId).toBe('role-owner');
  });
});

describe('Membership.isActive', () => {
  it('returns true when status is active and deletedAt is null', () => {
    const m = Membership.create(makeMembershipData());
    expect(m.isActive).toBe(true);
  });

  it('returns false when status is inactive', () => {
    const m = Membership.create(makeMembershipData({ status: 'inactive' }));
    expect(m.isActive).toBe(false);
  });

  it('returns false when deletedAt is set', () => {
    const m = Membership.create(makeMembershipData({ deletedAt: new Date() }));
    expect(m.isActive).toBe(false);
  });
});

describe('AUTHZ-1: Last owner cannot be removed/demoted', () => {
  it('changeRole allows role change when not last owner', () => {
    const m = Membership.create(makeMembershipData());
    m.changeRole('role-admin', false, 'user-2');
    expect(m.roleId).toBe('role-admin');
  });

  it('changeRole throws LAST_OWNER_CANNOT_DEMOTE for last owner', () => {
    const m = Membership.create(makeMembershipData());
    expectMembershipError(() => m.changeRole('role-admin', true, 'user-2'), 'LAST_OWNER_CANNOT_DEMOTE');
  });
});

describe('AUTHZ-7: Remove soft-deletes membership', () => {
  it('remove sets status to inactive and sets deletedAt', () => {
    const m = Membership.create(makeMembershipData());
    expect(m.deletedAt).toBeNull();

    m.remove(false, 'user-2');

    expect(m.status).toBe('inactive');
    expect(m.deletedAt).toBeInstanceOf(Date);
  });

  it('remove throws LAST_OWNER_CANNOT_REMOVE for last owner', () => {
    const m = Membership.create(makeMembershipData());
    expectMembershipError(() => m.remove(true, 'user-2'), 'LAST_OWNER_CANNOT_REMOVE');
  });
});

describe('Membership.toJSON()', () => {
  it('returns a copy of the membership data', () => {
    const data = makeMembershipData();
    const m = Membership.create(data);
    const json = m.toJSON();
    expect(json.organizationId).toBe('org-1');
    expect(json.userId).toBe('user-1');
  });
});
