// Error-code → i18n-key mappers for platform API calls.
//
// The API returns stable machine-readable codes (see CODING_STANDARDS.md §7).
// These helpers translate the codes the memberships module can throw into the
// i18n keys the UI renders — so a legitimate business-rule rejection (e.g.
// AUTHZ-8: duplicate member/pending invitation) shows a *specific* message
// instead of a generic "please try again".

import { ApiError } from './index';

/**
 * Map an invite-creation error to a members-page i18n key.
 *
 * - `MEMBERSHIP_ALREADY_EXISTS` (AUTHZ-8): the email already has an active
 *   membership in the organization.
 * - `INVITATION_ALREADY_PENDING` (AUTHZ-8): a pending invitation already
 *   exists for the email.
 *
 * Anything else falls back to the generic invite failure message.
 */
export function inviteErrorKey(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case 'MEMBERSHIP_ALREADY_EXISTS':
        return 'members.errors.alreadyMember';
      case 'INVITATION_ALREADY_PENDING':
        return 'members.errors.alreadyPending';
    }
  }
  return err instanceof ApiError ? 'members.errors.inviteFailed' : 'auth.errors.unknown';
}

/**
 * Map an accept-invitation error to an invitations-page i18n key.
 *
 * - `INVITATION_EXPIRED` / 410: the invitation expired (AUTH-9)
 * - `INVITATION_REVOKED`: the inviter cancelled the invitation (AUTH-9)
 * - `NOT_FOUND` / 404: the invitation does not exist (or is not visible to
 *   the signed-in user — RLS fails closed, never reveals a row)
 * - `MEMBERSHIP_ALREADY_EXISTS` (AUTHZ-8): the signed-in user already belongs
 *   to the organization (e.g. the inviter opening their own invite link)
 *
 * Anything else falls back to the generic accept failure message. A 401 is
 * handled by the caller (it means "create an account / log in first").
 */
export function invitationErrorKey(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === 'INVITATION_EXPIRED' || err.status === 410) {
      return 'invitations.errors.expired';
    }
    if (err.code === 'INVITATION_REVOKED') {
      return 'invitations.errors.revoked';
    }
    if (err.code === 'NOT_FOUND' || err.status === 404) {
      return 'invitations.errors.invalid';
    }
    if (err.code === 'MEMBERSHIP_ALREADY_EXISTS') {
      return 'invitations.errors.alreadyMember';
    }
  }
  return 'invitations.errors.failed';
}

/**
 * Map a revoke-invitation error to a members-page i18n key.
 *
 * - `INVITATION_ALREADY_REVOKED` / 409: the invitation was already revoked
 * - `INVITATION_ALREADY_ACCEPTED` / 409: the invitee already accepted it
 * - 404 / `NOT_FOUND`: the invitation no longer exists (or belongs to
 *   another org — RLS fails closed)
 *
 * Anything else falls back to the generic revoke failure message.
 */
export function revokeInvitationErrorKey(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case 'INVITATION_ALREADY_REVOKED':
        return 'members.errors.alreadyRevoked';
      case 'INVITATION_ALREADY_ACCEPTED':
        return 'members.errors.alreadyAccepted';
    }
    if (err.status === 404 || err.code === 'NOT_FOUND') {
      return 'members.errors.invitationNotFound';
    }
  }
  return err instanceof ApiError ? 'members.errors.revokeFailed' : 'auth.errors.unknown';
}

/**
 * Map a remove-member error to a members-page i18n key.
 *
 * - 404 / `NOT_FOUND`: the membership no longer exists (already removed, or
 *   another org's id). NOTE: `NotFoundError` hardcodes `code: 'NOT_FOUND'`
 *   on the wire — `MEMBERSHIP_NOT_FOUND` is only its message — so the match
 *   is on status/code, not the domain constant.
 * - `LAST_OWNER_CANNOT_REMOVE` (AUTHZ-1): the last member with the OWNER
 *   role cannot be removed
 *
 * Anything else falls back to the generic action failure message.
 */
export function removeMemberErrorKey(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 404 || err.code === 'NOT_FOUND') {
      return 'members.errors.memberNotFound';
    }
    if (err.code === 'LAST_OWNER_CANNOT_REMOVE') {
      return 'members.errors.lastOwnerRemove';
    }
  }
  return err instanceof ApiError ? 'members.errors.actionFailed' : 'auth.errors.unknown';
}

/**
 * Map an update-member-role error to a members-page i18n key.
 *
 * - 404 / `NOT_FOUND`: the membership no longer exists (same wire-format
 *   note as removeMemberErrorKey)
 * - `CANNOT_CHANGE_OWN_ROLE` (AUTHZ-3): a user cannot change their own role
 * - `LAST_OWNER_CANNOT_DEMOTE` (AUTHZ-1): the last owner cannot be demoted
 *
 * Anything else falls back to the generic action failure message.
 */
export function updateRoleErrorKey(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 404 || err.code === 'NOT_FOUND') {
      return 'members.errors.memberNotFound';
    }
    switch (err.code) {
      case 'CANNOT_CHANGE_OWN_ROLE':
        return 'members.errors.cannotChangeOwnRole';
      case 'LAST_OWNER_CANNOT_DEMOTE':
        return 'members.errors.lastOwnerDemote';
    }
  }
  return err instanceof ApiError ? 'members.errors.actionFailed' : 'auth.errors.unknown';
}

/**
 * Validate a `next` redirect target read from a query param.
 *
 * Only same-origin relative paths are allowed — absolute URLs, protocol-
 * relative URLs (`//evil.com`), and backslash tricks are rejected so the
 * login/signup redirect can never be abused as an open redirect.
 */
export function safeNextPath(next: string | null | undefined): string | null {
  if (typeof next !== 'string' || next.length === 0) return null;
  // Only same-origin relative paths: reject protocol-relative (`//host`),
  // absolute (`https://host`), and backslash tricks (`/\\host`, `\\host`)
  // so the redirect can never be abused as an open redirect.
  if (!next.startsWith('/') || next.startsWith('//') || next.includes('\\')) return null;
  return next;
}
