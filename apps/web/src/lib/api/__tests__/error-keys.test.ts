// Unit tests for the API error → i18n key mappers and the redirect sanitizer.

// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import {
  inviteErrorKey,
  invitationErrorKey,
  removeMemberErrorKey,
  revokeInvitationErrorKey,
  safeNextPath,
  updateRoleErrorKey,
} from '../error-keys';

import { ApiError } from '../index';

describe('inviteErrorKey', () => {
  it('maps MEMBERSHIP_ALREADY_EXISTS (AUTHZ-8) to alreadyMember', () => {
    const err = new ApiError(409, { code: 'MEMBERSHIP_ALREADY_EXISTS' });
    expect(inviteErrorKey(err)).toBe('members.errors.alreadyMember');
  });

  it('maps INVITATION_ALREADY_PENDING (AUTHZ-8) to alreadyPending', () => {
    const err = new ApiError(409, { code: 'INVITATION_ALREADY_PENDING' });
    expect(inviteErrorKey(err)).toBe('members.errors.alreadyPending');
  });

  it('falls back to inviteFailed for other ApiError codes', () => {
    const err = new ApiError(500, { code: 'INTERNAL_ERROR' });
    expect(inviteErrorKey(err)).toBe('members.errors.inviteFailed');
  });

  it('falls back to unknown for non-ApiError values', () => {
    expect(inviteErrorKey(new Error('boom'))).toBe('auth.errors.unknown');
  });
});

describe('invitationErrorKey', () => {
  it('maps INVITATION_EXPIRED to expired', () => {
    const err = new ApiError(422, { code: 'INVITATION_EXPIRED' });
    expect(invitationErrorKey(err)).toBe('invitations.errors.expired');
  });

  it('maps 410 to expired', () => {
    const err = new ApiError(410, { code: 'UNKNOWN' });
    expect(invitationErrorKey(err)).toBe('invitations.errors.expired');
  });

  it('maps MEMBERSHIP_ALREADY_EXISTS (AUTHZ-8) to alreadyMember', () => {
    const err = new ApiError(409, { code: 'MEMBERSHIP_ALREADY_EXISTS' });
    expect(invitationErrorKey(err)).toBe('invitations.errors.alreadyMember');
  });

  it('maps INVITATION_REVOKED (AUTH-9) to revoked', () => {
    const err = new ApiError(422, { code: 'INVITATION_REVOKED' });
    expect(invitationErrorKey(err)).toBe('invitations.errors.revoked');
  });

  it('maps NOT_FOUND / 404 to invalid', () => {
    expect(invitationErrorKey(new ApiError(404, { code: 'NOT_FOUND' }))).toBe('invitations.errors.invalid');
    expect(invitationErrorKey(new ApiError(404, { code: 'INVITATION_NOT_FOUND' }))).toBe('invitations.errors.invalid');
  });

  it('falls back to failed for other errors', () => {
    expect(invitationErrorKey(new ApiError(500, { code: 'INTERNAL_ERROR' }))).toBe('invitations.errors.failed');
    expect(invitationErrorKey(new Error('boom'))).toBe('invitations.errors.failed');
  });
});

describe('revokeInvitationErrorKey', () => {
  it('maps INVITATION_ALREADY_REVOKED (AUTH-9) to alreadyRevoked', () => {
    const err = new ApiError(409, { code: 'INVITATION_ALREADY_REVOKED' });
    expect(revokeInvitationErrorKey(err)).toBe('members.errors.alreadyRevoked');
  });

  it('maps INVITATION_ALREADY_ACCEPTED (AUTH-9) to alreadyAccepted', () => {
    const err = new ApiError(409, { code: 'INVITATION_ALREADY_ACCEPTED' });
    expect(revokeInvitationErrorKey(err)).toBe('members.errors.alreadyAccepted');
  });

  it('maps 404 NOT_FOUND to invitationNotFound (real wire format)', () => {
    const err = new ApiError(404, { code: 'NOT_FOUND' });
    expect(revokeInvitationErrorKey(err)).toBe('members.errors.invitationNotFound');
  });

  it('falls back to revokeFailed for other ApiError codes', () => {
    const err = new ApiError(500, { code: 'INTERNAL_ERROR' });
    expect(revokeInvitationErrorKey(err)).toBe('members.errors.revokeFailed');
  });

  it('falls back to unknown for non-ApiError values', () => {
    expect(revokeInvitationErrorKey(new Error('boom'))).toBe('auth.errors.unknown');
  });
});

describe('removeMemberErrorKey', () => {
  // The API sends NotFoundError as `code: 'NOT_FOUND'` with status 404 — the
  // domain constant (`MEMBERSHIP_NOT_FOUND`) is only the message, so the
  // match must be on the wire shape, not the domain constant.
  it('maps 404 NOT_FOUND to memberNotFound (real wire format)', () => {
    const err = new ApiError(404, { code: 'NOT_FOUND' });
    expect(removeMemberErrorKey(err)).toBe('members.errors.memberNotFound');
  });

  it('maps any 404 response to memberNotFound regardless of the code', () => {
    const err = new ApiError(404, { code: 'MEMBERSHIP_NOT_FOUND' });
    expect(removeMemberErrorKey(err)).toBe('members.errors.memberNotFound');
  });

  it('maps LAST_OWNER_CANNOT_REMOVE (AUTHZ-1) to lastOwnerRemove', () => {
    const err = new ApiError(403, { code: 'LAST_OWNER_CANNOT_REMOVE' });
    expect(removeMemberErrorKey(err)).toBe('members.errors.lastOwnerRemove');
  });

  it('falls back to actionFailed for other ApiError codes', () => {
    const err = new ApiError(500, { code: 'INTERNAL_ERROR' });
    expect(removeMemberErrorKey(err)).toBe('members.errors.actionFailed');
  });

  it('falls back to unknown for non-ApiError values', () => {
    expect(removeMemberErrorKey(new Error('boom'))).toBe('auth.errors.unknown');
  });
});

describe('updateRoleErrorKey', () => {
  it('maps 404 NOT_FOUND to memberNotFound (real wire format)', () => {
    const err = new ApiError(404, { code: 'NOT_FOUND' });
    expect(updateRoleErrorKey(err)).toBe('members.errors.memberNotFound');
  });

  it('maps CANNOT_CHANGE_OWN_ROLE (AUTHZ-3) to cannotChangeOwnRole', () => {
    const err = new ApiError(403, { code: 'CANNOT_CHANGE_OWN_ROLE' });
    expect(updateRoleErrorKey(err)).toBe('members.errors.cannotChangeOwnRole');
  });

  it('maps LAST_OWNER_CANNOT_DEMOTE (AUTHZ-1) to lastOwnerDemote', () => {
    const err = new ApiError(403, { code: 'LAST_OWNER_CANNOT_DEMOTE' });
    expect(updateRoleErrorKey(err)).toBe('members.errors.lastOwnerDemote');
  });

  it('falls back to actionFailed for other ApiError codes', () => {
    const err = new ApiError(500, { code: 'INTERNAL_ERROR' });
    expect(updateRoleErrorKey(err)).toBe('members.errors.actionFailed');
  });

  it('falls back to unknown for non-ApiError values', () => {
    expect(updateRoleErrorKey(new Error('boom'))).toBe('auth.errors.unknown');
  });
});

describe('safeNextPath', () => {
  it('allows same-origin relative paths', () => {
    expect(safeNextPath('/en/invitations/abc')).toBe('/en/invitations/abc');
    expect(safeNextPath('/dashboard')).toBe('/dashboard');
  });

  it('rejects empty and non-string values', () => {
    expect(safeNextPath(undefined)).toBeNull();
    expect(safeNextPath(null)).toBeNull();
    expect(safeNextPath('')).toBeNull();
  });

  it('rejects protocol-relative and absolute URLs (open-redirect guard)', () => {
    expect(safeNextPath('//evil.com')).toBeNull();
    expect(safeNextPath('https://evil.com')).toBeNull();
    expect(safeNextPath('http://evil.com')).toBeNull();
    expect(safeNextPath('javascript:alert(1)')).toBeNull();
    expect(safeNextPath('/\\evil.com')).toBeNull();
    expect(safeNextPath('\\evil.com')).toBeNull();
  });
});
