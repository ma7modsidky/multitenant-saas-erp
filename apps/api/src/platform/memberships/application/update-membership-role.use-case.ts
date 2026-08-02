import { Inject, Injectable } from '@nestjs/common';

import { JwtTokenService } from '../../../core/auth/jwt-token.service.js';
import { ForbiddenError, NotFoundError } from '../../../core/common/errors.js';
import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { SYSTEM_ROLES } from '../../roles/domain/index.js';
import {
  MEMBERSHIP_NOT_FOUND,
  LAST_OWNER_CANNOT_DEMOTE,
  ONLY_OWNER_CAN_DEMOTE,
  CANNOT_CHANGE_OWN_ROLE,
} from '../domain/errors.js';
import { MEMBERSHIP_REPOSITORY, type MembershipRepository } from '../ports/index.js';

/**
 * UpdateMembershipRoleUseCase — changes a member's role (AUTHZ-1, AUTHZ-2, AUTHZ-3).
 *
 * Business rules:
 * - AUTHZ-1: Last OWNER cannot be demoted
 * - AUTHZ-2: Ownership is OWNER-managed — only an OWNER may change another
 *   OWNER's role (ownership changes go through the explicit transfer flow)
 * - AUTHZ-3: User cannot change their own role
 *
 * Session security (AUTHZ-5 stale-claims window): after the role change the
 * affected member's refresh sessions are revoked, so their next refresh re-
 * resolves a FRESH access token instead of re-minting the OLD elevated
 * permissions from the session snapshot. Without this, a demoted owner
 * would keep owner-level claims for the session lifetime (refresh TTL).
 */
@Injectable()
export class UpdateMembershipRoleUseCase {
  constructor(
    @Inject(MEMBERSHIP_REPOSITORY)
    private readonly membershipRepo: MembershipRepository,
    private readonly txManager: TransactionManager,
    private readonly jwtTokenService: JwtTokenService,
  ) {}

  async execute(input: {
    membershipId: string;
    newRoleId: string;
    newRoleKey: string;
    currentUserId: string;
    currentUserRoleKey: string;
    organizationId: string;
  }): Promise<void> {
    // core_memberships is RLS-protected (tenant_isolation) — the read MUST
    // run inside the tenant-bound transaction or it fails closed to zero
    // rows, making every role change look like MEMBERSHIP_NOT_FOUND (404).
    const membership = await this.txManager.run((tx) => this.membershipRepo.findById(input.membershipId, tx));

    if (!membership || membership.organizationId !== input.organizationId) {
      throw new NotFoundError(MEMBERSHIP_NOT_FOUND, { membershipId: input.membershipId });
    }

    // AUTHZ-3: User cannot change their own role
    if (membership.userId === input.currentUserId) {
      throw new ForbiddenError(CANNOT_CHANGE_OWN_ROLE, 'You cannot change your own role (AUTHZ-3)');
    }

    await this.txManager.run(async (tx) => {
      // AUTHZ-2: ownership is OWNER-managed. Even when ANOTHER owner exists
      // (so the last-owner guard below would not fire), an ADMIN must not be
      // able to demote an OWNER — ownership changes are the explicit
      // owner-nominated transfer flow. The actor's role key comes from the
      // access-token claims (minted at switch-org; AUTHZ-5 snapshot).
      if (membership.roleKey === SYSTEM_ROLES.OWNER && input.currentUserRoleKey !== SYSTEM_ROLES.OWNER) {
        throw new ForbiddenError(ONLY_OWNER_CAN_DEMOTE, "Only an owner can change an owner's role (AUTHZ-2)");
      }

      // AUTHZ-1: only the last member holding the OWNER role is protected
      // from demotion. Members holding any other role may be freely
      // re-role'd (e.g. the only 'manager' can be promoted to admin).
      if (membership.roleKey === SYSTEM_ROLES.OWNER) {
        const ownerCount = await this.membershipRepo.countByOrgIdAndRoleId(input.organizationId, membership.roleId, tx);
        if (ownerCount <= 1) {
          throw new ForbiddenError(LAST_OWNER_CANNOT_DEMOTE, 'The last owner cannot be demoted (AUTHZ-1)');
        }
      }

      await this.membershipRepo.update(
        input.membershipId,
        {
          roleId: input.newRoleId,
          updatedBy: input.currentUserId,
        },
        tx,
      );
    });

    // AUTHZ-5: kill the affected member's sessions so their next token is
    // minted from the NEW role (their access token may still carry old
    // claims until it expires, but no refresh can re-issue the old ones).
    await this.jwtTokenService.revokeAllUserSessions(membership.userId, 'ROLE_CHANGED');
  }
}
