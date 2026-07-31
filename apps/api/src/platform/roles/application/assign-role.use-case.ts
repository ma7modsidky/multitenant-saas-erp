import { Inject, Injectable } from '@nestjs/common';

import { ForbiddenError, NotFoundError } from '../../../core/common/errors.js';
import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { ROLE_NOT_FOUND, CANNOT_GRANT_UNOWNED_PERMISSION } from '../domain/index.js';
import { ROLE_REPOSITORY, type RoleRepository } from '../ports/index.js';
import { MEMBERSHIP_REPOSITORY, type MembershipRepository } from '../../memberships/ports/index.js';

@Injectable()
export class AssignRoleUseCase {
  constructor(
    @Inject(ROLE_REPOSITORY)
    private readonly roleRepo: RoleRepository,
    @Inject(MEMBERSHIP_REPOSITORY)
    private readonly membershipRepo: MembershipRepository,
    private readonly txManager: TransactionManager,
  ) {}

  async execute(input: {
    organizationId: string;
    membershipId: string;
    newRoleId: string;
    currentUserId: string;
  }): Promise<void> {
    // Verify the new role exists
    const newRole = await this.roleRepo.findById(input.newRoleId);
    if (!newRole || newRole.organizationId !== input.organizationId) {
      throw new NotFoundError(ROLE_NOT_FOUND, { roleId: input.newRoleId });
    }

    // Verify the membership exists
    const membership = await this.membershipRepo.findById(input.membershipId);
    if (!membership || membership.organizationId !== input.organizationId) {
      throw new NotFoundError('MEMBERSHIP_NOT_FOUND', { membershipId: input.membershipId });
    }

    // AUTHZ-3: Cannot change own role
    if (membership.userId === input.currentUserId) {
      throw new ForbiddenError('CANNOT_CHANGE_OWN_ROLE', 'You cannot change your own role');
    }

    // AUTHZ-3: Cannot grant a permission you don't hold
    const assignerPerms = await this.roleRepo.getPermissions(membership.roleId);
    const newRolePerms = await this.roleRepo.getPermissions(input.newRoleId);
    const unowned = newRolePerms.filter((p) => !assignerPerms.includes(p));
    if (unowned.length > 0) {
      throw new ForbiddenError(
        CANNOT_GRANT_UNOWNED_PERMISSION,
        `You cannot grant permissions you do not have: ${unowned.join(', ')}`,
      );
    }

    await this.txManager.run(async (tx) => {
      await this.membershipRepo.update(input.membershipId, {
        roleId: input.newRoleId,
        updatedBy: input.currentUserId,
      }, tx);
    });
  }
}
