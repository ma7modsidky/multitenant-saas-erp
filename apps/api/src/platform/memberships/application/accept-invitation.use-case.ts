import * as crypto from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';

import { ConflictError, DomainError, NotFoundError } from '../../../core/common/errors.js';
import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { Invitation, INVITATION_NOT_FOUND, INVITATION_ALREADY_ACCEPTED, INVITATION_EXPIRED, MEMBERSHIP_ALREADY_EXISTS } from '../domain/index.js';
import { MEMBERSHIP_REPOSITORY, INVITATION_REPOSITORY, type MembershipRepository, type InvitationRepository } from '../ports/index.js';

/**
 * AcceptInvitationUseCase — accepts a pending invitation (AUTH-3, AUTH-9).
 *
 * Business rules:
 * - AUTH-9: Token must be valid (not expired, not used)
 * - AUTH-3: Accepting implicitly verifies the email
 * - AUTHZ-8: Duplicate membership is rejected
 */
@Injectable()
export class AcceptInvitationUseCase {
  constructor(
    @Inject(MEMBERSHIP_REPOSITORY)
    private readonly membershipRepo: MembershipRepository,
    @Inject(INVITATION_REPOSITORY)
    private readonly invitationRepo: InvitationRepository,
    private readonly txManager: TransactionManager,
  ) {}

  async execute(input: { invitationId: string; userId: string }): Promise<void> {
    const invitationData = await this.invitationRepo.findById(input.invitationId);

    if (!invitationData) {
      throw new NotFoundError(INVITATION_NOT_FOUND, { invitationId: input.invitationId });
    }

    const invitation = Invitation.fromPersistence(invitationData);

    // Validate invitation (AUTH-9)
    if (!invitation.isPending) {
      if (invitation.acceptedAt) throw new ConflictError(INVITATION_ALREADY_ACCEPTED, 'Already accepted');
      throw new DomainError(INVITATION_EXPIRED, 'Invitation has expired');
    }

    await this.txManager.run(async (tx) => {
      // Check for existing membership (AUTHZ-8)
      const existingMembership = await this.membershipRepo.findByUserAndOrg(
        input.userId,
        invitation.organizationId,
        tx,
      );

      if (existingMembership) {
        throw new ConflictError(MEMBERSHIP_ALREADY_EXISTS, 'User already has an active membership in this organization');
      }

      // Mark invitation as accepted
      invitation.accept();
      await this.invitationRepo.update(input.invitationId, { acceptedAt: invitation.acceptedAt }, tx);

      // Create membership
      await this.membershipRepo.insert({
        id: crypto.randomUUID(),
        organizationId: invitation.organizationId,
        userId: input.userId,
        roleId: invitation.roleId,
        status: 'active',
        joinedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: input.userId,
        updatedBy: input.userId,
        deletedAt: null,
      }, tx);
    });
  }
}
