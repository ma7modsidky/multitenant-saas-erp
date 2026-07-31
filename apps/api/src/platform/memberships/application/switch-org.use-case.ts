import { Inject, Injectable } from '@nestjs/common';

import { JwtTokenService } from '../../../core/auth/jwt-token.service.js';
import { ForbiddenError } from '../../../core/common/errors.js';
import { NOT_A_MEMBER } from '../domain/errors.js';
import { MEMBERSHIP_REPOSITORY, type MembershipRepository } from '../ports/index.js';

/**
 * SwitchOrgUseCase — switches the user's active organization (TEN-4).
 *
 * Business rules:
 * - TEN-4: User may belong to multiple orgs; switching re-issues tokens
 * - The old access token remains scoped to the old org until it expires
 */
@Injectable()
export class SwitchOrgUseCase {
  constructor(
    @Inject(MEMBERSHIP_REPOSITORY)
    private readonly membershipRepo: MembershipRepository,
    private readonly jwtTokenService: JwtTokenService,
  ) {}

  async execute(input: { userId: string; newOrganizationId: string }): Promise<{ accessToken: string; refreshToken: string }> {
    // Verify the user has an active membership in the target org
    const membership = await this.membershipRepo.findByUserAndOrg(input.userId, input.newOrganizationId);

    if (!membership) {
      throw new ForbiddenError(NOT_A_MEMBER, 'User is not a member of this organization (TEN-4)');
    }

    // Generate a new session first so its ID can be embedded in the access
    // token (AUTH-5 current-session marking).
    const { refreshToken, session } = await this.jwtTokenService.generateRefreshToken(
      input.userId,
      'org-switch',
    );

    // Generate new tokens scoped to the new organization
    const accessToken = await this.jwtTokenService.generateAccessToken({
      sub: input.userId,
      email: '',
      sessionId: session.id,
      organizationId: input.newOrganizationId,
      roles: [membership.roleId],
      permissions: [],
    });

    return { accessToken, refreshToken };
  }
}
