import { Inject, Injectable } from '@nestjs/common';

import { ForbiddenError, NotFoundError } from '../../../core/common/errors.js';
import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { MEMBERSHIP_NOT_FOUND, LAST_OWNER_CANNOT_DEMOTE, CANNOT_CHANGE_OWN_ROLE } from '../domain/errors.js';
import { MEMBERSHIP_REPOSITORY, type MembershipRepository } from '../ports/index.js';

/**
 * UpdateMembershipRoleUseCase — changes a member's role (AUTHZ-1, AUTHZ-3).
 *
 * Business rules:
 * - AUTHZ-1: Last OWNER cannot be demoted
 * - AUTHZ-3: User cannot change their own role
 */
@Injectable()
export class UpdateMembershipRoleUseCase {
  constructor(
    @Inject(MEMBERSHIP_REPOSITORY)
    private readonly membershipRepo: MembershipRepository,
    private readonly txManager: TransactionManager,
  ) {}

  async execute(input: { membershipId: string; newRoleId: string; newRoleKey: string; currentUserId: string; organizationId: string }): Promise<void> {
    const membership = await this.membershipRepo.findById(input.membershipId);

    if (!membership || membership.organizationId !== input.organizationId) {
      throw new NotFoundError(MEMBERSHIP_NOT_FOUND, { membershipId: input.membershipId });
    }

    // AUTHZ-3: User cannot change their own role
    if (membership.userId === input.currentUserId) {
      throw new ForbiddenError(CANNOT_CHANGE_OWN_ROLE, 'You cannot change your own role (AUTHZ-3)');
    }

    await this.txManager.run(async (tx) => {
      // Check if this is the last OWNER being demoted (AUTHZ-1)
      const ownerCount = await this.membershipRepo.countByOrgIdAndRoleId(input.organizationId, membership.roleId, tx);

      if (ownerCount <= 1) {
        // This user is the only member with this role
        throw new ForbiddenError(LAST_OWNER_CANNOT_DEMOTE, 'The last owner cannot be demoted (AUTHZ-1)');
      }

      await this.membershipRepo.update(input.membershipId, {
        roleId: input.newRoleId,
        updatedBy: input.currentUserId,
      }, tx);
    });
  }
}
