import * as crypto from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';

import { ConflictError, DomainError, NotFoundError } from '../../../core/common/errors.js';
import { TransactionManager } from '../../../core/database/transaction-manager.js';
import {
  Invitation,
  INVITATION_NOT_FOUND,
  INVITATION_ALREADY_ACCEPTED,
  INVITATION_EXPIRED,
  INVITATION_REVOKED,
  MEMBERSHIP_ALREADY_EXISTS,
} from '../domain/index.js';
import { USER_REPOSITORY, type UserRepository } from '../../users/ports/index.js';
import {
  MEMBERSHIP_REPOSITORY,
  INVITATION_REPOSITORY,
  type MembershipRepository,
  type InvitationRepository,
} from '../ports/index.js';

/**
 * AcceptInvitationUseCase — accepts a pending invitation (AUTH-3, AUTH-9).
 *
 * Business rules:
 * - AUTH-9: Token must be valid (not expired, not used)
 * - AUTH-3: Accepting implicitly verifies the email (email_verified_at is set)
 * - AUTHZ-8: Duplicate membership is rejected
 *
 * RLS notes:
 * - The invitation read happens inside TransactionManager.run() so the
 *   `user_own_invitations` policy (0009) — keyed on the authenticated user's
 *   email resolved via core_users — can match, even though the invitee is not
 *   yet a member and their token carries no organization.
 * - The membership write runs in runWithOrg(invitation.organizationId):
 *   core_memberships/core_invitations are org-scoped RLS, so the write must be
 *   bound to the invitation's org, not the (empty) context org.
 */
@Injectable()
export class AcceptInvitationUseCase {
  constructor(
    @Inject(MEMBERSHIP_REPOSITORY)
    private readonly membershipRepo: MembershipRepository,
    @Inject(INVITATION_REPOSITORY)
    private readonly invitationRepo: InvitationRepository,
    @Inject(USER_REPOSITORY)
    private readonly userRepo: UserRepository,
    private readonly txManager: TransactionManager,
  ) {}

  async execute(input: { invitationId: string; userId: string }): Promise<void> {
    // Read the invitation with the user's identity bound (user_own_invitations
    // policy matches on the invitee's email — not on org).
    const invitationData = await this.txManager.run((tx) => this.invitationRepo.findById(input.invitationId, tx));

    if (!invitationData) {
      throw new NotFoundError(INVITATION_NOT_FOUND, { invitationId: input.invitationId });
    }

    const invitation = Invitation.fromPersistence(invitationData);

    // Validate invitation (AUTH-9). Distinguish a REVOKED invitation from an
    // EXPIRED one — the entity's accept() throws INVITATION_REVOKED, and the
    // use case mirrors that so the UI can say "revoked" instead of "expired".
    if (!invitation.isPending) {
      if (invitation.acceptedAt) throw new ConflictError(INVITATION_ALREADY_ACCEPTED, 'Already accepted');
      if (invitation.revokedAt) throw new DomainError(INVITATION_REVOKED, 'Invitation has been revoked');
      throw new DomainError(INVITATION_EXPIRED, 'Invitation has expired');
    }

    await this.txManager.runWithOrg(invitation.organizationId, async (tx) => {
      // Check for existing membership (AUTHZ-8)
      const existingMembership = await this.membershipRepo.findByUserAndOrg(
        input.userId,
        invitation.organizationId,
        tx,
      );

      if (existingMembership) {
        throw new ConflictError(
          MEMBERSHIP_ALREADY_EXISTS,
          'User already has an active membership in this organization',
        );
      }

      // Mark invitation as accepted
      invitation.accept();
      await this.invitationRepo.update(input.invitationId, { acceptedAt: invitation.acceptedAt }, tx);

      // Create membership
      await this.membershipRepo.insert(
        {
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
        },
        tx,
      );

      // AUTH-3: accepting an invitation implicitly verifies the invitee's email.
      // core_users is a global (non-RLS) table, so the update is not org-scoped.
      await this.userRepo.update(input.userId, { emailVerifiedAt: new Date() }, tx);
    });
  }
}
