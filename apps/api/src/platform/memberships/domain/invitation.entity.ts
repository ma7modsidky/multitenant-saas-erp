import { DomainError } from '../../../core/common/errors.js';

/**
 * Invitation status values.
 */
export type InvitationStatus = 'pending' | 'accepted' | 'revoked';

/**
 * Invitation entity data (persisted to core_invitations).
 *
 * RLS-protected tenant table — organization_id is inherited from context.
 */
export interface InvitationData {
  id: string;
  organizationId: string;
  /** Display name of the invitee, as typed by the inviter (migration 0012). */
  name: string | null;
  email: string;
  roleId: string;
  tokenHash: string;
  expiresAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
  invitedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

/**
 * Invitation — domain entity for pending membership invitations.
 *
 * Business rules enforced:
 * - AUTH-9: Invitation tokens are single-use, expire in 7 days, stored hashed
 * - AUTHZ-8: Can't invite someone with active membership
 * - AUTHZ-9: Seat-limited plans check (enforced by use case)
 * - AUTH-3: Accepting implicitly verifies the email
 */
export class Invitation {
  private constructor(private readonly data: InvitationData) {}

  static create(data: InvitationData): Invitation {
    return new Invitation(data);
  }

  static fromPersistence(data: InvitationData): Invitation {
    return new Invitation(data);
  }

  // ─── Getters ────────────────────────────────────────────────────────────────

  get id(): string {
    return this.data.id;
  }
  get organizationId(): string {
    return this.data.organizationId;
  }
  get name(): string | null {
    return this.data.name;
  }
  get email(): string {
    return this.data.email;
  }
  get roleId(): string {
    return this.data.roleId;
  }
  get tokenHash(): string {
    return this.data.tokenHash;
  }
  get expiresAt(): Date {
    return this.data.expiresAt;
  }
  get acceptedAt(): Date | null {
    return this.data.acceptedAt;
  }
  get revokedAt(): Date | null {
    return this.data.revokedAt;
  }
  get invitedBy(): string | null {
    return this.data.invitedBy;
  }
  get createdAt(): Date {
    return this.data.createdAt;
  }

  get isPending(): boolean {
    return !this.data.acceptedAt && !this.data.revokedAt && new Date() < this.data.expiresAt;
  }

  get isExpired(): boolean {
    return !this.data.acceptedAt && !this.data.revokedAt && new Date() >= this.data.expiresAt;
  }

  /** Get all data as a plain object. */
  toJSON(): InvitationData {
    return { ...this.data };
  }

  // ─── Behaviour ─────────────────────────────────────────────────────────

  /**
   * Accept the invitation (AUTH-3, AUTH-9).
   * Implicitly marks the invitation as accepted.
   */
  accept(): void {
    if (this.data.acceptedAt) {
      throw new InvitationError('INVITATION_ALREADY_ACCEPTED', 'This invitation has already been accepted');
    }
    if (this.data.revokedAt) {
      throw new InvitationError('INVITATION_REVOKED', 'This invitation has been revoked');
    }
    if (this.isExpired) {
      throw new InvitationError('INVITATION_EXPIRED', 'This invitation has expired');
    }

    this.data.acceptedAt = new Date();
  }

  /**
   * Revoke the invitation.
   */
  revoke(): void {
    if (this.data.revokedAt) {
      throw new InvitationError('INVITATION_ALREADY_REVOKED', 'This invitation has already been revoked');
    }
    if (this.data.acceptedAt) {
      throw new InvitationError('INVITATION_ALREADY_ACCEPTED', 'Cannot revoke an accepted invitation');
    }

    this.data.revokedAt = new Date();
  }
}

/**
 * Invitation-specific domain error.
 */
export class InvitationError extends DomainError {
  constructor(
    override readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'InvitationError';
  }
}
