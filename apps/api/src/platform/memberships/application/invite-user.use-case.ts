import * as crypto from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';

import { ConflictError } from '../../../core/common/errors.js';
import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { MEMBERSHIP_ALREADY_EXISTS } from '../domain/index.js';
import { USER_REPOSITORY, type UserRepository } from '../../users/ports/index.js';
import {
  MEMBERSHIP_REPOSITORY,
  INVITATION_REPOSITORY,
  type MembershipRepository,
  type InvitationRepository,
} from '../ports/index.js';

/**
 * InviteUserUseCase — invites a user by email to join an organization.
 *
 * Business rules:
 * - AUTH-9: Invitation token expires in 7 days, stored hashed
 * - AUTHZ-8: Can't invite email with existing active membership
 * - AUTHZ-9: Seat limit check (delegated to caller / billing module)
 *
 * All reads run inside TransactionManager.run() so the org-scoped RLS context
 * is bound — `core_invitations` and `core_memberships` are RLS-protected and
 * reads outside the tenant transaction fail closed (TEN-3).
 */
@Injectable()
export class InviteUserUseCase {
  constructor(
    @Inject(MEMBERSHIP_REPOSITORY)
    private readonly membershipRepo: MembershipRepository,
    @Inject(INVITATION_REPOSITORY)
    private readonly invitationRepo: InvitationRepository,
    @Inject(USER_REPOSITORY)
    private readonly userRepo: UserRepository,
    private readonly txManager: TransactionManager,
  ) {}

  async execute(input: {
    name: string;
    email: string;
    roleId: string;
    organizationId: string;
    invitedBy: string;
  }): Promise<{ invitationId: string }> {
    const normalizedEmail = input.email.trim().toLowerCase();
    // The API DTO requires `name` (zod min(1)), but the use case is also
    // called directly (seeds, tests) — degrade gracefully to '' instead of
    // a raw TypeError on `undefined.trim()` (500).
    const inviteeName = input.name?.trim() ?? '';

    // Create invitation with hashed token (AUTH-9)
    const tokenHash = crypto.createHash('sha256').update(crypto.randomUUID()).digest('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    const invitationData = await this.txManager.run(async (tx) => {
      // AUTHZ-8: Can't invite an email that already has an active membership.
      // Resolve the invitee by email (NOT the inviter) and check their
      // membership in the target organization.
      const invitee = await this.userRepo.findByEmail(normalizedEmail, tx);
      if (invitee) {
        const existingMembership = await this.membershipRepo.findByUserAndOrg(invitee.id, input.organizationId, tx);
        if (existingMembership) {
          throw new ConflictError(MEMBERSHIP_ALREADY_EXISTS, 'This user already has an active membership');
        }
      }

      // AUTHZ-8: Check if there's a pending invitation for this email
      const existingInvitation = await this.invitationRepo.findPendingByEmail(
        normalizedEmail,
        input.organizationId,
        tx,
      );
      if (existingInvitation) {
        throw new ConflictError('INVITATION_ALREADY_PENDING', 'A pending invitation already exists for this email');
      }

      return this.invitationRepo.insert(
        {
          id: crypto.randomUUID(),
          organizationId: input.organizationId,
          name: inviteeName,
          email: normalizedEmail,
          roleId: input.roleId,
          tokenHash,
          expiresAt,
          acceptedAt: null,
          revokedAt: null,
          invitedBy: input.invitedBy,
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
        },
        tx,
      );
    });

    // In production, the rawToken would be sent via email.
    // For now, we return it in the response for development.
    return { invitationId: invitationData.id };
  }
}
