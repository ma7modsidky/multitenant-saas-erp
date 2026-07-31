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

import {
  CreateOrganizationUseCase,
  GetOrganizationUseCase,
  UpdateOrganizationUseCase,
  DeleteOrganizationUseCase,
  CancelDeletionUseCase,
  UpdateOrganizationSettingsUseCase,
} from '../application/index.js';
import { ZodValidationPipe } from '../../../core/common/zod-validation.pipe.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';
import {
  createOrganizationSchema,
  updateOrganizationSchema,
  updateOrganizationSettingsSchema,
  organizationToResponse,
  settingsToResponse,
  type CreateOrganizationDto,
  type UpdateOrganizationDto,
  type UpdateOrganizationSettingsDto,
  type OrganizationResponse,
  type OrganizationSettingsResponse,
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
   * POST /v1/organizations
   * Create a new organization.
   *
   * Creates the organization and default settings. The authenticated user
   * becomes the organization's OWNER through membership creation.
   */
  @Post()
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
  async getById(@Param('id') id: string): Promise<{
    data: OrganizationResponse;
    settings: OrganizationSettingsResponse | null;
  }> {
    const result = await this.getOrgUseCase.execute({ organizationId: id });

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
   */
  @Patch(':id')
  @UsePipes(new ZodValidationPipe(updateOrganizationSchema))
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateOrganizationDto,
  ): Promise<{ data: OrganizationResponse }> {
    const organization = await this.updateOrgUseCase.execute({
      organizationId: id,
      ...dto,
    } as any); // DTO was Zod-validated at the boundary

    return {
      data: organizationToResponse(organization.toJSON()),
    };
  }

  /**
   * DELETE /v1/organizations/:id
   * Soft-delete organization with 30-day grace period (GDPR-2).
   */
  @Delete(':id')
  async delete(@Param('id') id: string): Promise<{
    data: { deletionScheduledAt: string; message: string };
  }> {
    const result = await this.deleteOrgUseCase.execute({ organizationId: id });

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
  async cancelDeletion(@Param('id') id: string): Promise<{ data: OrganizationResponse }> {
    const organization = await this.cancelDeletionUseCase.execute({ organizationId: id });

    return {
      data: organizationToResponse(organization.toJSON()),
    };
  }

  /**
   * GET /v1/organizations/:id/settings
   * Get organization settings.
   */
  @Get(':id/settings')
  async getSettings(@Param('id') id: string): Promise<{ data: OrganizationSettingsResponse | null }> {
    const result = await this.getOrgUseCase.execute({ organizationId: id });

    return {
      data: result.settings ? settingsToResponse(result.settings.toJSON()) : null,
    };
  }

  /**
   * PATCH /v1/organizations/:id/settings
   * Update organization settings.
   */
  @Patch(':id/settings')
  @UsePipes(new ZodValidationPipe(updateOrganizationSettingsSchema))
  async updateSettings(
    @Param('id') id: string,
    @Body() dto: UpdateOrganizationSettingsDto,
  ): Promise<{ data: OrganizationSettingsResponse }> {
    const settings = await this.updateSettingsUseCase.execute({
      organizationId: id,
      ...dto,
    } as any); // DTO was Zod-validated at the boundary

    return {
      data: settingsToResponse(settings.toJSON()),
    };
  }
}
