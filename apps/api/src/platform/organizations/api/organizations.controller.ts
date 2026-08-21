import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards, UsePipes } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiCreatedResponse, ApiOkResponse } from '@nestjs/swagger';

import { Audit } from '../../../core/audit/__init__.js';
import { RequiresPermission } from '../../../core/authorization/__init__.js';
import { NotFoundError } from '../../../core/common/errors.js';
import { ZodValidationPipe } from '../../../core/common/zod-validation.pipe.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';
import {
  CreateOrganizationUseCase,
  GetOrganizationUseCase,
  UpdateOrganizationUseCase,
  DeleteOrganizationUseCase,
  CancelDeletionUseCase,
  UpdateOrganizationSettingsUseCase,
} from '../application/index.js';

import {
  createOrganizationSchema,
  updateOrganizationSchema,
  updateOrganizationSettingsSchema,
  organizationToResponse,
  settingsToResponse,
  CreateOrganizationDto,
  UpdateOrganizationDto,
  UpdateOrganizationSettingsDto,
  OrganizationResponse,
  OrganizationSettingsResponse,
  OrganizationEnvelopeResponse,
  OrganizationDetailResponse,
  OrganizationDeleteResponse,
  SettingsEnvelopeResponse,
  SettingsUpdateEnvelopeResponse,
} from './dto/index.js';

/**
 * OrganizationsController — REST endpoints for organization management.
 *
 * All endpoints require authentication (JWT auth guard).
 * Organization access is verified through membership checks.
 *
 * Route prefix: /v1/organizations
 */
@Controller('v1/organizations')
@UseGuards(AuthGuard('jwt'))
export class OrganizationsController {
  constructor(
    private readonly createOrgUseCase: CreateOrganizationUseCase,
    private readonly getOrgUseCase: GetOrganizationUseCase,
    private readonly updateOrgUseCase: UpdateOrganizationUseCase,
    private readonly deleteOrgUseCase: DeleteOrganizationUseCase,
    private readonly cancelDeletionUseCase: CancelDeletionUseCase,
    private readonly updateSettingsUseCase: UpdateOrganizationSettingsUseCase,
  ) {}

  /**
   * TEN-2: bind an `:id` path param to the authenticated session's org.
   *
   * core_organizations is a GLOBAL (non-RLS) table, so nothing below the
   * controller filters by organization — a `:id` passed straight to a use
   * case would let any permission holder read or mutate ANOTHER org's
   * profile (e.g. an OWNER of org A renaming org B). The session org is
   * authoritative; a mismatched id fails closed as if the org did not
   * exist (never reveal cross-tenant rows).
   */
  private assertSessionOrg(id: string): string {
    const sessionOrgId = TenantContext.requireOrganizationId();
    if (id !== sessionOrgId) {
      throw new NotFoundError('ORG_NOT_FOUND', { organizationId: id });
    }
    return sessionOrgId;
  }

  /**
   * POST /v1/organizations
   * Create a new organization.
   *
   * Creates the organization and default settings. The authenticated user
   * becomes the organization's OWNER through membership creation.
   */
  @Post()
  @ApiCreatedResponse({ type: OrganizationEnvelopeResponse })
  @UsePipes(new ZodValidationPipe(createOrganizationSchema))
  async create(@Body() dto: CreateOrganizationDto): Promise<{ data: OrganizationResponse }> {
    const result = await this.createOrgUseCase.execute(dto);

    return {
      data: organizationToResponse(result.organization.toJSON()),
    };
  }

  /**
   * GET /v1/organizations/:id
   * Get organization details and settings.
   */
  @Get(':id')
  @ApiOkResponse({ type: OrganizationDetailResponse })
  async getById(@Param('id') id: string): Promise<{
    data: OrganizationResponse;
    settings: OrganizationSettingsResponse | null;
  }> {
    const result = await this.getOrgUseCase.execute({ organizationId: this.assertSessionOrg(id) });

    return {
      data: organizationToResponse(result.organization.toJSON()),
      settings: result.settings ? settingsToResponse(result.settings.toJSON()) : null,
    };
  }

  /**
   * GET /v1/organizations/me
   * Get the current user's active organization.
   */
  @Get('me')
  @ApiOkResponse({ type: OrganizationDetailResponse })
  async getCurrent(): Promise<{
    data: OrganizationResponse;
    settings: OrganizationSettingsResponse | null;
  }> {
    const organizationId = TenantContext.requireOrganizationId();
    const result = await this.getOrgUseCase.execute({ organizationId });

    return {
      data: organizationToResponse(result.organization.toJSON()),
      settings: result.settings ? settingsToResponse(result.settings.toJSON()) : null,
    };
  }

  /**
   * PATCH /v1/organizations/:id
   * Update organization profile.
   *
   * AUTHZ-5/BUSINESS_RULES §3: org profile edits (name, country, currency,
   * timezone) are OWNER/ADMIN-only, same as org settings. The PermissionGuard
   * rejects a VIEWER/MEMBER with 403 FORBIDDEN before the use case runs —
   * this route was previously unguarded, letting any member rename the org
   * (the web form calls this endpoint for name/currency while only the
   * /settings endpoint carried the permission, so a viewer's name change
   * silently persisted even though the UI showed a generic error).
   */
  @Patch(':id')
  @ApiOkResponse({ type: OrganizationEnvelopeResponse })
  @RequiresPermission('platform:settings:manage')
  @UsePipes(new ZodValidationPipe(updateOrganizationSchema))
  @Audit({ action: 'UPDATE', entityType: 'organization', captureAfter: true, captureBefore: true })
  async update(@Param('id') id: string, @Body() dto: UpdateOrganizationDto): Promise<{ data: OrganizationResponse }> {
    // exactOptionalPropertyTypes: spreading the DTO would carry explicit
    // `undefined` for absent fields — spread each defined field conditionally.
    const organization = await this.updateOrgUseCase.execute({
      organizationId: this.assertSessionOrg(id),
      ...(dto.name !== undefined ? { name: dto.name } : {}),
      ...(dto.countryCode !== undefined ? { countryCode: dto.countryCode } : {}),
      ...(dto.timezone !== undefined ? { timezone: dto.timezone } : {}),
      ...(dto.baseCurrency !== undefined ? { baseCurrency: dto.baseCurrency } : {}),
      ...(dto.defaultLocale !== undefined ? { defaultLocale: dto.defaultLocale } : {}),
      ...(dto.hasMonetaryRecords !== undefined ? { hasMonetaryRecords: dto.hasMonetaryRecords } : {}),
    });

    return {
      data: organizationToResponse(organization.toJSON()),
    };
  }

  /**
   * DELETE /v1/organizations/:id
   * Soft-delete organization with 30-day grace period (GDPR-2).
   */
  @Delete(':id')
  @ApiOkResponse({ type: OrganizationDeleteResponse })
  @RequiresPermission('platform:organization:delete')
  @Audit({ action: 'SOFT_DELETE', entityType: 'organization', captureBefore: true })
  async delete(@Param('id') id: string): Promise<{
    data: { deletionScheduledAt: string; message: string };
  }> {
    const result = await this.deleteOrgUseCase.execute({ organizationId: this.assertSessionOrg(id) });

    return {
      data: {
        deletionScheduledAt: result.deletionScheduledAt.toISOString(),
        message: 'Organization deletion scheduled. It will be permanently deleted after 30 days.',
      },
    };
  }

  /**
   * POST /v1/organizations/:id/cancel-deletion
   * Cancel a pending deletion and restore the organization.
   */
  @Post(':id/cancel-deletion')
  @ApiCreatedResponse({ type: OrganizationEnvelopeResponse })
  @RequiresPermission('platform:organization:delete')
  @Audit({ action: 'UPDATE', entityType: 'organization', captureBefore: true })
  async cancelDeletion(@Param('id') id: string): Promise<{ data: OrganizationResponse }> {
    const organization = await this.cancelDeletionUseCase.execute({ organizationId: this.assertSessionOrg(id) });

    return {
      data: organizationToResponse(organization.toJSON()),
    };
  }

  /**
   * GET /v1/organizations/:id/settings
   * Get organization settings.
   */
  @Get(':id/settings')
  @ApiOkResponse({ type: SettingsEnvelopeResponse })
  async getSettings(@Param('id') id: string): Promise<{ data: OrganizationSettingsResponse | null }> {
    const result = await this.getOrgUseCase.execute({ organizationId: this.assertSessionOrg(id) });

    return {
      data: result.settings ? settingsToResponse(result.settings.toJSON()) : null,
    };
  }

  /**
   * PATCH /v1/organizations/:id/settings
   * Update organization settings.
   */
  @Patch(':id/settings')
  @ApiOkResponse({ type: SettingsUpdateEnvelopeResponse })
  @UsePipes(new ZodValidationPipe(updateOrganizationSettingsSchema))
  @RequiresPermission('platform:settings:manage')
  @Audit({ action: 'UPDATE', entityType: 'organization_settings', captureAfter: true, captureBefore: true })
  async updateSettings(
    @Param('id') id: string,
    @Body() dto: UpdateOrganizationSettingsDto,
  ): Promise<{ data: OrganizationSettingsResponse }> {
    // exactOptionalPropertyTypes: spread each defined field conditionally so
    // absent fields never carry an explicit `undefined`.
    const settings = await this.updateSettingsUseCase.execute({
      organizationId: this.assertSessionOrg(id),
      ...(dto.locale !== undefined ? { locale: dto.locale } : {}),
      ...(dto.timezone !== undefined ? { timezone: dto.timezone } : {}),
      ...(dto.baseCurrency !== undefined ? { baseCurrency: dto.baseCurrency } : {}),
      ...(dto.numberPreferences !== undefined ? { numberPreferences: dto.numberPreferences } : {}),
      ...(dto.datePreferences !== undefined ? { datePreferences: dto.datePreferences } : {}),
      ...(dto.receiptFooter !== undefined ? { receiptFooter: dto.receiptFooter } : {}),
      ...(dto.sellerTaxId !== undefined ? { sellerTaxId: dto.sellerTaxId } : {}),
      ...(dto.taxEnabled !== undefined ? { taxEnabled: dto.taxEnabled } : {}),
    });

    return {
      data: settingsToResponse(settings.toJSON()),
    };
  }
}
