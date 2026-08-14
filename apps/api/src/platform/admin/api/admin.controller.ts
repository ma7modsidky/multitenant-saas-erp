import type { IncomingMessage } from 'node:http';

import { Body, Controller, Get, Param, Post, Put, Query, Req, UseGuards, UsePipes } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOkResponse } from '@nestjs/swagger';

import { RequiresPlatformAdmin } from '../../../core/authorization/__init__.js';
import { ZodValidationPipe } from '../../../core/common/zod-validation.pipe.js';
import {
  AdminOverviewUseCase,
  GetModulePricingUseCase,
  GetOrganizationDetailUseCase,
  GetSaasSettingsUseCase,
  ListOrganizationsUseCase,
  SetOrganizationModuleUseCase,
  UpdateModulePricingUseCase,
  UpdateSaasSettingsUseCase,
} from '../application/index.js';

import {
  adminDisableModuleSchema,
  adminEnableModuleSchema,
  adminUpdatePricingSchema,
  adminUpdateSettingsSchema,
  AdminDisableModuleDto,
  AdminEnableModuleDto,
  AdminMessageEnvelopeResponse,
  AdminModulesEnvelopeResponse,
  AdminOrgDetailEnvelopeResponse,
  AdminOrganizationsEnvelopeResponse,
  AdminOverviewEnvelopeResponse,
  AdminSettingsEnvelopeResponse,
  AdminUpdatePricingDto,
  AdminUpdateSettingsDto,
} from './dto/index.js';

/**
 * AdminController — the Platform Admin Console API (PRD §5.5).
 *
 * Every route is an ordinary authenticated route (never @PublicRoute /
 * @SystemContext) marked @RequiresPlatformAdmin(): JwtAuthGuard enforces
 * auth (401), PlatformAdminGuard enforces the isPlatformAdmin claim
 * (403 PLATFORM_ADMIN_REQUIRED) — PLT-1/PLT-2.
 *
 * Tenant data is only ever touched inside TransactionManager.runWithOrg
 * (the use cases do this), so RLS stays the isolation backstop (PLT-3).
 */
@Controller('v1/admin')
@UseGuards(AuthGuard('jwt'))
export class AdminController {
  constructor(
    private readonly overviewUseCase: AdminOverviewUseCase,
    private readonly listOrganizationsUseCase: ListOrganizationsUseCase,
    private readonly getOrganizationDetailUseCase: GetOrganizationDetailUseCase,
    private readonly setOrganizationModuleUseCase: SetOrganizationModuleUseCase,
    private readonly getModulePricingUseCase: GetModulePricingUseCase,
    private readonly updateModulePricingUseCase: UpdateModulePricingUseCase,
    private readonly getSaasSettingsUseCase: GetSaasSettingsUseCase,
    private readonly updateSaasSettingsUseCase: UpdateSaasSettingsUseCase,
  ) {}

  @Get('overview')
  @RequiresPlatformAdmin()
  @ApiOkResponse({ type: AdminOverviewEnvelopeResponse })
  async overview(): Promise<{ data: Awaited<ReturnType<AdminOverviewUseCase['execute']>> }> {
    return { data: await this.overviewUseCase.execute() };
  }

  @Get('organizations')
  @RequiresPlatformAdmin()
  @ApiOkResponse({ type: AdminOrganizationsEnvelopeResponse })
  async listOrganizations(
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ): Promise<{ data: Awaited<ReturnType<ListOrganizationsUseCase['execute']>> }> {
    // exactOptionalPropertyTypes: undefined values must not be passed as
    // present-but-undefined options — build the input conditionally.
    return {
      data: await this.listOrganizationsUseCase.execute({
        ...(search !== undefined && search.length > 0 ? { search } : {}),
        ...(page !== undefined && page.length > 0 ? { page: Number(page) } : {}),
        ...(pageSize !== undefined && pageSize.length > 0 ? { pageSize: Number(pageSize) } : {}),
      }),
    };
  }

  @Get('organizations/:orgId')
  @RequiresPlatformAdmin()
  @ApiOkResponse({ type: AdminOrgDetailEnvelopeResponse })
  async organizationDetail(
    @Param('orgId') orgId: string,
  ): Promise<{ data: Awaited<ReturnType<GetOrganizationDetailUseCase['execute']>> }> {
    return { data: await this.getOrganizationDetailUseCase.execute({ organizationId: orgId }) };
  }

  @Post('organizations/:orgId/modules/:moduleKey/enable')
  @RequiresPlatformAdmin()
  @UsePipes(new ZodValidationPipe(adminEnableModuleSchema))
  @ApiOkResponse({ type: AdminMessageEnvelopeResponse })
  async enableModule(
    @Param('orgId') orgId: string,
    @Param('moduleKey') moduleKey: string,
    @Body() dto: AdminEnableModuleDto,
    @Req() req: IncomingMessage,
  ): Promise<{ data: { message: string } }> {
    const actor = this.actor(req);
    return {
      data: await this.setOrganizationModuleUseCase.execute({
        targetOrgId: orgId,
        moduleKey,
        action: 'enable',
        skipTrial: dto.skipTrial,
        actorUserId: actor.userId,
        actorEmail: actor.email,
      }),
    };
  }

  @Post('organizations/:orgId/modules/:moduleKey/disable')
  @RequiresPlatformAdmin()
  @UsePipes(new ZodValidationPipe(adminDisableModuleSchema))
  @ApiOkResponse({ type: AdminMessageEnvelopeResponse })
  async disableModule(
    @Param('orgId') orgId: string,
    @Param('moduleKey') moduleKey: string,
    @Body() _dto: AdminDisableModuleDto,
    @Req() req: IncomingMessage,
  ): Promise<{ data: { message: string } }> {
    const actor = this.actor(req);
    return {
      data: await this.setOrganizationModuleUseCase.execute({
        targetOrgId: orgId,
        moduleKey,
        action: 'disable',
        actorUserId: actor.userId,
        actorEmail: actor.email,
      }),
    };
  }

  @Get('modules')
  @RequiresPlatformAdmin()
  @ApiOkResponse({ type: AdminModulesEnvelopeResponse })
  async modules(): Promise<{ data: Awaited<ReturnType<GetModulePricingUseCase['execute']>> }> {
    return { data: await this.getModulePricingUseCase.execute() };
  }

  @Put('modules/:moduleKey/pricing')
  @RequiresPlatformAdmin()
  @UsePipes(new ZodValidationPipe(adminUpdatePricingSchema))
  @ApiOkResponse({ type: AdminModulesEnvelopeResponse })
  async updatePricing(
    @Param('moduleKey') moduleKey: string,
    @Body() dto: AdminUpdatePricingDto,
    @Req() req: IncomingMessage,
  ): Promise<{ data: Awaited<ReturnType<UpdateModulePricingUseCase['execute']>> }> {
    const actor = this.actor(req);
    return {
      data: await this.updateModulePricingUseCase.execute({
        moduleKey,
        priceMonthlyMinor: dto.priceMonthlyMinor,
        priceYearlyMinor: dto.priceYearlyMinor,
        currency: dto.currency,
        actorUserId: actor.userId,
        actorEmail: actor.email,
      }),
    };
  }

  @Get('settings')
  @RequiresPlatformAdmin()
  @ApiOkResponse({ type: AdminSettingsEnvelopeResponse })
  async getSettings(): Promise<{ data: Awaited<ReturnType<GetSaasSettingsUseCase['execute']>> }> {
    return { data: await this.getSaasSettingsUseCase.execute() };
  }

  @Put('settings')
  @RequiresPlatformAdmin()
  @UsePipes(new ZodValidationPipe(adminUpdateSettingsSchema))
  @ApiOkResponse({ type: AdminSettingsEnvelopeResponse })
  async updateSettings(
    @Body() dto: AdminUpdateSettingsDto,
    @Req() req: IncomingMessage,
  ): Promise<{ data: Record<string, unknown> }> {
    const actor = this.actor(req);
    return {
      data: await this.updateSaasSettingsUseCase.execute({
        settings: dto,
        actorUserId: actor.userId,
        actorEmail: actor.email,
      }),
    };
  }

  /** The acting platform admin (user id + email) for audit entries (PLT-4). */
  private actor(request: IncomingMessage): { userId: string | null; email: string | null } {
    const user = (request as { user?: { sub?: string; email?: string } }).user;
    return { userId: user?.sub ?? null, email: user?.email ?? null };
  }
}
