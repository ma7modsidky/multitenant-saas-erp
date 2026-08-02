import { Body, Controller, Get, Param, Post, UseGuards, UsePipes } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

import { RequiresPermission } from '../../../core/authorization/__init__.js';
import { ZodValidationPipe } from '../../../core/common/zod-validation.pipe.js';
import { PublicRoute } from '../../../core/tenancy/system-context.decorator.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';
import {
  ListModulesUseCase,
  EnableModuleUseCase,
  DisableModuleUseCase,
  GetNavigationUseCase,
} from '../application/index.js';

import {
  enableModuleSchema,
  disableModuleSchema,
  type EnableModuleDto,
  type DisableModuleDto,
  type ModuleCatalogResponse,
  type NavigationResponse,
} from './dto/index.js';

@Controller('v1')
@UseGuards(AuthGuard('jwt'))
export class ModuleRegistryController {
  // eslint-disable-next-line max-params -- NestJS DI requires all use cases
  constructor(
    private readonly listModulesUseCase: ListModulesUseCase,
    private readonly enableModuleUseCase: EnableModuleUseCase,
    private readonly disableModuleUseCase: DisableModuleUseCase,
    private readonly getNavigationUseCase: GetNavigationUseCase,
  ) {}

  /**
   * GET /v1/modules — Public catalog of all registered modules.
   * No auth required — used for the marketplace and signup flow.
   */
  @PublicRoute()
  @Get('modules')
  async listModules(): Promise<{ data: ModuleCatalogResponse[] }> {
    const result = await this.listModulesUseCase.execute();
    return { data: result };
  }

  /**
   * GET /v1/me/navigation — Navigation derived from entitlements + permissions.
   * Returns only modules the current org is entitled to.
   */
  @Get('me/navigation')
  async getNavigation(): Promise<{ data: NavigationResponse[] }> {
    const orgId = TenantContext.requireOrganizationId();
    const result = await this.getNavigationUseCase.execute({ organizationId: orgId });
    return { data: result };
  }

  /**
   * POST /v1/organizations/:orgId/modules/enable
   * Enable a module with dependency validation.
   */
  @Post('organizations/:orgId/modules/enable')
  @UsePipes(new ZodValidationPipe(enableModuleSchema))
  @RequiresPermission('platform:modules:enable')
  async enableModule(
    @Param('orgId') orgId: string,
    @Body() dto: EnableModuleDto,
  ): Promise<{ data: { message: string } }> {
    const userId = TenantContext.requireUserId();
    await this.enableModuleUseCase.execute({
      organizationId: orgId,
      moduleKey: dto.moduleKey,
      updatedBy: userId,
    });
    return { data: { message: `Module '${dto.moduleKey}' enabled.` } };
  }

  /**
   * POST /v1/organizations/:orgId/modules/disable
   * Disable a module with dependent module guard.
   */
  @Post('organizations/:orgId/modules/disable')
  @UsePipes(new ZodValidationPipe(disableModuleSchema))
  @RequiresPermission('platform:modules:disable')
  async disableModule(
    @Param('orgId') orgId: string,
    @Body() dto: DisableModuleDto,
  ): Promise<{ data: { message: string } }> {
    const userId = TenantContext.requireUserId();
    await this.disableModuleUseCase.execute({
      organizationId: orgId,
      moduleKey: dto.moduleKey,
      updatedBy: userId,
    });
    return { data: { message: `Module '${dto.moduleKey}' disabled.` } };
  }
}
