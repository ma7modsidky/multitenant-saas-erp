import { Inject, Injectable } from '@nestjs/common';

import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { SYSTEM_ROLES, SYSTEM_ROLE_PERMISSIONS, PLATFORM_PERMISSIONS, type SystemRoleKey } from '../domain/index.js';
import { ROLE_REPOSITORY, type RoleRepository } from '../ports/index.js';

/**
 * GetRoleMatrixUseCase — returns the role matrix for the UI.
 *
 * Returns:
 * - System roles with their built-in permissions
 * - Platform permission catalog
 * - Custom roles defined by the organization
 */
@Injectable()
export class GetRoleMatrixUseCase {
  constructor(
    @Inject(ROLE_REPOSITORY)
    private readonly roleRepo: RoleRepository,
    private readonly txManager: TransactionManager,
  ) {}

  async execute(input: { organizationId: string }): Promise<{
    systemRoles: Array<{ key: string; permissions: string[] }>;
    customRoles: Array<{
      id: string;
      key: string;
      nameI18n: Record<string, string>;
      description: string | null;
      permissions: string[];
    }>;
    platformPermissions: readonly string[];
    permissionCatalog: string[];
  }> {
    // core_roles / core_role_permissions are RLS-protected — read them inside
    // the tenant-bound transaction or they fail closed to zero rows.
    const [customRoles, permissionCatalog] = await this.txManager.run(async (tx) => {
      const [roles, catalog] = await Promise.all([
        this.roleRepo.findByOrgId(input.organizationId, tx),
        this.roleRepo.getAllRegisteredPermissions(input.organizationId, tx),
      ]);
      return [roles, catalog] as const;
    });

    // Build system roles matrix
    const roleKeys = Object.values(SYSTEM_ROLES) as SystemRoleKey[];
    const systemRoles = roleKeys.map((key) => ({
      key,
      permissions: [...(SYSTEM_ROLE_PERMISSIONS[key] ?? [])],
    }));

    // Build custom roles with their permissions
    const customRoleEntries = await Promise.all(
      customRoles
        .filter((r) => !r.isSystem)
        .map(async (r) => ({
          id: r.id,
          key: r.key,
          nameI18n: r.nameI18n,
          description: r.description,
          permissions: await this.txManager.run((tx) => this.roleRepo.getPermissions(r.id, tx)),
        })),
    );

    return {
      systemRoles,
      customRoles: customRoleEntries,
      platformPermissions: PLATFORM_PERMISSIONS,
      permissionCatalog,
    };
  }
}
