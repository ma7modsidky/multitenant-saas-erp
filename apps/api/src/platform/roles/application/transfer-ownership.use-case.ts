import { Inject, Injectable } from '@nestjs/common';

import { ForbiddenError, NotFoundError, ConflictError } from '../../../core/common/errors.js';
import { TransactionManager } from '../../../core/database/transaction-manager.js';
import {
  ROLE_NOT_FOUND,
  TRANSFER_TARGET_NOT_FOUND,
  CANNOT_TRANSFER_TO_SELF,
  NOMINATION_REQUIRED,
} from '../domain/index.js';
import { ROLE_REPOSITORY, type RoleRepository } from '../ports/index.js';
import { MEMBERSHIP_REPOSITORY, type MembershipRepository } from '../../memberships/ports/index.js';

@Injectable()
export class TransferOwnershipUseCase {
  constructor(
    @Inject(ROLE_REPOSITORY)
    private readonly roleRepo: RoleRepository,
    @Inject(MEMBERSHIP_REPOSITORY)
    private readonly membershipRepo: MembershipRepository,
    private readonly txManager: TransactionManager,
  ) {}

  async execute(input: {
    organizationId: string;
    currentUserId: string;
    targetUserId: string;
  }): Promise<void> {
    // Cannot transfer to self
    if (input.currentUserId === input.targetUserId) {
      throw new ConflictError(CANNOT_TRANSFER_TO_SELF, 'Cannot transfer ownership to yourself');
    }

    // Find the OWNER role for this organization
    const ownerRole = await this.roleRepo.findByKey(input.organizationId, 'owner');
    if (!ownerRole) {
      throw new NotFoundError(ROLE_NOT_FOUND, { key: 'owner' });
    }

    // Find an admin role
    const adminRole = await this.roleRepo.findByKey(input.organizationId, 'admin');
    if (!adminRole) {
      throw new NotFoundError(ROLE_NOT_FOUND, { key: 'admin' });
    }

    await this.txManager.run(async (tx) => {
      // Verify the target is an active member
      const targetMembership = await this.membershipRepo.findByUserAndOrg(
        input.targetUserId,
        input.organizationId,
        tx as any,
      );

      if (!targetMembership) {
        throw new NotFoundError(TRANSFER_TARGET_NOT_FOUND, { targetUserId: input.targetUserId });
      }

      // Find the current user's membership
      const currentMembership = await this.membershipRepo.findByUserAndOrg(
        input.currentUserId,
        input.organizationId,
        tx as any,
      );
      if (!currentMembership) {
        throw new ForbiddenError(NOMINATION_REQUIRED, 'You must be an active member of this organization');
      }

      // Promote target to OWNER
      await this.membershipRepo.update(targetMembership.id, {
        roleId: ownerRole.id,
        updatedBy: input.currentUserId,
      } as any, tx);

      // Demote current owner to ADMIN
      await this.membershipRepo.update(currentMembership.id, {
        roleId: adminRole.id,
        updatedBy: input.currentUserId,
      } as any, tx);
    });
  }
}
