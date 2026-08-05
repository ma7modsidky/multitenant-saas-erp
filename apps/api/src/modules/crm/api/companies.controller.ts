import { MODULE_KEYS } from '@modubiz/contracts';
import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards, UsePipes } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiCreatedResponse, ApiOkResponse } from '@nestjs/swagger';

import { Audit } from '../../../core/audit/__init__.js';
import { RequiresModule, RequiresPermission } from '../../../core/authorization/__init__.js';
import { ZodValidationPipe } from '../../../core/common/zod-validation.pipe.js';
import {
  CreateCompanyUseCase,
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
  ) {}

  @Get()
  @ApiOkResponse({ type: CompanyListEnvelopeResponse })
  @RequiresPermission('crm:company:read')
  async list(
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ): Promise<{ data: { items: CrmCompanyRecord[]; total: number; page: number; pageSize: number } }> {
    const result = await this.listCompaniesUseCase.execute({
      ...(search !== undefined ? { search } : {}),
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
    return { data: await this.getCompanyUseCase.execute(id) };
  }

  @Post()
  @ApiCreatedResponse({ type: CompanyEnvelopeResponse })
  @UsePipes(new ZodValidationPipe(companySchema))
  @RequiresPermission('crm:company:write')
  @Audit({ action: 'CREATE', entityType: 'company', captureAfter: true })
  async create(@Body() dto: CreateCompanyDto) {
    return {
      data: await this.createCompanyUseCase.execute({
        name: dto.name,
        domain: dto.domain ?? null,
        industry: dto.industry ?? null,
        address: dto.address,
        ownerUserId: dto.ownerUserId ?? null,
      }),
    };
  }

  @Patch(':id')
  @ApiOkResponse({ type: CompanyEnvelopeResponse })
  @UsePipes(new ZodValidationPipe(companySchema.partial()))
  @RequiresPermission('crm:company:write')
  @Audit({ action: 'UPDATE', entityType: 'company', captureAfter: true })
  async update(@Param('id') id: string, @Body() dto: UpdateCompanyDto) {
    const input: Record<string, unknown> = {};
    if (dto.name !== undefined) input.name = dto.name;
    if (dto.domain !== undefined) input.domain = dto.domain;
    if (dto.industry !== undefined) input.industry = dto.industry;
    if (dto.address !== undefined) input.address = dto.address;
    if (dto.ownerUserId !== undefined) input.ownerUserId = dto.ownerUserId;
    return { data: await this.updateCompanyUseCase.execute(id, input) };
  }
}
