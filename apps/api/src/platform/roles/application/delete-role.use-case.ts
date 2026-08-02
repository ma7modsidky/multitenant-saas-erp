import { Inject, Injectable } from '@nestjs/common';

import { ForbiddenError, NotFoundError } from '../../../core/common/errors.js';
import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { Role, ROLE_NOT_FOUND } from '../domain/index.js';
import { ROLE_REPOSITORY, type RoleRepository } from '../ports/index.js';

@Injectable()
export class DeleteRoleUseCase {
  constructor(
    @Inject(ROLE_REPOSITORY)
    private readonly roleRepo: RoleRepository,
    private readonly txManager: TransactionManager,
  ) {}

  async execute(input: { roleId: string; organizationId: string; updatedBy?: string }): Promise<void> {
    // core_roles / core_memberships are RLS-protected — reads must run inside
    // the tenant-bound transaction or they fail closed to zero rows.
    const roleData = await this.txManager.run((tx) => this.roleRepo.findById(input.roleId, tx));
    if (!roleData || roleData.organizationId !== input.organizationId) {
      throw new NotFoundError(ROLE_NOT_FOUND, { roleId: input.roleId });
    }

    const role = Role.fromPersistence(roleData);

    // Check if this is the last OWNER role
    const ownerCount = await this.txManager.run((tx) =>
      this.roleRepo.countMembersByRoleId(input.organizationId, input.roleId, tx),
    );
    const isLastOwnerRole = role.isOwnerRole && ownerCount <= 1;

    // Validate deletion (handles system role and last owner checks)
    role.delete(isLastOwnerRole, input.updatedBy);

    await this.txManager.run(async (tx) => {
      await this.roleRepo.softDelete(input.roleId, input.updatedBy, tx);
    });
  }
}
