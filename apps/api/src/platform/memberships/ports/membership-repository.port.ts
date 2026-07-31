import type { TxOrDb } from '../../../core/database/repository.base.js';
import { type MembershipData } from '../domain/index.js';

export interface MembershipRepository {
  /** Find membership by its primary key. */
  findById(id: string, tx?: TxOrDb): Promise<MembershipData | undefined>;

  /** Find active membership for a user in an organization. */
  findByUserAndOrg(userId: string, organizationId: string, tx?: TxOrDb): Promise<MembershipData | undefined>;

  /** Find all memberships for a user across orgs. */
  findByUserId(userId: string, tx?: TxOrDb): Promise<MembershipData[]>;

  /**
   * Find all organizations a user belongs to, with org profile info.
   * Backs the organization switcher (GET /v1/users/me/organizations).
   * Rows are limited to the user's own memberships (user_own_memberships RLS policy).
   */
  findOrgsByUserId(userId: string, tx?: TxOrDb): Promise<Array<{
    organizationId: string;
    organizationName: string;
    organizationSlug: string;
    roleId: string;
    status: string;
    joinedAt: Date;
  }>>;

  /** Find all memberships for an organization. */
  findByOrgId(organizationId: string, tx?: TxOrDb): Promise<MembershipData[]>;

  /** Count active members in an organization. */
  countActiveByOrgId(organizationId: string, tx?: TxOrDb): Promise<number>;

  /** Count active members with a specific role. */
  countByOrgIdAndRoleId(organizationId: string, roleId: string, tx?: TxOrDb): Promise<number>;

  /** Insert a new membership. */
  insert(data: MembershipData, tx?: TxOrDb): Promise<MembershipData>;

  /** Update an existing membership. */
  update(id: string, data: Partial<MembershipData>, tx?: TxOrDb): Promise<MembershipData | undefined>;
}

export const MEMBERSHIP_REPOSITORY = Symbol('MEMBERSHIP_REPOSITORY');
