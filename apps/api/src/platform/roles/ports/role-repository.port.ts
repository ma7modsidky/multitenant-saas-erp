import type { TxOrDb } from '../../../core/database/repository.base.js';
import { type RoleData, type RolePermissionData } from '../domain/index.js';

export interface RoleRepository {
  /** Find a role by its primary key. */
  findById(id: string, tx?: TxOrDb): Promise<RoleData | undefined>;

  /** Find a role by its key within an organization. */
  findByKey(organizationId: string, key: string, tx?: TxOrDb): Promise<RoleData | undefined>;

  /** List all non-deleted roles for an organization. */
  findByOrgId(organizationId: string, tx?: TxOrDb): Promise<RoleData[]>;

  /** Insert a new role. */
  insert(data: RoleData, tx?: TxOrDb): Promise<RoleData>;

  /** Update an existing role. */
  update(id: string, data: Partial<RoleData>, tx?: TxOrDb): Promise<RoleData | undefined>;

  /** Soft-delete a role. */
  softDelete(id: string, updatedBy?: string, tx?: TxOrDb): Promise<void>;

  /** Count active members with a specific role. */
  countMembersByRoleId(organizationId: string, roleId: string, tx?: TxOrDb): Promise<number>;

  // ─── Permissions ────────────────────────────────────────────────────────

  /** Get all permission keys for a role. */
  getPermissions(roleId: string, tx?: TxOrDb): Promise<string[]>;

  /** Set permissions for a role (replace all). */
  setPermissions(roleId: string, permissionKeys: string[], createdBy: string, tx?: TxOrDb): Promise<void>;

  /** Get all registered permission keys from core_permissions. */
  getAllRegisteredPermissions(organizationId: string, tx?: TxOrDb): Promise<string[]>;
}

export const ROLE_REPOSITORY = Symbol('ROLE_REPOSITORY');
