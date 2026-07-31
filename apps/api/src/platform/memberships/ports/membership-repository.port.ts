import type { TxOrDb } from '../../../core/database/repository.base.js';
import { type MembershipData } from '../domain/index.js';

export interface MembershipRepository {
  /** Find membership by its primary key. */
  findById(id: string, tx?: TxOrDb): Promise<MembershipData | undefined>;

  /** Find active membership for a user in an organization. */
  findByUserAndOrg(userId: string, organizationId: string, tx?: TxOrDb): Promise<MembershipData | undefined>;

  /** Find all memberships for a user across orgs. */
  findByUserId(userId: string, tx?: TxOrDb): Promise<MembershipData[]>;

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
