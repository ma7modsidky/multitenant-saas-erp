import { Inject, Injectable } from '@nestjs/common';

import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { SYSTEM_ROLE_PERMISSIONS } from '../domain/index.js';
import { ROLE_REPOSITORY, type RoleRepository } from '../ports/index.js';

/**
 * ResolveRolePermissionsService — resolves a role's EFFECTIVE permission keys.
 *
 * System roles keep their permission matrix code-defined (SYSTEM_ROLE_PERMISSIONS,
 * BUSINESS_RULES.md §3) — those rows are not persisted per-org. Custom roles
 * persist their permission keys in core_role_permissions.
 *
 * This service is the single source of truth used when minting access tokens
 * (switch-org) and when the permission matrix is rendered, so the JWT payload
 * and the guard checks can never drift from the documented matrix.
 *
 * @see BUSINESS_RULES.md §3 — Role matrix
 * @see AUTHZ-5 — Permission checks are declarative via @RequiresPermission
 */
@Injectable()
export class ResolveRolePermissionsService {
  constructor(
    @Inject(ROLE_REPOSITORY)
    private readonly roleRepo: RoleRepository,
    private readonly txManager: TransactionManager,
  ) {}

  /**
   * Resolve the effective permissions for a role inside its organization.
   *
   * RLS-protected tables (core_roles, core_role_permissions) are read inside
   * the tenant-bound transaction.
   *
   * @param input - organizationId + roleId of the role to resolve
   * @returns The role key and its effective permission keys
   */
  async execute(input: { organizationId: string; roleId: string }): Promise<{
    roleKey: string;
    permissions: string[];
  }> {
    const role = await this.txManager.run((tx) => this.roleRepo.findById(input.roleId, tx));

    // A role must exist and belong to the active org (RLS fails closed to zero
    // rows for other tenants). Fail closed rather than minting an empty token.
    if (!role || role.organizationId !== input.organizationId) {
      return { roleKey: '', permissions: [] };
    }

    // System roles: matrix is code-defined. Custom roles: persisted per-org.
    const permissions = role.isSystem
      ? [...(SYSTEM_ROLE_PERMISSIONS[role.key] ?? [])]
      : await this.txManager.run((tx) => this.roleRepo.getPermissions(role.id, tx));

    return { roleKey: role.key, permissions };
  }
}
