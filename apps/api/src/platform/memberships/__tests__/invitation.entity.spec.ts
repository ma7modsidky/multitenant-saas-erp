import { describe, expect, it } from 'vitest';

import { Invitation, InvitationError, type InvitationData } from '../domain/index.js';

function makeInvitationData(overrides: Partial<InvitationData> = {}): InvitationData {
  return {
    id: 'inv-1',
    organizationId: 'org-1',
    name: 'Jane Cooper',
    email: 'jane@example.com',
    roleId: 'role-member',
    tokenHash: 'hashed-token-123',
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    acceptedAt: null,
    revokedAt: null,
    invitedBy: 'user-1',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    deletedAt: null,
    ...overrides,
  };
}

function expectInvitationError(action: () => void, expectedCode: string): void {
  try {
    action();
    expect.fail('Expected InvitationError to be thrown');
  } catch (error) {
    expect(error).toBeInstanceOf(InvitationError);
    expect((error as InvitationError).code).toBe(expectedCode);
  }
}

describe('Invitation.create()', () => {
  it('creates an invitation from data', () => {
    const inv = Invitation.create(makeInvitationData());
    expect(inv.id).toBe('inv-1');
    expect(inv.email).toBe('jane@example.com');
    expect(inv.name).toBe('Jane Cooper');
  });

  it('AUTH-9: carries the invitee display name (nullable for legacy rows)', () => {
    const inv = Invitation.create(makeInvitationData({ name: null }));
    expect(inv.name).toBeNull();
  });
});

describe('Invitation.isPending', () => {
  it('returns true for a fresh invitation', () => {
    const inv = Invitation.create(makeInvitationData());
    expect(inv.isPending).toBe(true);
  });

  it('returns false when accepted', () => {
    const inv = Invitation.create(makeInvitationData({ acceptedAt: new Date() }));
    expect(inv.isPending).toBe(false);
  });

  it('returns false when revoked', () => {
    const inv = Invitation.create(makeInvitationData({ revokedAt: new Date() }));
    expect(inv.isPending).toBe(false);
  });

  it('returns false when expired', () => {
    const inv = Invitation.create(makeInvitationData({ expiresAt: new Date(Date.now() - 3600000) }));
    expect(inv.isPending).toBe(false);
  });
});

describe('Invitation.isExpired', () => {
  it('returns false for a fresh invitation', () => {
    const inv = Invitation.create(makeInvitationData());
    expect(inv.isExpired).toBe(false);
  });

  it('returns false when accepted (acceptedAt overrides expiry)', () => {
    const inv = Invitation.create(
      makeInvitationData({ acceptedAt: new Date(), expiresAt: new Date(Date.now() - 3600000) }),
    );
    expect(inv.isExpired).toBe(false);
  });

  it('returns true when past expiry date and not accepted/revoked', () => {
    const inv = Invitation.create(makeInvitationData({ expiresAt: new Date(Date.now() - 3600000) }));
    expect(inv.isExpired).toBe(true);
  });
});

describe('Invitation.accept() AUTH-9', () => {
  it('accepts a valid invitation', () => {
    const inv = Invitation.create(makeInvitationData());
    expect(inv.acceptedAt).toBeNull();
    inv.accept();
    expect(inv.acceptedAt).toBeInstanceOf(Date);
  });

  it('throws INVITATION_ALREADY_ACCEPTED if already accepted', () => {
    const inv = Invitation.create(makeInvitationData({ acceptedAt: new Date() }));
    expectInvitationError(() => inv.accept(), 'INVITATION_ALREADY_ACCEPTED');
  });

  it('throws INVITATION_REVOKED if revoked', () => {
    const inv = Invitation.create(makeInvitationData({ revokedAt: new Date() }));
    expectInvitationError(() => inv.accept(), 'INVITATION_REVOKED');
  });

  it('throws INVITATION_EXPIRED if expired', () => {
    const inv = Invitation.create(makeInvitationData({ expiresAt: new Date(Date.now() - 3600000) }));
    expectInvitationError(() => inv.accept(), 'INVITATION_EXPIRED');
  });
});

describe('Invitation.revoke()', () => {
  it('revokes a pending invitation', () => {
    const inv = Invitation.create(makeInvitationData());
    expect(inv.revokedAt).toBeNull();
    inv.revoke();
    expect(inv.revokedAt).toBeInstanceOf(Date);
  });

  it('throws INVITATION_ALREADY_REVOKED if already revoked', () => {
    const inv = Invitation.create(makeInvitationData({ revokedAt: new Date() }));
    expectInvitationError(() => inv.revoke(), 'INVITATION_ALREADY_REVOKED');
  });

  it('throws INVITATION_ALREADY_ACCEPTED if already accepted', () => {
    const inv = Invitation.create(makeInvitationData({ acceptedAt: new Date() }));
    expectInvitationError(() => inv.revoke(), 'INVITATION_ALREADY_ACCEPTED');
  });
});

describe('Invitation.toJSON()', () => {
  it('returns a copy of the invitation data', () => {
    const data = makeInvitationData();
    const inv = Invitation.create(data);
    const json = inv.toJSON();
    expect(json.email).toBe('jane@example.com');
    expect(json.roleId).toBe('role-member');
  });
});
