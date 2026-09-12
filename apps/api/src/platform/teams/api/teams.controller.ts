import { Inject } from '@nestjs/common';
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
  UsePipes,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse } from '@nestjs/swagger';

import { Audit } from '../../../core/audit/__init__.js';
import { RequiresPermission } from '../../../core/authorization/__init__.js';
import { ZodValidationPipe } from '../../../core/common/zod-validation.pipe.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';
import {
  AddTeamMemberUseCase,
  CreateTeamUseCase,
  DeleteTeamUseCase,
  ListTeamsUseCase,
  RemoveTeamMemberUseCase,
  UpdateTeamUseCase,
} from '../application/team.use-cases.js';
import {
  CreateTeamDto,
  TeamMemberDto,
  UpdateTeamDto,
  createTeamSchema,
  teamMemberSchema,
  updateTeamSchema,
} from './dto/team.dto.js';

/**
 * TeamsController — team management for an organization
 * (`/v1/organizations/:orgId/teams`).
 *
 * Reads are available to every authenticated member (team pickers across the
 * app need them); writes require `platform:teams:manage` (OWNER/ADMIN).
 */
@Controller('v1')
@UseGuards(AuthGuard('jwt'))
export class TeamsController {
  constructor(
    private readonly listTeamsUseCase: ListTeamsUseCase,
    private readonly createTeamUseCase: CreateTeamUseCase,
    private readonly updateTeamUseCase: UpdateTeamUseCase,
    private readonly deleteTeamUseCase: DeleteTeamUseCase,
    private readonly addTeamMemberUseCase: AddTeamMemberUseCase,
    private readonly removeTeamMemberUseCase: RemoveTeamMemberUseCase,
  ) {}

  @Get('organizations/:orgId/teams')
  @ApiOkResponse({ description: 'Teams with their member user ids' })
  async list(@Param('orgId') orgId: string) {
    const teams = await this.listTeamsUseCase.execute(orgId);
    return {
      data: teams.map((team) => ({
        id: team.id,
        name: team.name,
        description: team.description,
        leaderUserId: team.leaderUserId,
        memberUserIds: team.memberUserIds,
        memberCount: team.memberUserIds.length,
        createdAt: team.createdAt.toISOString(),
        updatedAt: team.updatedAt.toISOString(),
      })),
    };
  }

  @Post('organizations/:orgId/teams')
  @ApiCreatedResponse()
  @UsePipes(new ZodValidationPipe(createTeamSchema))
  @RequiresPermission('platform:teams:manage')
  @Audit({ action: 'CREATE', entityType: 'team', captureAfter: true })
  async create(@Param('orgId') orgId: string, @Body() dto: CreateTeamDto) {
    const actor = TenantContext.requireUserId();
    const team = await this.createTeamUseCase.execute({
      organizationId: orgId,
      name: dto.name,
      description: dto.description ?? null,
      leaderUserId: dto.leaderUserId ?? null,
      memberUserIds: dto.memberUserIds ?? [],
      actorUserId: actor,
    });
    return { data: { id: team.id } };
  }

  @Patch('organizations/:orgId/teams/:teamId')
  @ApiOkResponse()
  @UsePipes(new ZodValidationPipe(updateTeamSchema))
  @RequiresPermission('platform:teams:manage')
  @Audit({ action: 'UPDATE', entityType: 'team', captureBefore: true, captureAfter: true })
  async update(@Param('orgId') orgId: string, @Param('teamId') teamId: string, @Body() dto: UpdateTeamDto) {
    const actor = TenantContext.requireUserId();
    await this.updateTeamUseCase.execute({
      teamId,
      organizationId: orgId,
      ...(dto.name !== undefined ? { name: dto.name } : {}),
      ...(dto.description !== undefined ? { description: dto.description } : {}),
      ...(dto.leaderUserId !== undefined ? { leaderUserId: dto.leaderUserId } : {}),
      ...(dto.memberUserIds !== undefined ? { memberUserIds: dto.memberUserIds } : {}),
      actorUserId: actor,
    });
    return { data: { id: teamId } };
  }

  @Delete('organizations/:orgId/teams/:teamId')
  @ApiNoContentResponse()
  @RequiresPermission('platform:teams:manage')
  @Audit({ action: 'DELETE', entityType: 'team', captureBefore: true })
  async delete(@Param('orgId') orgId: string, @Param('teamId') teamId: string): Promise<void> {
    await this.deleteTeamUseCase.execute({ teamId, organizationId: orgId });
  }

  @Post('organizations/:orgId/teams/:teamId/members')
  @ApiCreatedResponse()
  @UsePipes(new ZodValidationPipe(teamMemberSchema))
  @RequiresPermission('platform:teams:manage')
  @Audit({ action: 'CREATE', entityType: 'team_membership', captureAfter: true })
  async addMember(
    @Param('orgId') orgId: string,
    @Param('teamId') teamId: string,
    @Body() dto: TeamMemberDto,
  ): Promise<{ data: { id: string } }> {
    const actor = TenantContext.requireUserId();
    await this.addTeamMemberUseCase.execute({
      organizationId: orgId,
      teamId,
      userId: dto.userId,
      actorUserId: actor,
    });
    return { data: { id: teamId } };
  }

  @Delete('organizations/:orgId/teams/:teamId/members/:userId')
  @ApiNoContentResponse()
  @RequiresPermission('platform:teams:manage')
  @Audit({ action: 'DELETE', entityType: 'team_membership', captureBefore: true })
  async removeMember(
    @Param('orgId') orgId: string,
    @Param('teamId') teamId: string,
    @Param('userId') userId: string,
  ): Promise<void> {
    await this.removeTeamMemberUseCase.execute({ organizationId: orgId, teamId, userId });
  }
}
