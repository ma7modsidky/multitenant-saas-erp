import { MEMBERSHIP_READ_PORT, MODULE_KEYS, type MembershipReadPort } from '@modubiz/contracts';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
  UsePipes,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiCreatedResponse, ApiOkResponse } from '@nestjs/swagger';

import { Audit } from '../../../core/audit/__init__.js';
import { RequiresModule, RequiresPermission } from '../../../core/authorization/__init__.js';
import { ZodValidationPipe } from '../../../core/common/zod-validation.pipe.js';
import { PortRegistry } from '../../../core/ports/port-registry.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';
import {
  CompleteActivityUseCase,
  CreateActivityUseCase,
  GetActivityUseCase,
  ListActivitiesUseCase,
  UpdateActivityUseCase,
} from '../application/index.js';

import {
  ActivityEnvelopeResponse,
  ActivityListEnvelopeResponse,
  CreateActivityDto,
  createActivitySchema,
  UpdateActivityDto,
  updateActivitySchema,
} from './dto/index.js';

/**
 * ActivitiesController — activity endpoints of the crm bounded context
 * (`/v1/crm/activities`).
 *
 * All routes require JWT auth + the `crm` module entitlement (AUTHZ-6) +
 * `crm:activity:write`. CRM-14 (assignment only to active members) is enforced
 * by the domain against the org's active-member set, which the API layer
 * resolves through the membership read port — never by importing
 * `platform/` (architecture test).
 *
 * Note on port resolution timing: platform modules register their read-port
 * implementations in `onModuleInit`, which Nest runs AFTER all providers are
 * instantiated. Ports are therefore resolved lazily at REQUEST time (inside
 * the handler), never in the constructor.
 *
 * @see CRM-13 (complete is idempotent), CRM-14 (active-member assignment)
 */
@Controller('v1/crm/activities')
@UseGuards(AuthGuard('jwt'))
@RequiresModule(MODULE_KEYS.CRM)
export class ActivitiesController {
  constructor(
    private readonly listActivitiesUseCase: ListActivitiesUseCase,
    private readonly createActivityUseCase: CreateActivityUseCase,
    private readonly completeActivityUseCase: CompleteActivityUseCase,
    private readonly getActivityUseCase: GetActivityUseCase,
    private readonly updateActivityUseCase: UpdateActivityUseCase,
    private readonly portRegistry: PortRegistry,
  ) {}

  @Get()
  @ApiOkResponse({ type: ActivityListEnvelopeResponse })
  @RequiresPermission('crm:activity:read')
  async list(
    @Query('search') search?: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
    @Query('assigneeUserId') assigneeUserId?: string,
    @Query('unassigned') unassigned?: string,
    @Query('completed') completed?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortDir') sortDir?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ): Promise<{ data: { items: Record<string, unknown>[]; total: number; page: number; pageSize: number } }> {
    // fromDate/toDate are interpolated into `::date` casts in the repository,
    // so they must be validated here — a malformed value would otherwise
    // surface as a 500 instead of a 400 (ERR-1/ERR-6).
    const isoDate = /^\d{4}-\d{2}-\d{2}$/;
    if (fromDate !== undefined && !isoDate.test(fromDate)) {
      throw new BadRequestException('fromDate must be an ISO date (YYYY-MM-DD)');
    }
    if (toDate !== undefined && !isoDate.test(toDate)) {
      throw new BadRequestException('toDate must be an ISO date (YYYY-MM-DD)');
    }
    if (
      assigneeUserId !== undefined &&
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(assigneeUserId)
    ) {
      throw new BadRequestException('assigneeUserId must be a valid UUID');
    }
    // unassigned/completed are boolean-ish query flags — anything other than
    // `true`/`false` is malformed input (400), never a 500.
    const boolFlag = (value: string | undefined, name: string): boolean | undefined => {
      if (value === undefined) return undefined;
      if (value !== 'true' && value !== 'false') {
        throw new BadRequestException(`${name} must be true or false`);
      }
      return value === 'true';
    };
    const unassignedFlag = boolFlag(unassigned, 'unassigned');
    const completedFlag = boolFlag(completed, 'completed');
    // sortBy is interpolated into SQL below, so it must be validated here —
    // a malformed value would otherwise surface as a 500 instead of a 400.
    if (
      sortBy !== undefined &&
      sortBy !== 'updatedAt' &&
      sortBy !== 'createdAt' &&
      sortBy !== 'subject' &&
      sortBy !== 'type' &&
      sortBy !== 'dueAt'
    ) {
      throw new BadRequestException('sortBy must be one of updatedAt, createdAt, subject, type, dueAt');
    }
    if (sortDir !== undefined && sortDir !== 'asc' && sortDir !== 'desc') {
      throw new BadRequestException('sortDir must be asc or desc');
    }
    const result = await this.listActivitiesUseCase.execute({
      ...(search !== undefined ? { search } : {}),
      ...(fromDate !== undefined ? { fromDate } : {}),
      ...(toDate !== undefined ? { toDate } : {}),
      ...(assigneeUserId !== undefined ? { assigneeUserId } : {}),
      ...(unassignedFlag !== undefined ? { unassigned: unassignedFlag } : {}),
      ...(completedFlag !== undefined ? { completed: completedFlag } : {}),
      ...(sortBy !== undefined ? { sortBy } : {}),
      ...(sortDir !== undefined ? { sortDir } : {}),
      ...(page !== undefined ? { page: Number(page) } : {}),
      ...(pageSize !== undefined ? { pageSize: Number(pageSize) } : {}),
    });
    return { data: result };
  }

  /**
   * POST /v1/crm/activities — create an activity (CRM-13/14).
   *
   * CRM-14: the active-member set is resolved via the membership read port so
   * the domain can reject assignment to a non-active member.
   */
  @Post()
  @ApiCreatedResponse({ type: ActivityEnvelopeResponse })
  @UsePipes(new ZodValidationPipe(createActivitySchema))
  @RequiresPermission('crm:activity:write')
  @Audit({ action: 'CREATE', entityType: 'activity', captureAfter: true })
  async create(@Body() dto: CreateActivityDto): Promise<{ data: Record<string, unknown> }> {
    const organizationId = TenantContext.requireOrganizationId();

    let activeMemberIds: ReadonlySet<string> | undefined;
    if (dto.assignedToUserId !== undefined && dto.assignedToUserId !== null) {
      const membershipPort = this.portRegistry.resolve<MembershipReadPort>(MEMBERSHIP_READ_PORT);
      const members = await membershipPort.listActiveMemberIds(organizationId);
      activeMemberIds = new Set(members);
    }

    const result = await this.createActivityUseCase.execute({
      type: dto.type,
      subject: dto.subject,
      dueAt: dto.dueAt ? new Date(dto.dueAt) : null,
      relatedType: dto.relatedType ?? null,
      relatedId: dto.relatedId ?? null,
      assignedToUserId: dto.assignedToUserId ?? null,
      ...(activeMemberIds !== undefined ? { activeMemberIds } : {}),
    });
    return { data: toActivityResponse(result.activity.toJSON()) };
  }

  /**
   * GET /v1/crm/activities/:id — activity detail (detail page).
   * Fail-closed: an id from another organization returns NOT_FOUND.
   */
  @Get(':id')
  @ApiOkResponse({ type: ActivityEnvelopeResponse })
  @RequiresPermission('crm:activity:read')
  async getById(@Param('id') id: string): Promise<{ data: Record<string, unknown> }> {
    const result = await this.getActivityUseCase.execute(id);
    return { data: result };
  }

  /**
   * PATCH /v1/crm/activities/:id — edit the subject/type, extend (or clear)
   * the due date, or reassign. Partial update: only the provided fields change.
   *
   * CRM-13: a completed activity is immutable — the domain rejects the update
   * with `CRM_ACTIVITY_COMPLETED_IMMUTABLE`; notes may be appended instead.
   * CRM-14: a non-null assignee is validated against the org's active members
   * (resolved via the membership read port), same as create.
   */
  @Patch(':id')
  @ApiOkResponse({ type: ActivityEnvelopeResponse })
  @UsePipes(new ZodValidationPipe(updateActivitySchema))
  @RequiresPermission('crm:activity:write')
  @Audit({ action: 'UPDATE', entityType: 'activity', captureAfter: true })
  async update(@Param('id') id: string, @Body() dto: UpdateActivityDto): Promise<{ data: Record<string, unknown> }> {
    const organizationId = TenantContext.requireOrganizationId();

    let activeMemberIds: ReadonlySet<string> | undefined;
    if (dto.assignedToUserId !== undefined && dto.assignedToUserId !== null) {
      const membershipPort = this.portRegistry.resolve<MembershipReadPort>(MEMBERSHIP_READ_PORT);
      const members = await membershipPort.listActiveMemberIds(organizationId);
      activeMemberIds = new Set(members);
    }

    const result = await this.updateActivityUseCase.execute({
      activityId: id,
      ...(dto.type !== undefined ? { type: dto.type } : {}),
      ...(dto.subject !== undefined ? { subject: dto.subject } : {}),
      ...(dto.dueAt !== undefined ? { dueAt: dto.dueAt ? new Date(dto.dueAt) : null } : {}),
      ...(dto.assignedToUserId !== undefined ? { assignedToUserId: dto.assignedToUserId ?? null } : {}),
      ...(activeMemberIds !== undefined ? { activeMemberIds } : {}),
    });
    return { data: toActivityResponse(result.activity.toJSON()) };
  }

  /**
   * POST /v1/crm/activities/:id/complete — mark an activity completed
   * (CRM-13, idempotent).
   */
  @Post(':id/complete')
  @ApiOkResponse({ type: ActivityEnvelopeResponse })
  @RequiresPermission('crm:activity:write')
  @Audit({ action: 'UPDATE', entityType: 'activity' })
  async complete(@Param('id') id: string): Promise<{ data: Record<string, unknown> }> {
    const result = await this.completeActivityUseCase.execute({ activityId: id });
    return { data: toActivityResponse(result.activity.toJSON()) };
  }
}

// ─── Response mapper ─────────────────────────────────────────────────────────

function toActivityResponse(data: {
  id: string;
  type: string;
  subject: string;
  dueAt: Date | null;
  completedAt: Date | null;
  relatedType: string | null;
  relatedId: string | null;
  assignedTo: string | null;
  createdAt: Date;
  updatedAt: Date;
}): Record<string, unknown> {
  return {
    id: data.id,
    type: data.type,
    subject: data.subject,
    dueAt: data.dueAt === null ? null : data.dueAt.toISOString(),
    completedAt: data.completedAt === null ? null : data.completedAt.toISOString(),
    relatedType: data.relatedType,
    relatedId: data.relatedId,
    assignedToUserId: data.assignedTo,
    createdAt: data.createdAt.toISOString(),
    updatedAt: data.updatedAt.toISOString(),
  };
}
