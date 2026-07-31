import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  UseGuards,
  UsePipes,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

import { ForbiddenError, NotFoundError } from '../../../core/common/errors.js';
import { ZodValidationPipe } from '../../../core/common/zod-validation.pipe.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';
import {
  InviteUserUseCase,
  AcceptInvitationUseCase,
  RemoveMemberUseCase,
  UpdateMembershipRoleUseCase,
  SwitchOrgUseCase,
} from '../application/index.js';
import { MEMBERSHIP_REPOSITORY, INVITATION_REPOSITORY, type MembershipRepository, type InvitationRepository } from '../ports/index.js';
import {
  inviteUserSchema,
  updateMemberRoleSchema,
  switchOrgSchema,
  acceptInvitationSchema,
  type InviteUserDto,
  type UpdateMemberRoleDto,
  type SwitchOrgDto,
  type AcceptInvitationDto,
  type MemberResponse,
  type InvitationResponse,
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
    private readonly switchOrgUseCase: SwitchOrgUseCase,
  ) {}

  /**
   * GET /v1/organizations/:orgId/members
   * List all members of an organization.
   */
  @Get('organizations/:orgId/members')
  async listMembers(@Param('orgId') orgId: string): Promise<{ data: MemberResponse[] }> {
    const memberships = await this.membershipRepo.findByOrgId(orgId);

    return {
      data: memberships.map((m) => ({
        id: m.id,
        userId: m.userId,
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
  async listInvitations(@Param('orgId') orgId: string): Promise<{ data: InvitationResponse[] }> {
    const invitations = await this.invitationRepo.findByOrgId(orgId);

    return {
      data: invitations.map((inv) => ({
        id: inv.id,
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
  @UsePipes(new ZodValidationPipe(inviteUserSchema))
  async invite(
    @Param('orgId') orgId: string,
    @Body() dto: InviteUserDto,
  ): Promise<{ data: { invitationId: string } }> {
    const userId = TenantContext.requireUserId();

    const result = await this.inviteUserUseCase.execute({
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
   * Update a member's role (AUTHZ-1, AUTHZ-3).
   */
  @Patch('memberships/:id/role')
  @UsePipes(new ZodValidationPipe(updateMemberRoleSchema))
  async updateRole(
    @Param('id') id: string,
    @Body() dto: UpdateMemberRoleDto,
  ): Promise<{ data: { message: string } }> {
    const userId = TenantContext.requireUserId();
    const organizationId = TenantContext.requireOrganizationId();

    await this.updateMemberRoleUseCase.execute({
      membershipId: id,
      newRoleId: dto.roleId,
      newRoleKey: '',
      currentUserId: userId,
      organizationId,
    });

    return { data: { message: 'Member role updated.' } };
  }

  /**
   * DELETE /v1/memberships/:id
   * Remove a member (AUTHZ-1, AUTHZ-7).
   */
  @Delete('memberships/:id')
  async removeMember(@Param('id') id: string): Promise<{ data: { message: string } }> {
    const organizationId = TenantContext.requireOrganizationId();
    const userId = TenantContext.requireUserId();

    await this.removeMemberUseCase.execute({
      membershipId: id,
      organizationId,
      currentUserId: userId,
    });

    return { data: { message: 'Member removed.' } };
  }

  /**
   * POST /v1/auth/switch-org
   * Switch the active organization (TEN-4).
   */
  @Post('auth/switch-org')
  @UsePipes(new ZodValidationPipe(switchOrgSchema))
  async switchOrg(@Body() dto: SwitchOrgDto): Promise<{ data: { accessToken: string; refreshToken: string } }> {
    const userId = TenantContext.requireUserId();

    const result = await this.switchOrgUseCase.execute({
      userId,
      newOrganizationId: dto.organizationId,
    });

    return { data: result };
  }
}
