import { MEMBERSHIP_READ_PORT, MODULE_KEYS, type MembershipReadPort } from '@modubiz/contracts';
import { Body, Controller, Param, Post, UseGuards, UsePipes } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiCreatedResponse, ApiOkResponse } from '@nestjs/swagger';

import { Audit } from '../../../core/audit/__init__.js';
import { RequiresModule, RequiresPermission } from '../../../core/authorization/__init__.js';
import { ZodValidationPipe } from '../../../core/common/zod-validation.pipe.js';
import { PortRegistry } from '../../../core/ports/port-registry.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';
import { CompleteActivityUseCase, CreateActivityUseCase } from '../application/index.js';

import { ActivityEnvelopeResponse, CreateActivityDto, createActivitySchema } from './dto/index.js';

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
    private readonly createActivityUseCase: CreateActivityUseCase,
    private readonly completeActivityUseCase: CompleteActivityUseCase,
    private readonly portRegistry: PortRegistry,
  ) {}

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
  };
}
