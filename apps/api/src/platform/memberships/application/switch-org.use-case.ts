import { Inject, Injectable } from '@nestjs/common';

import { JwtTokenService } from '../../../core/auth/jwt-token.service.js';
import { ForbiddenError } from '../../../core/common/errors.js';
import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { SYSTEM_ROLE_PERMISSIONS } from '../../roles/domain/index.js';
import { USER_REPOSITORY, type UserRepository } from '../../users/ports/index.js';
import { NOT_A_MEMBER } from '../domain/errors.js';
import { MEMBERSHIP_REPOSITORY, type MembershipRepository } from '../ports/index.js';

/**
 * SwitchOrgUseCase — switches the user's active organization (TEN-4).
 *
 * Business rules:
 * - TEN-4: User may belong to multiple orgs; switching re-issues tokens
 * - The old access token remains scoped to the old org until it expires
 * - AUTHZ-5: The new token embeds the member's role KEY and effective
 *   permission keys so PermissionGuard can enforce @RequiresPermission.
 * - TEN-4/AUTH-5: The previous session is revoked so the old refresh token
 *   cannot keep re-issuing access tokens scoped to the OLD org with stale
 *   claims (a stale client must switch back explicitly).
 */
@Injectable()
export class SwitchOrgUseCase {
  constructor(
    @Inject(MEMBERSHIP_REPOSITORY)
    private readonly membershipRepo: MembershipRepository,
    @Inject(USER_REPOSITORY)
    private readonly userRepo: UserRepository,
    private readonly jwtTokenService: JwtTokenService,
    private readonly txManager: TransactionManager,
  ) {}

  async execute(input: {
    userId: string;
    newOrganizationId: string;
    currentSessionId?: string;
  }): Promise<{ accessToken: string; refreshToken: string }> {
    // Verify the user has an active membership in the target org.
    // Must run inside a transaction so set_config('app.current_user_id') is
    // bound, enabling the user_own_memberships RLS SELECT policy to match
    // even when the active token carries no organizationId (e.g., right after
    // signup when the user hasn't switched into any org yet).
    const membership = await this.txManager.run(async (tx) =>
      this.membershipRepo.findByUserAndOrg(input.userId, input.newOrganizationId, tx),
    );

    if (!membership) {
      throw new ForbiddenError(NOT_A_MEMBER, 'User is not a member of this organization (TEN-4)');
    }

    // AUTHZ-5: resolve the role's key + effective permissions so the access
    // token carries the authorization claims. System roles keep their matrix
    // code-defined (SYSTEM_ROLE_PERMISSIONS); custom roles read their
    // persisted core_role_permissions rows.
    //
    // RLS CRITICAL: the lookup runs inside runWithOrg(newOrganizationId), NOT
    // txManager.run(). A freshly signed-in user's token carries NO
    // organizationId, so txManager.run() binds only app.current_user_id;
    // core_roles/core_role_permissions are protected by the org-based
    // tenant_isolation policy (no user_own_* equivalent for roles), so the
    // read would FAIL CLOSED to zero rows → role undefined → the minted token
    // gets roles:[] + permissions:[] even for an OWNER — hiding every
    // permission-gated UI control (the sidebar Members/Roles/Billing
    // regression). Binding the target org explicitly makes the role row
    // visible; the membership check above already proved the user belongs to
    // this org (user_own_memberships policy, 0007).
    const role = await this.txManager.runWithOrg(input.newOrganizationId, (tx) =>
      this.membershipRepo.resolveRolePermissions(input.newOrganizationId, membership.roleId, tx),
    );

    const permissions = role
      ? role.isSystem
        ? [...(SYSTEM_ROLE_PERMISSIONS[role.roleKey] ?? [])]
        : role.permissions
      : [];
    const roles = role && role.roleKey ? [role.roleKey] : [];

    // The platform-admin flag (PLT-1) is user-level, not org-scoped: it must
    // survive an org switch, so it is resolved from core_users (global, no
    // RLS) and carried into the new session + access token.
    const userData = await this.userRepo.findById(input.userId);
    const isPlatformAdmin = userData?.isPlatformAdmin ?? false;

    // Generate a new session first so its ID can be embedded in the access
    // token (AUTH-5 current-session marking). The session records the org +
    // authz claims so a token refresh can re-issue the same org/roles/
    // permissions instead of resetting them to empty (AUTHZ-5).
    //
    // Snapshot semantics: roles/permissions are resolved at switch-org time
    // and live in the access token (15-min TTL) and the session record, so a
    // role change takes effect for a member on their NEXT token issuance
    // (refresh or re-login), matching the standard JWT claims model.
    const { refreshToken, session } = await this.jwtTokenService.generateRefreshToken(
      input.userId,
      'org-switch',
      undefined,
      {
        organizationId: input.newOrganizationId,
        roles,
        permissions,
        isPlatformAdmin,
      },
    );

    // Generate new tokens scoped to the new organization
    const accessToken = await this.jwtTokenService.generateAccessToken({
      sub: input.userId,
      email: '',
      sessionId: session.id,
      organizationId: input.newOrganizationId,
      roles,
      permissions,
      isPlatformAdmin,
    });

    // TEN-4/AUTH-5: the session that issued this switch is now stale — it
    // remains scoped to the OLD org (its refresh token would keep re-minting
    // old-org access tokens). Revoke it so the only live session is the new
    // org-scoped one. Best-effort: never fail the switch over revocation.
    if (input.currentSessionId !== undefined && input.currentSessionId !== session.id) {
      try {
        await this.jwtTokenService.revokeSession(input.currentSessionId, 'ORG_SWITCHED');
      } catch {
        // Revocation is best-effort: a store outage must not fail the switch.
        // The stale session merely lives until its refresh TTL expires.
      }
    }

    return { accessToken, refreshToken };
  }
}
