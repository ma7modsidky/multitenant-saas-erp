import { Inject, Injectable } from '@nestjs/common';

import { ForbiddenError, NotFoundError } from '../../../core/common/errors.js';
import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { MEMBERSHIP_NOT_FOUND, LAST_OWNER_CANNOT_REMOVE } from '../domain/errors.js';
import { MEMBERSHIP_REPOSITORY, type MembershipRepository } from '../ports/index.js';

/**
 * RemoveMemberUseCase — removes a member from the organization (AUTHZ-7).
 *
 * Business rules:
 * - AUTHZ-1: Last OWNER cannot be removed
 * - AUTHZ-7: Membership is soft-deleted
 */
@Injectable()
export class RemoveMemberUseCase {
  constructor(
    @Inject(MEMBERSHIP_REPOSITORY)
    private readonly membershipRepo: MembershipRepository,
    private readonly txManager: TransactionManager,
  ) {}

  async execute(input: { membershipId: string; organizationId: string; currentUserId?: string }): Promise<void> {
    const membership = await this.membershipRepo.findById(input.membershipId);

    if (!membership || membership.organizationId !== input.organizationId) {
      throw new NotFoundError(MEMBERSHIP_NOT_FOUND, { membershipId: input.membershipId });
    }

    await this.txManager.run(async (tx) => {
      // AUTHZ-1: Check if this is the last member with this role
      const sameRoleCount = await this.membershipRepo.countByOrgIdAndRoleId(input.organizationId, membership.roleId, tx);

      if (sameRoleCount <= 1) {
        throw new ForbiddenError(LAST_OWNER_CANNOT_REMOVE, 'The last member with this role cannot be removed (AUTHZ-1)');
      }

      await this.membershipRepo.update(input.membershipId, {
        status: 'inactive',
        deletedAt: new Date(),
        updatedBy: input.currentUserId ?? null,
      }, tx);
    });
  }
}
