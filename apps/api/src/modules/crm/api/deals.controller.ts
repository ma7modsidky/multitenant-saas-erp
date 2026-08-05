import {
  FX_RATE_READ_PORT,
  MODULE_KEYS,
  ORGANIZATION_READ_PORT,
  type FxRateReadPort,
  type OrganizationReadPort,
} from '@modubiz/contracts';
import { Money } from '@modubiz/money';
import { BadRequestException, Body, Controller, Get, Param, Post, Query, UseGuards, UsePipes } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiCreatedResponse, ApiOkResponse } from '@nestjs/swagger';

import { Audit } from '../../../core/audit/__init__.js';
import { RequiresModule, RequiresPermission } from '../../../core/authorization/__init__.js';
import { ZodValidationPipe } from '../../../core/common/zod-validation.pipe.js';
import { PortRegistry } from '../../../core/ports/port-registry.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';
import {
  CloseDealUseCase,
  CreateDealUseCase,
  GetDealUseCase,
  ListDealsUseCase,
  MoveDealStageUseCase,
  ReopenDealUseCase,
} from '../application/index.js';
import type { DealListPage } from '../application/ports/index.js';

import {
  CloseDealDto,
  CreateDealDto,
  DealEnvelopeResponse,
  DealListEnvelopeResponse,
  MoveDealStageDto,
  closeDealSchema,
  createDealSchema,
  moveDealStageSchema,
} from './dto/index.js';

/**
 * DealsController — deal endpoints of the crm bounded context
 * (`/v1/crm/deals`).
 *
 * All routes require JWT auth + the `crm` module entitlement (AUTHZ-6) +
 * `crm:deal:write`. Cross-boundary reads (CRM-8 base currency + FX rate) are
 * resolved through declared read ports via the PortRegistry — never by
 * importing `platform/` (architecture test).
 *
 * Note on port resolution timing: platform modules register their read-port
 * implementations in `onModuleInit`, which Nest runs AFTER all providers are
 * instantiated. Ports are therefore resolved lazily at REQUEST time (inside
 * the handler), never in the constructor.
 *
 * @see CRM-3 (lazy default pipeline), CRM-6 (stage history), CRM-7 (lost
 *      reason), CRM-8 (FX snapshot), CRM-9 (close/reopen), CRM-10 (reference)
 */
@Controller('v1/crm/deals')
@UseGuards(AuthGuard('jwt'))
@RequiresModule(MODULE_KEYS.CRM)
export class DealsController {
  constructor(
    private readonly listDealsUseCase: ListDealsUseCase,
    private readonly getDealUseCase: GetDealUseCase,
    private readonly createDealUseCase: CreateDealUseCase,
    private readonly moveDealStageUseCase: MoveDealStageUseCase,
    private readonly closeDealUseCase: CloseDealUseCase,
    private readonly reopenDealUseCase: ReopenDealUseCase,
    private readonly portRegistry: PortRegistry,
  ) {}

  @Get()
  @ApiOkResponse({ type: DealListEnvelopeResponse })
  @RequiresPermission('crm:deal:read')
  async list(
    @Query('search') search?: string,
    @Query('stageId') stageId?: string,
    @Query('status') status?: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortDir') sortDir?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ): Promise<{ data: DealListPage }> {
    // Query params are interpolated into SQL below, so every one must be
    // validated here — a malformed value would otherwise surface as a 500
    // instead of a 400 (ERR-1/ERR-6).
    const isoDate = /^\d{4}-\d{2}-\d{2}$/;
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (stageId !== undefined && !uuid.test(stageId)) {
      throw new BadRequestException('stageId must be a valid UUID');
    }
    if (status !== undefined && status !== 'open' && status !== 'won' && status !== 'lost') {
      throw new BadRequestException('status must be one of open, won, lost');
    }
    if (fromDate !== undefined && !isoDate.test(fromDate)) {
      throw new BadRequestException('fromDate must be an ISO date (YYYY-MM-DD)');
    }
    if (toDate !== undefined && !isoDate.test(toDate)) {
      throw new BadRequestException('toDate must be an ISO date (YYYY-MM-DD)');
    }
    if (
      sortBy !== undefined &&
      sortBy !== 'updatedAt' &&
      sortBy !== 'createdAt' &&
      sortBy !== 'title' &&
      sortBy !== 'value'
    ) {
      throw new BadRequestException('sortBy must be one of updatedAt, createdAt, title, value');
    }
    if (sortDir !== undefined && sortDir !== 'asc' && sortDir !== 'desc') {
      throw new BadRequestException('sortDir must be asc or desc');
    }
    const result = await this.listDealsUseCase.execute({
      // The validation throws above have narrowed each value to its safe
      // shape (literal union), so no casts are needed here.
      ...(search !== undefined ? { search } : {}),
      ...(stageId !== undefined ? { stageId } : {}),
      ...(status !== undefined ? { status } : {}),
      ...(fromDate !== undefined ? { fromDate } : {}),
      ...(toDate !== undefined ? { toDate } : {}),
      ...(sortBy !== undefined ? { sortBy } : {}),
      ...(sortDir !== undefined ? { sortDir } : {}),
      ...(page !== undefined ? { page: Number(page) } : {}),
      ...(pageSize !== undefined ? { pageSize: Number(pageSize) } : {}),
    });
    return { data: result };
  }

  /**
   * GET /v1/crm/deals/:id — deal detail with stage history (CRM-6).
   */
  @Get(':id')
  @ApiOkResponse({ type: DealEnvelopeResponse })
  @RequiresPermission('crm:deal:read')
  async getById(@Param('id') id: string): Promise<{ data: Record<string, unknown> }> {
    return { data: await this.getDealUseCase.execute(id) };
  }

  /**
   * POST /v1/crm/deals — create a deal (CRM-3/8/10).
   *
   * The org base currency and, when the value currency differs, the latest FX
   * rate are resolved via platform read ports (never client input).
   */
  @Post()
  @ApiCreatedResponse({ type: DealEnvelopeResponse })
  @UsePipes(new ZodValidationPipe(createDealSchema))
  @RequiresPermission('crm:deal:write')
  @Audit({ action: 'CREATE', entityType: 'deal', captureAfter: true })
  async create(@Body() dto: CreateDealDto): Promise<{ data: Record<string, unknown> }> {
    const organizationId = TenantContext.requireOrganizationId();
    const value = Money.of(BigInt(dto.value.amountMinor), dto.value.currency);

    // CRM-8: resolve base currency + FX snapshot via read ports.
    const orgPort = this.portRegistry.resolve<OrganizationReadPort>(ORGANIZATION_READ_PORT);
    const baseCurrency = await orgPort.getBaseCurrency(organizationId);

    let fxRate = null;
    if (value.currency !== baseCurrency) {
      const fxPort = this.portRegistry.resolve<FxRateReadPort>(FX_RATE_READ_PORT);
      const rate = await fxPort.getRate(value.currency, baseCurrency);
      if (rate) {
        fxRate = { rate: rate.rate, source: rate.source, validOn: rate.validOn };
      }
    }

    const result = await this.createDealUseCase.execute({
      title: dto.title,
      contactId: dto.contactId ?? null,
      companyId: dto.companyId ?? null,
      pipelineId: dto.pipelineId ?? null,
      stageId: dto.stageId ?? null,
      value,
      baseCurrency,
      fxRate,
      expectedCloseDate: dto.expectedCloseDate ? new Date(dto.expectedCloseDate) : null,
      ownerUserId: dto.ownerUserId ?? null,
    });
    return { data: toDealResponse(result.deal.toJSON()) };
  }

  /**
   * POST /v1/crm/deals/:id/move-stage — move a deal (CRM-6/7/9).
   */
  @Post(':id/move-stage')
  @ApiOkResponse({ type: DealEnvelopeResponse })
  @UsePipes(new ZodValidationPipe(moveDealStageSchema))
  @RequiresPermission('crm:deal:write')
  @Audit({ action: 'UPDATE', entityType: 'deal' })
  async moveStage(@Param('id') id: string, @Body() dto: MoveDealStageDto): Promise<{ data: Record<string, unknown> }> {
    const result = await this.moveDealStageUseCase.execute({
      dealId: id,
      toStageId: dto.toStageId,
      ...(dto.lostReasonCode !== undefined && dto.lostReasonCode !== null
        ? { lostReasonCode: dto.lostReasonCode }
        : {}),
    });
    return { data: toDealResponse(result.deal.toJSON()) };
  }

  /**
   * POST /v1/crm/deals/:id/close — close a deal as won or lost (CRM-7/9).
   */
  @Post(':id/close')
  @ApiOkResponse({ type: DealEnvelopeResponse })
  @UsePipes(new ZodValidationPipe(closeDealSchema))
  @RequiresPermission('crm:deal:write')
  @Audit({ action: 'UPDATE', entityType: 'deal' })
  async close(@Param('id') id: string, @Body() dto: CloseDealDto): Promise<{ data: Record<string, unknown> }> {
    const result = await this.closeDealUseCase.execute({
      dealId: id,
      outcome: dto.outcome,
      ...(dto.lostReasonCode !== undefined && dto.lostReasonCode !== null
        ? { lostReasonCode: dto.lostReasonCode }
        : {}),
    });
    return { data: toDealResponse(result.deal.toJSON()) };
  }

  /**
   * POST /v1/crm/deals/:id/reopen — reopen a closed deal (CRM-9).
   */
  @Post(':id/reopen')
  @ApiOkResponse({ type: DealEnvelopeResponse })
  @RequiresPermission('crm:deal:write')
  @Audit({ action: 'UPDATE', entityType: 'deal' })
  async reopen(@Param('id') id: string): Promise<{ data: Record<string, unknown> }> {
    const result = await this.reopenDealUseCase.execute({ dealId: id });
    return { data: toDealResponse(result.deal.toJSON()) };
  }
}

// ─── Response mapper ─────────────────────────────────────────────────────────
//
// Money always leaves the API as integer minor units + ISO 4217 currency
// (DATA_MODEL §5 M1) — never floats (hard rule #3).

function toDealResponse(data: {
  id: string;
  title: string;
  pipelineId: string;
  stageId: string;
  contactId: string | null;
  companyId: string | null;
  valueAmountMinor: bigint;
  valueCurrency: string;
  exchangeRate: number | null;
  baseAmountMinor: bigint | null;
  status: string;
  closedAt: Date | null;
  expectedCloseDate: Date | null;
  ownerUserId: string | null;
}): Record<string, unknown> {
  return {
    id: data.id,
    title: data.title,
    pipelineId: data.pipelineId,
    stageId: data.stageId,
    contactId: data.contactId,
    companyId: data.companyId,
    value: {
      amountMinor: data.valueAmountMinor.toString(),
      currency: data.valueCurrency,
    },
    exchangeRate: data.exchangeRate,
    baseAmountMinor: data.baseAmountMinor === null ? null : data.baseAmountMinor.toString(),
    status: data.status,
    closedAt: data.closedAt === null ? null : data.closedAt.toISOString(),
    expectedCloseDate: data.expectedCloseDate === null ? null : data.expectedCloseDate.toISOString(),
    ownerUserId: data.ownerUserId,
  };
}
