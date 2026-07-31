import { DomainError } from '../../../core/common/errors.js';

/**
 * Membership status values.
 */
export type MembershipStatus = 'active' | 'inactive';

/**
 * Membership entity data (persisted to core_memberships).
 *
 * RLS-protected tenant table — organization_id is inherited from context.
 */
export interface MembershipData {
  id: string;
  organizationId: string;
  userId: string;
  roleId: string;
  status: MembershipStatus;
  joinedAt: Date;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
  updatedBy: string | null;
  deletedAt: Date | null;
}

/**
 * Membership — domain entity linking a user to an organization with a role.
 *
 * Business rules enforced:
 * - AUTHZ-1: Last OWNER cannot be removed/demoted
 * - AUTHZ-7: Removing a member soft-deletes the membership
 * - TEN-4: User may belong to multiple orgs; one active per token
 */
export class Membership {
  private constructor(private readonly data: MembershipData) {}

  static create(data: MembershipData): Membership {
    return new Membership(data);
  }

  static fromPersistence(data: MembershipData): Membership {
    return new Membership(data);
  }

  // ─── Getters ────────────────────────────────────────────────────────────────

  get id(): string { return this.data.id; }
  get organizationId(): string { return this.data.organizationId; }
  get userId(): string { return this.data.userId; }
  get roleId(): string { return this.data.roleId; }
  get status(): MembershipStatus { return this.data.status; }
  get joinedAt(): Date { return this.data.joinedAt; }
  get createdAt(): Date { return this.data.createdAt; }
  get updatedAt(): Date { return this.data.updatedAt; }
  get createdBy(): string | null { return this.data.createdBy; }
  get deletedAt(): Date | null { return this.data.deletedAt; }

  get isActive(): boolean {
    return this.data.status === 'active' && this.data.deletedAt === null;
  }

  /** Get all data as a plain object. */
  toJSON(): MembershipData {
    return { ...this.data };
  }

  // ─── Behaviour ─────────────────────────────────────────────────────────

  /**
   * Change the member's role (AUTHZ-1, AUTHZ-3).
   *
   * @param newRoleId - The new role ID
   * @param isLastOwner - Whether this member is the last OWNER
   * @param currentUserId - The user performing this action
   */
  changeRole(newRoleId: string, isLastOwner: boolean, currentUserId?: string): void {
    if (isLastOwner) {
      throw new MembershipError('LAST_OWNER_CANNOT_DEMOTE', 'The last owner cannot be demoted (AUTHZ-1)');
    }

    this.data.roleId = newRoleId;
    this.data.updatedBy = currentUserId ?? null;
  }

  /**
   * Soft-delete the membership (AUTHZ-7).
   *
   * @param isLastOwner - Whether this member is the last OWNER
   * @param currentUserId - The user performing this action
   */
  remove(isLastOwner: boolean, currentUserId?: string): void {
    if (isLastOwner) {
      throw new MembershipError('LAST_OWNER_CANNOT_REMOVE', 'The last owner cannot be removed (AUTHZ-1)');
    }

    this.data.status = 'inactive';
    this.data.deletedAt = new Date();
    this.data.updatedBy = currentUserId ?? null;
  }
}

/**
 * Membership-specific domain error (→ 422).
 */
export class MembershipError extends DomainError {
  constructor(
    override readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'MembershipError';
  }
}
