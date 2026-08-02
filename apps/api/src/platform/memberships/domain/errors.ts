/**
 * Memberships module domain error codes.
 */

/** The last active owner cannot be removed or demoted (AUTHZ-1). */
export const LAST_OWNER_CANNOT_REMOVE = 'LAST_OWNER_CANNOT_REMOVE';

/** Cannot assign a different role to the last owner (AUTHZ-1). */
export const LAST_OWNER_CANNOT_DEMOTE = 'LAST_OWNER_CANNOT_DEMOTE';

/** Only the OWNER role can change another OWNER's role (AUTHZ-2 ownership management). */
export const ONLY_OWNER_CAN_DEMOTE = 'ONLY_OWNER_CAN_DEMOTE';

/** Only the OWNER role can remove another OWNER (AUTHZ-2 ownership management). */
export const ONLY_OWNER_CAN_REMOVE = 'ONLY_OWNER_CAN_REMOVE';

/** A pending invitation for this email already has an active membership (AUTHZ-8). */
export const MEMBERSHIP_ALREADY_EXISTS = 'MEMBERSHIP_ALREADY_EXISTS';

/** Seat-limited plan would be exceeded (AUTHZ-9). */
export const SEAT_LIMIT_EXCEEDED = 'SEAT_LIMIT_EXCEEDED';

/** Membership not found. */
export const MEMBERSHIP_NOT_FOUND = 'MEMBERSHIP_NOT_FOUND';

/** User is not a member of this organization. */
export const NOT_A_MEMBER = 'NOT_A_MEMBER';

/** User cannot change their own role (AUTHZ-3). */
export const CANNOT_CHANGE_OWN_ROLE = 'CANNOT_CHANGE_OWN_ROLE';

/** Invitation not found. */
export const INVITATION_NOT_FOUND = 'INVITATION_NOT_FOUND';

/** Invitation already accepted. */
export const INVITATION_ALREADY_ACCEPTED = 'INVITATION_ALREADY_ACCEPTED';

/** Invitation already revoked. */
export const INVITATION_ALREADY_REVOKED = 'INVITATION_ALREADY_REVOKED';

/** Invitation has expired. */
export const INVITATION_EXPIRED = 'INVITATION_EXPIRED';

/** Invitation was revoked before it could be accepted (AUTH-9). */
export const INVITATION_REVOKED = 'INVITATION_REVOKED';
