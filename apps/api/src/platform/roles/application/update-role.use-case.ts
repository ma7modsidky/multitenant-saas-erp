import { Inject, Injectable } from '@nestjs/common';

import { NotFoundError } from '../../../core/common/errors.js';
import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { Role, ROLE_NOT_FOUND } from '../domain/index.js';
import { ROLE_REPOSITORY, type RoleRepository } from '../ports/index.js';

@Injectable()
export class UpdateRoleUseCase {
  constructor(
    @Inject(ROLE_REPOSITORY)
    private readonly roleRepo: RoleRepository,
    private readonly txManager: TransactionManager,
  ) {}

  async execute(input: {
    roleId: string;
    organizationId: string;
    nameI18n?: Record<string, string>;
    description?: string | null;
    permissionKeys?: string[];
    updatedBy: string;
  }): Promise<void> {
    const roleData = await this.roleRepo.findById(input.roleId);
    if (!roleData || roleData.organizationId !== input.organizationId) {
      throw new NotFoundError(ROLE_NOT_FOUND, { roleId: input.roleId });
    }

    const role = Role.fromPersistence(roleData);

    // Update metadata — use as any since we've already validated through the DTO
    const updateData: { nameI18n?: Record<string, string>; description?: string | null } = {};
    if (input.nameI18n !== undefined) updateData.nameI18n = input.nameI18n;
    if (input.description !== undefined) updateData.description = input.description;
    role.update(updateData, input.updatedBy);

    await this.txManager.run(async (tx) => {
      const roleUpdate: Record<string, unknown> = { updatedBy: input.updatedBy };
      if (input.nameI18n !== undefined) roleUpdate.nameI18n = role.nameI18n;
      if (input.description !== undefined) roleUpdate.description = role.description;

      await this.roleRepo.update(input.roleId, roleUpdate as any, tx);

      // Update permissions if provided
      if (input.permissionKeys !== undefined) {
        Role.validateCustomPermissions(input.permissionKeys);
        await this.roleRepo.setPermissions(input.roleId, input.permissionKeys, input.updatedBy, tx);
      }
    });
  }
}
