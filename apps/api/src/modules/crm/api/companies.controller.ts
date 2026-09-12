import { MODULE_KEYS } from '@modubiz/contracts';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
  UsePipes,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse } from '@nestjs/swagger';

import { Audit } from '../../../core/audit/__init__.js';
import { RequiresModule, RequiresPermission } from '../../../core/authorization/__init__.js';
import { ZodValidationPipe } from '../../../core/common/zod-validation.pipe.js';
import { PortRegistry } from '../../../core/ports/port-registry.js';
import {
  assertCanViewRecord,
  assertOwnershipChange,
  parseCrmScope,
  resolveOwnershipDefaults,
  resolveScopeFilter,
} from './scope.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';
import {
  CreateCompanyUseCase,
  DeleteCompanyUseCase,
  GetCompanyUseCase,
  ListCompaniesUseCase,
  UpdateCompanyUseCase,
} from '../application/index.js';
import type { CrmCompanyRecord } from '../application/ports/index.js';
import {
  CompanyEnvelopeResponse,
  CompanyListEnvelopeResponse,
  CreateCompanyDto,
  UpdateCompanyDto,
  companySchema,
} from './dto/index.js';

@Controller('v1/crm/companies')
@UseGuards(AuthGuard('jwt'))
@RequiresModule(MODULE_KEYS.CRM)
export class CompaniesController {
  constructor(
    private readonly listCompaniesUseCase: ListCompaniesUseCase,
    private readonly getCompanyUseCase: GetCompanyUseCase,
    private readonly createCompanyUseCase: CreateCompanyUseCase,
    private readonly updateCompanyUseCase: UpdateCompanyUseCase,
    private readonly portRegistry: PortRegistry,
    private readonly deleteCompanyUseCase: DeleteCompanyUseCase,
  ) {}

  @Get()
  @ApiOkResponse({ type: CompanyListEnvelopeResponse })
  @RequiresPermission('crm:company:read')
  async list(
    @Query('search') search?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortDir') sortDir?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('ownerUserId') ownerUserId?: string,
    @Query('unassigned') unassigned?: string,
    @Query('createdFrom') createdFrom?: string,
    @Query('scope') scope?: string,
    @Query('pool') pool?: string,
  ): Promise<{ data: { items: CrmCompanyRecord[]; total: number; page: number; pageSize: number } }> {
    // Query params are interpolated into SQL below, so every one must be
    // validated here — a malformed value would otherwise surface as a 500
    // instead of a 400 (ERR-1/ERR-6).
    if (
      sortBy !== undefined &&
      sortBy !== 'updatedAt' &&
      sortBy !== 'createdAt' &&
      sortBy !== 'name' &&
      sortBy !== 'domain' &&
      sortBy !== 'industry'
    ) {
      throw new BadRequestException('sortBy must be one of updatedAt, createdAt, name, domain, industry');
    }
    if (sortDir !== undefined && sortDir !== 'asc' && sortDir !== 'desc') {
      throw new BadRequestException('sortDir must be asc or desc');
    }
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (ownerUserId !== undefined && !uuid.test(ownerUserId)) {
      throw new BadRequestException('ownerUserId must be a valid UUID');
    }
    let unassignedFlag: boolean | undefined;
    if (unassigned !== undefined) {
      if (unassigned !== 'true' && unassigned !== 'false') {
        throw new BadRequestException('unassigned must be true or false');
      }
      unassignedFlag = unassigned === 'true';
    }
    const isoDate = /^\d{4}-\d{2}-\d{2}$/;
    if (createdFrom !== undefined && !isoDate.test(createdFrom)) {
      throw new BadRequestException('createdFrom must be an ISO date (YYYY-MM-DD)');
    }
    // TEAM-4 pool view — same semantics as the contacts list (see there).
    let poolFilter: 'team' | 'global' | undefined;
    if (pool !== undefined) {
      if (pool !== 'team' && pool !== 'global') {
        throw new BadRequestException('pool must be team or global');
      }
      poolFilter = pool;
    }
    // AUTHZ-9/10: always enforce scope — see contacts.controller.ts.
    const scopeValue = parseCrmScope(scope) ?? 'all';
    const scopeFilter = await resolveScopeFilter(scopeValue, this.portRegistry);
    const result = await this.listCompaniesUseCase.execute({
      ...(search !== undefined ? { search } : {}),
      ...(ownerUserId !== undefined ? { ownerUserId } : {}),
      ...(unassignedFlag !== undefined ? { unassigned: unassignedFlag } : {}),
      ...(poolFilter !== undefined ? { pool: poolFilter } : {}),
      ...(createdFrom !== undefined ? { createdFrom } : {}),
      ...(scopeFilter ?? {}),
      ...(sortBy !== undefined ? { sortBy } : {}),
      ...(sortDir !== undefined ? { sortDir } : {}),
      ...(page !== undefined ? { page: Number(page) } : {}),
      ...(pageSize !== undefined ? { pageSize: Number(pageSize) } : {}),
    });
    return { data: result };
  }

  /**
   * GET /v1/crm/companies/:id — company detail.
   */
  @Get(':id')
  @ApiOkResponse({ type: CompanyEnvelopeResponse })
  @RequiresPermission('crm:company:read')
  async getById(@Param('id') id: string) {
    const data = await this.getCompanyUseCase.execute(id);
    await assertCanViewRecord(this.portRegistry, data);
    return { data };
  }

  @Post()
  @ApiCreatedResponse({ type: CompanyEnvelopeResponse })
  @UsePipes(new ZodValidationPipe(companySchema))
  @RequiresPermission('crm:company:write')
  @Audit({ action: 'CREATE', entityType: 'company', captureAfter: true })
  async create(@Body() dto: CreateCompanyDto) {
    // TEAM-2: ownership defaults (creating user + their primary team).
    const ownership = await resolveOwnershipDefaults(this.portRegistry, {
      ...(dto.ownerUserId !== undefined ? { ownerUserId: dto.ownerUserId } : {}),
      ...(dto.ownerTeamId !== undefined ? { ownerTeamId: dto.ownerTeamId } : {}),
    });
    return {
      data: await this.createCompanyUseCase.execute({
        name: dto.name,
        domain: dto.domain ?? null,
        industry: dto.industry ?? null,
        address: dto.address,
        ownerUserId: ownership.ownerUserId,
        ownerTeamId: ownership.ownerTeamId,
      }),
    };
  }

  @Patch(':id')
  @ApiOkResponse({ type: CompanyEnvelopeResponse })
  @UsePipes(new ZodValidationPipe(companySchema.partial()))
  @RequiresPermission('crm:company:write')
  @Audit({ action: 'UPDATE', entityType: 'company', captureAfter: true, captureBefore: true })
  async update(@Param('id') id: string, @Body() dto: UpdateCompanyDto) {
    const input: Record<string, unknown> = {};
    if (dto.name !== undefined) input.name = dto.name;
    if (dto.domain !== undefined) input.domain = dto.domain;
    if (dto.industry !== undefined) input.industry = dto.industry;
    if (dto.address !== undefined) input.address = dto.address;
    if (dto.ownerUserId !== undefined) input.ownerUserId = dto.ownerUserId;
    if (dto.ownerTeamId !== undefined) input.ownerTeamId = dto.ownerTeamId;
    // AUTHZ-9/TEAM-6: fail-closed visibility on every mutation — a record the
    // actor cannot view behaves as nonexistent, exactly like GET /:id.
    const current = await this.getCompanyUseCase.execute(id);
    await assertCanViewRecord(this.portRegistry, current);
    // CRM-16 ownership-transition guard.
    if (dto.ownerUserId !== undefined || dto.ownerTeamId !== undefined) {
      await assertOwnershipChange(this.portRegistry, {
        organizationId: TenantContext.requireOrganizationId(),
        actorUserId: TenantContext.requireUserId(),
        currentOwnerUserId: current.ownerUserId ?? null,
        currentOwnerTeamId: current.ownerTeamId ?? null,
        nextOwnerUserId: dto.ownerUserId,
        nextOwnerTeamId: dto.ownerTeamId,
      });
    }
    return { data: await this.updateCompanyUseCase.execute(id, input) };
  }

  /**
   * DELETE /v1/crm/companies/:id — soft-delete a company (CRM-15).
   *
   * Detaches its contacts and open deals first; gated by `crm:company:write`
   * like the other destructive-but-reversible mutations.
   */
  @Delete(':id')
  @ApiNoContentResponse()
  @RequiresPermission('crm:company:write')
  @Audit({ action: 'DELETE', entityType: 'company', captureBefore: true })
  async delete(@Param('id') id: string): Promise<void> {
    const data = await this.getCompanyUseCase.execute(id);
    await assertCanViewRecord(this.portRegistry, data);
    await this.deleteCompanyUseCase.execute({ companyId: id });
  }
}
