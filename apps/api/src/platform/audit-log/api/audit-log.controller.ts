import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOkResponse } from '@nestjs/swagger';

import { RequiresPermission } from '../../../core/authorization/__init__.js';
import { QueryAuditLogUseCase } from '../application/index.js';

import { AuditLogQueryResponse, AuditLogQueryEnvelopeResponse } from './dto/index.js';

@Controller('v1')
@UseGuards(AuthGuard('jwt'))
export class AuditLogController {
  constructor(private readonly queryAuditLogUseCase: QueryAuditLogUseCase) {}

  /**
   * GET /v1/organizations/:orgId/audit-log
   * Query audit log entries with optional filters.
   */
  @Get('organizations/:orgId/audit-log')
  @ApiOkResponse({ type: AuditLogQueryEnvelopeResponse })
  @RequiresPermission('platform:audit:view')
  async queryAuditLog(
    @Param('orgId') orgId: string,
    @Query('actorUserId') actorUserId?: string,
    @Query('entityType') entityType?: string,
    @Query('entityId') entityId?: string,
    @Query('action') action?: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ): Promise<{ data: AuditLogQueryResponse }> {
    const result = await this.queryAuditLogUseCase.execute({
      organizationId: orgId,
      ...(actorUserId !== undefined ? { actorUserId } : {}),
      ...(entityType !== undefined ? { entityType } : {}),
      ...(entityId !== undefined ? { entityId } : {}),
      ...(action !== undefined ? { action } : {}),
      ...(fromDate !== undefined ? { fromDate } : {}),
      ...(toDate !== undefined ? { toDate } : {}),
      ...(page !== undefined ? { page: Number(page) } : {}),
      ...(pageSize !== undefined ? { pageSize: Number(pageSize) } : {}),
    });
    return { data: result };
  }
}
