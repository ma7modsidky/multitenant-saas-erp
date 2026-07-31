import { Inject, Injectable } from '@nestjs/common';

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
  ) {}

  async execute(input: { organizationId: string }): Promise<{
    systemRoles: Array<{ key: string; permissions: string[] }>;
    customRoles: Array<{ id: string; key: string; nameI18n: Record<string, string>; description: string | null; permissions: string[] }>;
    platformPermissions: readonly string[];
    permissionCatalog: string[];
  }> {
    const [customRoles, permissionCatalog] = await Promise.all([
      this.roleRepo.findByOrgId(input.organizationId),
      this.roleRepo.getAllRegisteredPermissions(input.organizationId),
    ]);

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
          permissions: await this.roleRepo.getPermissions(r.id),
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
