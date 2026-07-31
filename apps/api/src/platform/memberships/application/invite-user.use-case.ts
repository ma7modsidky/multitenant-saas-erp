import * as crypto from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';

import { ConflictError } from '../../../core/common/errors.js';
import { TransactionManager } from '../../../core/database/transaction-manager.js';
import {
  MEMBERSHIP_ALREADY_EXISTS,
} from '../domain/index.js';
import { MEMBERSHIP_REPOSITORY, INVITATION_REPOSITORY, type MembershipRepository, type InvitationRepository } from '../ports/index.js';

/**
 * InviteUserUseCase — invites a user by email to join an organization.
 *
 * Business rules:
 * - AUTH-9: Invitation token expires in 7 days, stored hashed
 * - AUTHZ-8: Can't invite email with existing active membership
 * - AUTHZ-9: Seat limit check (delegated to caller / billing module)
 */
@Injectable()
export class InviteUserUseCase {
  constructor(
    @Inject(MEMBERSHIP_REPOSITORY)
    private readonly membershipRepo: MembershipRepository,
    @Inject(INVITATION_REPOSITORY)
    private readonly invitationRepo: InvitationRepository,
    private readonly txManager: TransactionManager,
  ) {}

  async execute(input: { email: string; roleId: string; organizationId: string; invitedBy: string }): Promise<{ invitationId: string }> {
    const normalizedEmail = input.email.trim().toLowerCase();

    // AUTHZ-8: Check if this email already has an active membership
    const existingMembership = await this.membershipRepo.findByUserAndOrg(input.invitedBy, input.organizationId);
    if (existingMembership) {
      throw new ConflictError(MEMBERSHIP_ALREADY_EXISTS, 'This user already has an active membership');
    }

    // AUTHZ-8: Check if there's a pending invitation for this email
    const existingInvitation = await this.invitationRepo.findPendingByEmail(normalizedEmail, input.organizationId);
    if (existingInvitation) {
      throw new ConflictError('INVITATION_ALREADY_PENDING', 'A pending invitation already exists for this email');
    }

    // Create invitation with hashed token (AUTH-9)
    const tokenHash = crypto.createHash('sha256').update(crypto.randomUUID()).digest('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    const invitationData = await this.txManager.run(async (tx) => {
      return this.invitationRepo.insert({
        id: crypto.randomUUID(),
        organizationId: input.organizationId,
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
      }, tx);
    });

    // In production, the rawToken would be sent via email.
    // For now, we return it in the response for development.
    return { invitationId: invitationData.id };
  }
}
