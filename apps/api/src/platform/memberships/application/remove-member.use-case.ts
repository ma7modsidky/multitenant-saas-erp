import { Inject, Injectable } from '@nestjs/common';

import { JwtTokenService } from '../../../core/auth/jwt-token.service.js';
import { ForbiddenError, NotFoundError } from '../../../core/common/errors.js';
import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { SYSTEM_ROLES } from '../../roles/domain/index.js';
import { MEMBERSHIP_NOT_FOUND, LAST_OWNER_CANNOT_REMOVE, ONLY_OWNER_CAN_REMOVE } from '../domain/errors.js';
import { MEMBERSHIP_REPOSITORY, type MembershipRepository } from '../ports/index.js';

/**
 * RemoveMemberUseCase — removes a member from the organization (AUTHZ-2, AUTHZ-7).
 *
 * Business rules:
 * - AUTHZ-1: Last OWNER cannot be removed
 * - AUTHZ-2: Ownership is OWNER-managed — only an OWNER may remove another
 *   OWNER
 * - AUTHZ-7: Membership is soft-deleted
 *
 * Session security (AUTHZ-5 stale-claims window): the removed member's
 * refresh sessions are revoked so their existing token cannot refresh into
 * this organization with old permissions after the membership is gone.
 */
@Injectable()
export class RemoveMemberUseCase {
  constructor(
    @Inject(MEMBERSHIP_REPOSITORY)
    private readonly membershipRepo: MembershipRepository,
    private readonly txManager: TransactionManager,
    private readonly jwtTokenService: JwtTokenService,
  ) {}

  async execute(input: {
    membershipId: string;
    organizationId: string;
    currentUserId?: string;
    currentUserRoleKey: string;
  }): Promise<void> {
    // core_memberships is RLS-protected (tenant_isolation) — the read MUST
    // run inside the tenant-bound transaction or it fails closed to zero
    // rows, making every removal look like MEMBERSHIP_NOT_FOUND (404).
    const membership = await this.txManager.run((tx) => this.membershipRepo.findById(input.membershipId, tx));

    if (!membership || membership.organizationId !== input.organizationId) {
      throw new NotFoundError(MEMBERSHIP_NOT_FOUND, { membershipId: input.membershipId });
    }

    await this.txManager.run(async (tx) => {
      // AUTHZ-2: ownership is OWNER-managed — an ADMIN must not be able to
      // remove an OWNER (even when another owner exists). Actor role key from
      // the access-token claims (minted at switch-org; AUTHZ-5 snapshot).
      if (membership.roleKey === SYSTEM_ROLES.OWNER && input.currentUserRoleKey !== SYSTEM_ROLES.OWNER) {
        throw new ForbiddenError(ONLY_OWNER_CAN_REMOVE, 'Only an owner can remove an owner (AUTHZ-2)');
      }

      // AUTHZ-1: only the last member holding the OWNER role is protected
      // from removal. Members holding any other role may be removed freely.
      if (membership.roleKey === SYSTEM_ROLES.OWNER) {
        const ownerCount = await this.membershipRepo.countByOrgIdAndRoleId(input.organizationId, membership.roleId, tx);
        if (ownerCount <= 1) {
          throw new ForbiddenError(LAST_OWNER_CANNOT_REMOVE, 'The last owner cannot be removed (AUTHZ-1)');
        }
      }

      await this.membershipRepo.update(
        input.membershipId,
        {
          status: 'inactive',
          deletedAt: new Date(),
          updatedBy: input.currentUserId ?? null,
        },
        tx,
      );
    });

    // AUTHZ-7/AUTHZ-5: the removed member keeps their account but loses this
    // org's sessions — their refresh token can no longer re-issue an access
    // token scoped to this organization.
    await this.jwtTokenService.revokeAllUserSessions(membership.userId, 'MEMBER_REMOVED');
  }
}
