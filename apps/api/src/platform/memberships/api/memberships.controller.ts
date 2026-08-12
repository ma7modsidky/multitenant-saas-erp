import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, UseGuards, UsePipes } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiCreatedResponse, ApiOkResponse } from '@nestjs/swagger';

import { Audit } from '../../../core/audit/__init__.js';
import { RequiresPermission } from '../../../core/authorization/__init__.js';
import { ForbiddenError, NotFoundError } from '../../../core/common/errors.js';
import { ZodValidationPipe } from '../../../core/common/zod-validation.pipe.js';
import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';
import {
  InviteUserUseCase,
  AcceptInvitationUseCase,
  RevokeInvitationUseCase,
  RemoveMemberUseCase,
  UpdateMembershipRoleUseCase,
  SwitchOrgUseCase,
} from '../application/index.js';
import {
  MEMBERSHIP_REPOSITORY,
  INVITATION_REPOSITORY,
  type MembershipRepository,
  type InvitationRepository,
} from '../ports/index.js';

import {
  inviteUserSchema,
  updateMemberRoleSchema,
  switchOrgSchema,
  InviteUserDto,
  UpdateMemberRoleDto,
  SwitchOrgDto,
  MemberResponse,
  InvitationResponse,
  MyOrganizationsEnvelopeResponse,
  MembersEnvelopeResponse,
  InvitationsEnvelopeResponse,
  InvitationCreatedEnvelopeResponse,
  SwitchOrgEnvelopeResponse,
  MembershipMessageEnvelopeResponse,
} from './dto/index.js';

/**
 * MembershipsController — REST endpoints for member management.
 *
 * All endpoints require JWT authentication.
 * Route prefix: /v1/memberships
 */
@Controller('v1')
@UseGuards(AuthGuard('jwt'))
export class MembershipsController {
  constructor(
    @Inject(MEMBERSHIP_REPOSITORY)
    private readonly membershipRepo: MembershipRepository,
    @Inject(INVITATION_REPOSITORY)
    private readonly invitationRepo: InvitationRepository,
    private readonly inviteUserUseCase: InviteUserUseCase,
    private readonly acceptInvitationUseCase: AcceptInvitationUseCase,
    private readonly removeMemberUseCase: RemoveMemberUseCase,
    private readonly updateMemberRoleUseCase: UpdateMembershipRoleUseCase,
    private readonly revokeInvitationUseCase: RevokeInvitationUseCase,
    private readonly switchOrgUseCase: SwitchOrgUseCase,
    private readonly txManager: TransactionManager,
  ) {}

  /**
   * GET /v1/users/me/organizations
   * List all organizations the current user belongs to (organization switcher).
   *
   * Reads the user's own memberships across orgs (TEN-4) via the
   * `user_own_memberships` RLS policy; the active org is flagged `current`.
   */
  @Get('users/me/organizations')
  @ApiOkResponse({ type: MyOrganizationsEnvelopeResponse })
  async listMyOrganizations(): Promise<{
    data: Array<{
      organizationId: string;
      organizationName: string;
      organizationSlug: string;
      roleId: string;
      status: string;
      organizationStatus: string;
      joinedAt: string;
      current: boolean;
    }>;
  }> {
    const userId = TenantContext.requireUserId();
    const currentOrgId = TenantContext.getOrganizationId();

    const orgs = await this.txManager.run(async (tx) => {
      return this.membershipRepo.findOrgsByUserId(userId, tx);
    });

    return {
      data: orgs.map((o) => ({
        organizationId: o.organizationId,
        organizationName: o.organizationName,
        organizationSlug: o.organizationSlug,
        roleId: o.roleId,
        status: o.status,
        organizationStatus: o.organizationStatus,
        joinedAt: o.joinedAt.toISOString(),
        current: o.organizationId === currentOrgId,
      })),
    };
  }

  /**
   * GET /v1/organizations/:orgId/members
   * List all members of an organization with their profile info.
   */
  @Get('organizations/:orgId/members')
  @ApiOkResponse({ type: MembersEnvelopeResponse })
  async listMembers(@Param('orgId') orgId: string): Promise<{ data: MemberResponse[] }> {
    const memberships = await this.txManager.run((tx) => this.membershipRepo.findMembersByOrgId(orgId, tx));

    return {
      data: memberships.map((m) => ({
        id: m.id,
        userId: m.userId,
        name: m.userName,
        email: m.userEmail,
        roleId: m.roleId,
        status: m.status,
        joinedAt: m.joinedAt.toISOString(),
      })),
    };
  }

  /**
   * GET /v1/organizations/:orgId/invitations
   * List all invitations for an organization.
   */
  @Get('organizations/:orgId/invitations')
  @ApiOkResponse({ type: InvitationsEnvelopeResponse })
  async listInvitations(@Param('orgId') orgId: string): Promise<{ data: InvitationResponse[] }> {
    const invitations = await this.txManager.run((tx) => this.invitationRepo.findByOrgId(orgId, tx));

    return {
      data: invitations.map((inv) => ({
        id: inv.id,
        name: inv.name,
        email: inv.email,
        roleId: inv.roleId,
        status: inv.acceptedAt ? 'accepted' : inv.revokedAt ? 'revoked' : 'pending',
        expiresAt: inv.expiresAt.toISOString(),
        createdAt: inv.createdAt.toISOString(),
      })),
    };
  }

  /**
   * POST /v1/organizations/:orgId/invitations
   * Invite a user by email.
   */
  @Post('organizations/:orgId/invitations')
  @ApiCreatedResponse({ type: InvitationCreatedEnvelopeResponse })
  @UsePipes(new ZodValidationPipe(inviteUserSchema))
  @RequiresPermission('platform:members:invite')
  @Audit({ action: 'CREATE', entityType: 'invitation', captureAfter: true })
  async invite(@Param('orgId') orgId: string, @Body() dto: InviteUserDto): Promise<{ data: { invitationId: string } }> {
    const userId = TenantContext.requireUserId();

    const result = await this.inviteUserUseCase.execute({
      name: dto.name,
      email: dto.email,
      roleId: dto.roleId,
      organizationId: orgId,
      invitedBy: userId,
    });

    return { data: result };
  }

  /**
   * POST /v1/invitations/:id/accept
   * Accept an invitation (AUTH-3, AUTH-9).
   */
  @Post('invitations/:id/accept')
  @ApiCreatedResponse({ type: MembershipMessageEnvelopeResponse })
  // Accepting creates a membership (AUD-1) — record it as the membership
  // creation so the audit page's entity filters classify it correctly.
  // NOTE: the invitee's access token carries NO organizationId (login mints
  // org-less claims; the org is bound only inside the use case via
  // runWithOrg), so AuditDbWriter skips the DB persistence for this entry
  // (it still lands in the in-memory AuditLogger). The membership creation
  // is itself the authoritative record; org-bound follow-ups (role change,
  // removal) audit normally.
  @Audit({ action: 'CREATE', entityType: 'membership' })
  async acceptInvitation(@Param('id') id: string): Promise<{ data: { message: string } }> {
    const userId = TenantContext.requireUserId();

    await this.acceptInvitationUseCase.execute({
      invitationId: id,
      userId,
    });

    return { data: { message: 'Invitation accepted. You are now a member of the organization.' } };
  }

  /**
   * PATCH /v1/memberships/:id/role
   * Update a member's role (AUTHZ-1, AUTHZ-2, AUTHZ-3).
   */
  @Patch('memberships/:id/role')
  @ApiOkResponse({ type: MembershipMessageEnvelopeResponse })
  @UsePipes(new ZodValidationPipe(updateMemberRoleSchema))
  @RequiresPermission('platform:members:assign-role')
  @Audit({ action: 'UPDATE', entityType: 'membership', captureAfter: true, captureBefore: true })
  async updateRole(@Param('id') id: string, @Body() dto: UpdateMemberRoleDto): Promise<{ data: { message: string } }> {
    const userId = TenantContext.requireUserId();
    const organizationId = TenantContext.requireOrganizationId();

    // AUTHZ-2: ownership is OWNER-managed — the use case needs the ACTOR's
    // role key (from the access-token claims, minted at switch-org) to reject
    // an ADMIN demoting an OWNER even when another owner exists.
    const currentUserRoleKey = TenantContext.getRoles()[0] ?? '';

    await this.updateMemberRoleUseCase.execute({
      membershipId: id,
      newRoleId: dto.roleId,
      newRoleKey: '',
      currentUserId: userId,
      currentUserRoleKey,
      organizationId,
    });

    return { data: { message: 'Member role updated.' } };
  }

  /**
   * DELETE /v1/memberships/:id
   * Remove a member (AUTHZ-1, AUTHZ-7).
   */
  @Delete('memberships/:id')
  @ApiOkResponse({ type: MembershipMessageEnvelopeResponse })
  @RequiresPermission('platform:members:remove')
  @Audit({ action: 'SOFT_DELETE', entityType: 'membership', captureBefore: true })
  async removeMember(@Param('id') id: string): Promise<{ data: { message: string } }> {
    const organizationId = TenantContext.requireOrganizationId();
    const userId = TenantContext.requireUserId();

    // AUTHZ-2: only an OWNER may remove an OWNER — pass the actor's role key.
    const currentUserRoleKey = TenantContext.getRoles()[0] ?? '';

    await this.removeMemberUseCase.execute({
      membershipId: id,
      organizationId,
      currentUserId: userId,
      currentUserRoleKey,
    });

    return { data: { message: 'Member removed.' } };
  }

  /**
   * POST /v1/organizations/:orgId/invitations/:id/revoke
   * Revoke a pending invitation (AUTH-9, AUTHZ-8).
   */
  @Post('organizations/:orgId/invitations/:id/revoke')
  @ApiCreatedResponse({ type: MembershipMessageEnvelopeResponse })
  @RequiresPermission('platform:members:invite')
  @Audit({ action: 'UPDATE', entityType: 'invitation', captureBefore: true })
  async revokeInvitation(@Param('id') id: string): Promise<{ data: { message: string } }> {
    // The caller's org comes from the session, never the path param (TEN-2);
    // the use case rejects an invitation that belongs to another org (404).
    const organizationId = TenantContext.requireOrganizationId();

    await this.revokeInvitationUseCase.execute({
      invitationId: id,
      organizationId,
    });

    return { data: { message: 'Invitation revoked.' } };
  }

  /**
   * POST /v1/auth/switch-org
   * Switch the active organization (TEN-4).
   */
  @Post('auth/switch-org')
  @ApiCreatedResponse({ type: SwitchOrgEnvelopeResponse })
  @UsePipes(new ZodValidationPipe(switchOrgSchema))
  async switchOrg(@Body() dto: SwitchOrgDto): Promise<{ data: { accessToken: string; refreshToken: string } }> {
    const userId = TenantContext.requireUserId();

    // The session that issued this switch is revoked after the new tokens
    // are minted (TEN-4) — the old refresh token must not keep re-issuing
    // access tokens scoped to the previous org. exactOptionalPropertyTypes:
    // capture into a narrowed local so the key is only present when the
    // session id is actually a string.
    const currentSessionId: string | undefined = TenantContext.getSessionId();

    const result = await this.switchOrgUseCase.execute({
      userId,
      newOrganizationId: dto.organizationId,
      ...(currentSessionId !== undefined ? { currentSessionId } : {}),
    });

    return { data: result };
  }
}
