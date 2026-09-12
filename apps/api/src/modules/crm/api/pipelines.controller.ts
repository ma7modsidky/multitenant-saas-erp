import { TEAM_READ_PORT, MODULE_KEYS, type TeamReadPort } from '@modubiz/contracts';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards, UsePipes } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOkResponse } from '@nestjs/swagger';

import { Audit } from '../../../core/audit/__init__.js';
import { RequiresModule, RequiresPermission } from '../../../core/authorization/__init__.js';
import { PortRegistry } from '../../../core/ports/port-registry.js';
import { ZodValidationPipe } from '../../../core/common/zod-validation.pipe.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';
import {
  CreatePipelineUseCase,
  DeletePipelineUseCase,
  GetPipelineBoardUseCase,
  ListPipelinesUseCase,
  ReorderPipelineStagesUseCase,
  SetDefaultPipelineUseCase,
  UpdatePipelineUseCase,
} from '../application/index.js';
import {
  createPipelineSchema,
  reorderPipelineStagesSchema,
  updatePipelineSchema,
  PipelineEnvelopeResponse,
  PipelineListEnvelopeResponse,
} from './dto/index.js';

/**
 * PipelinesController — CRM-17 pipeline management endpoints
 * (`/v1/crm/pipelines`).
 *
 * All routes require JWT auth + the `crm` module entitlement (AUTHZ-6).
 * Reads require `crm:deal:read`; every mutation requires
 * `crm:pipeline:manage` (the module configuration permission — OWNER, ADMIN
 * and MANAGER per the role matrix).
 *
 * Team visibility (CRM-17): an org-wide pipeline (owner_team_id NULL) is
 * visible to everyone; a team pipeline only to that team's members + leaders
 * and the org OWNER/ADMIN. `crm:pipeline:manage` grants management of the
 * pipelines the actor can SEE — a member can never manage another team's
 * pipeline through a forged id.
 */
@Controller('v1/crm/pipelines')
@UseGuards(AuthGuard('jwt'))
@RequiresModule(MODULE_KEYS.CRM)
export class PipelinesController {
  constructor(
    private readonly listPipelinesUseCase: ListPipelinesUseCase,
    private readonly createPipelineUseCase: CreatePipelineUseCase,
    private readonly updatePipelineUseCase: UpdatePipelineUseCase,
    private readonly reorderPipelineStagesUseCase: ReorderPipelineStagesUseCase,
    private readonly setDefaultPipelineUseCase: SetDefaultPipelineUseCase,
    private readonly deletePipelineUseCase: DeletePipelineUseCase,
    private readonly getPipelineBoardUseCase: GetPipelineBoardUseCase,
    private readonly portRegistry: PortRegistry,
  ) {}

  /** GET /v1/crm/pipelines — every pipeline visible to the caller. */
  @Get()
  @ApiOkResponse({ type: PipelineListEnvelopeResponse })
  @RequiresPermission('crm:deal:read')
  async list(): Promise<{ data: Awaited<ReturnType<ListPipelinesUseCase['execute']>> }> {
    const pipelines = await this.listPipelinesUseCase.execute();
    const visible = await this.filterVisible(pipelines);
    return { data: visible };
  }

  /**
   * GET /v1/crm/pipelines/default — the org default pipeline with per-stage
   * success percentages (CRM-17). Kept for backwards compatibility.
   */
  @Get('default')
  @ApiOkResponse({ type: PipelineEnvelopeResponse })
  @RequiresPermission('crm:deal:read')
  async getDefault() {
    return { data: await this.getPipelineBoardUseCase.execute() };
  }

  /**
   * GET /v1/crm/pipelines/:id — one pipeline with per-stage success
   * percentages; 404 when the caller cannot see it (fail-closed, TEAM-6).
   */
  @Get(':id')
  @ApiOkResponse({ type: PipelineEnvelopeResponse })
  @RequiresPermission('crm:deal:read')
  async getById(@Param('id') id: string) {
    const data = await this.getPipelineBoardUseCase.execute(id);
    if (!data || !(await this.canSeeTeam(data.ownerTeamId ?? null))) {
      throw new NotFoundException('PIPELINE_NOT_FOUND');
    }
    return { data };
  }

  /** POST /v1/crm/pipelines — create a pipeline (CRM-4/5 via the domain). */
  @Post()
  @UsePipes(new ZodValidationPipe(createPipelineSchema))
  @RequiresPermission('crm:pipeline:manage')
  @Audit({ action: 'CREATE', entityType: 'pipeline', captureAfter: true })
  async create(@Body() dto: { nameI18n: Record<string, string>; ownerTeamId?: string | null; stages: unknown[] }) {
    await this.assertTeamAssignmentAllowed(dto.ownerTeamId ?? null);
    const data = await this.createPipelineUseCase.execute({
      nameI18n: dto.nameI18n,
      ownerTeamId: dto.ownerTeamId ?? null,
      stages: dto.stages as Array<{
        nameI18n: Record<string, string>;
        probability: number;
        isWon?: boolean;
        isLost?: boolean;
      }>,
    });
    return { data };
  }

  /** PATCH /v1/crm/pipelines/:id — rename / reassign the owning team. */
  @Patch(':id')
  @UsePipes(new ZodValidationPipe(updatePipelineSchema))
  @RequiresPermission('crm:pipeline:manage')
  @Audit({ action: 'UPDATE', entityType: 'pipeline', captureBefore: true, captureAfter: true })
  async update(
    @Param('id') id: string,
    @Body() dto: { nameI18n?: Record<string, string>; ownerTeamId?: string | null },
  ) {
    const current = await this.getPipelineBoardUseCase.execute(id);
    if (!current || !(await this.canSeeTeam(current.ownerTeamId ?? null))) {
      throw new NotFoundException('PIPELINE_NOT_FOUND');
    }
    await this.assertTeamAssignmentAllowed(dto.ownerTeamId ?? current.ownerTeamId ?? null);
    const data = await this.updatePipelineUseCase.execute(id, {
      ...(dto.nameI18n !== undefined ? { nameI18n: dto.nameI18n } : {}),
      ...(dto.ownerTeamId !== undefined ? { ownerTeamId: dto.ownerTeamId } : {}),
    });
    return { data };
  }

  /** POST /v1/crm/pipelines/:id/stages/reorder — CRM-5 atomic stage reorder. */
  @Post(':id/stages/reorder')
  @UsePipes(new ZodValidationPipe(reorderPipelineStagesSchema))
  @RequiresPermission('crm:pipeline:manage')
  @Audit({ action: 'UPDATE', entityType: 'pipeline', captureAfter: true })
  async reorderStages(@Param('id') id: string, @Body() dto: { stageIds: string[] }) {
    await this.assertManageable(id);
    const data = await this.reorderPipelineStagesUseCase.execute(id, dto.stageIds);
    return { data };
  }

  /** POST /v1/crm/pipelines/:id/set-default — CRM-3 promotion. */
  @Post(':id/set-default')
  @RequiresPermission('crm:pipeline:manage')
  @Audit({ action: 'UPDATE', entityType: 'pipeline', captureAfter: true })
  async setDefault(@Param('id') id: string) {
    await this.assertManageable(id);
    await this.setDefaultPipelineUseCase.execute(id);
    return { data: { ok: true } };
  }

  /** DELETE /v1/crm/pipelines/:id — CRM-3 guarded soft delete. */
  @Delete(':id')
  @RequiresPermission('crm:pipeline:manage')
  @Audit({ action: 'DELETE', entityType: 'pipeline', captureBefore: true })
  async remove(@Param('id') id: string) {
    await this.assertManageable(id);
    await this.deletePipelineUseCase.execute(id);
    return { data: { ok: true } };
  }

  // ─── CRM-17 visibility helpers ─────────────────────────────────────────────

  /**
   * Org-wide pipelines are visible to everyone. Team pipelines are visible
   * to their members + leaders and the org OWNER/ADMIN (GLOBAL ceiling).
   */
  private async canSeeTeam(ownerTeamId: string | null): Promise<boolean> {
    if (ownerTeamId === null || hasGlobalCeiling()) return true;
    const { organizationId, userId } = this.session();
    const teamPort = this.portRegistry.resolve<TeamReadPort>(TEAM_READ_PORT);
    return teamPort.hasTeamMembership(organizationId, userId, ownerTeamId);
  }

  /** Async list-filter variant used by GET /. */
  private async filterVisible<T extends { ownerTeamId?: string | null }>(pipelines: T[]): Promise<T[]> {
    if (hasGlobalCeiling()) return pipelines;
    const { organizationId, userId } = this.session();
    const teamPort = this.portRegistry.resolve<TeamReadPort>(TEAM_READ_PORT);
    const [myTeams, ledTeams] = await Promise.all([
      teamPort.listTeamIdsForUser(organizationId, userId),
      teamPort.listLeaderTeamIds(organizationId, userId),
    ]);
    const allowed = new Set([...myTeams, ...ledTeams]);
    return pipelines.filter((p) => p.ownerTeamId == null || allowed.has(p.ownerTeamId));
  }

  /**
   * Managing a team pipeline additionally requires membership/leadership of
   * that team (or the GLOBAL ceiling) — `crm:pipeline:manage` alone never
   * widens visibility.
   */
  private async assertManageable(pipelineId: string): Promise<void> {
    const data = await this.getPipelineBoardUseCase.execute(pipelineId);
    if (!data || !(await this.canSeeTeam(data.ownerTeamId ?? null))) {
      throw new NotFoundException('PIPELINE_NOT_FOUND');
    }
    if (data.ownerTeamId && !hasGlobalCeiling()) {
      const { organizationId, userId } = this.session();
      const teamPort = this.portRegistry.resolve<TeamReadPort>(TEAM_READ_PORT);
      const [member, led] = await Promise.all([
        teamPort.hasTeamMembership(organizationId, userId, data.ownerTeamId),
        teamPort.listLeaderTeamIds(organizationId, userId),
      ]);
      if (!member && !led.includes(data.ownerTeamId)) {
        throw new ForbiddenException('OWNER_SCOPE_DENIED');
      }
    }
  }

  /** Creating/updating: assigning a team requires membership, leadership, or GLOBAL. */
  private async assertTeamAssignmentAllowed(ownerTeamId: string | null): Promise<void> {
    if (ownerTeamId === null || hasGlobalCeiling()) return;
    const { organizationId, userId } = this.session();
    const teamPort = this.portRegistry.resolve<TeamReadPort>(TEAM_READ_PORT);
    const [member, led] = await Promise.all([
      teamPort.hasTeamMembership(organizationId, userId, ownerTeamId),
      teamPort.listLeaderTeamIds(organizationId, userId),
    ]);
    if (!member && !led.includes(ownerTeamId)) {
      throw new ForbiddenException('OWNER_SCOPE_DENIED');
    }
  }

  private session(): { organizationId: string; userId: string } {
    return {
      organizationId: TenantContext.requireOrganizationId(),
      userId: TenantContext.requireUserId(),
    };
  }
}

/** GLOBAL ceiling — same rule as api/scope.ts (AUTHZ-10). */
function hasGlobalCeiling(): boolean {
  const roleKey = TenantContext.getRoles()[0] ?? '';
  if (roleKey === 'owner' || roleKey === 'admin') return true;
  return TenantContext.getPermissions().includes('platform:members:assign-role');
}
