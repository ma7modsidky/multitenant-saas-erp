import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, UseGuards, UsePipes } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiCreatedResponse, ApiOkResponse } from '@nestjs/swagger';

import { Audit } from '../../../core/audit/__init__.js';
import { RequiresPermission } from '../../../core/authorization/__init__.js';
import { ZodValidationPipe } from '../../../core/common/zod-validation.pipe.js';
import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';
import {
  CreateRoleUseCase,
  UpdateRoleUseCase,
  DeleteRoleUseCase,
  AssignRoleUseCase,
  TransferOwnershipUseCase,
  GetRoleMatrixUseCase,
} from '../application/index.js';
import { ROLE_REPOSITORY, type RoleRepository } from '../ports/index.js';

import {
  createRoleSchema,
  updateRoleSchema,
  assignRoleSchema,
  transferOwnershipSchema,
  CreateRoleDto,
  UpdateRoleDto,
  AssignRoleDto,
  TransferOwnershipDto,
  RoleResponse,
  RoleMatrixResponse,
  RolesEnvelopeResponse,
  RoleMatrixEnvelopeResponse,
  RoleCreatedEnvelopeResponse,
  RoleMessageEnvelopeResponse,
} from './dto/index.js';

@Controller('v1')
@UseGuards(AuthGuard('jwt'))
export class RolesController {
  constructor(
    @Inject(ROLE_REPOSITORY)
    private readonly roleRepo: RoleRepository,
    private readonly createRoleUseCase: CreateRoleUseCase,
    private readonly updateRoleUseCase: UpdateRoleUseCase,
    private readonly deleteRoleUseCase: DeleteRoleUseCase,
    private readonly assignRoleUseCase: AssignRoleUseCase,
    private readonly transferOwnershipUseCase: TransferOwnershipUseCase,
    private readonly getRoleMatrixUseCase: GetRoleMatrixUseCase,
    private readonly txManager: TransactionManager,
  ) {}

  @Get('organizations/:orgId/roles')
  @ApiOkResponse({ type: RolesEnvelopeResponse })
  async listRoles(@Param('orgId') orgId: string): Promise<{ data: RoleResponse[] }> {
    const roles = await this.txManager.run((tx) => this.roleRepo.findByOrgId(orgId, tx));

    const mapped = await Promise.all(
      roles.map(async (r) => {
        const [permissions, memberCount] = await this.txManager.run(async (tx) => {
          const [perms, count] = await Promise.all([
            this.roleRepo.getPermissions(r.id, tx),
            this.roleRepo.countMembersByRoleId(orgId, r.id, tx),
          ]);
          return [perms, count] as const;
        });

        return {
          id: r.id,
          key: r.key,
          nameI18n: r.nameI18n,
          description: r.description,
          isSystem: r.isSystem,
          permissions,
          memberCount,
        };
      }),
    );

    return { data: mapped };
  }

  @Get('organizations/:orgId/roles/matrix')
  @ApiOkResponse({ type: RoleMatrixEnvelopeResponse })
  async getRoleMatrix(@Param('orgId') orgId: string): Promise<{ data: RoleMatrixResponse }> {
    const result = await this.getRoleMatrixUseCase.execute({ organizationId: orgId });
    return {
      data: {
        systemRoles: result.systemRoles,
        customRoles: result.customRoles,
        platformPermissions: [...result.platformPermissions],
        permissionCatalog: result.permissionCatalog,
      },
    };
  }

  @Post('organizations/:orgId/roles')
  @ApiCreatedResponse({ type: RoleCreatedEnvelopeResponse })
  @UsePipes(new ZodValidationPipe(createRoleSchema))
  @RequiresPermission('platform:roles:manage')
  @Audit({ action: 'CREATE', entityType: 'role', captureAfter: true })
  async createRole(@Param('orgId') orgId: string, @Body() dto: CreateRoleDto): Promise<{ data: { id: string } }> {
    const userId = TenantContext.requireUserId();

    // Build input object — filter out undefined values for exactOptionalPropertyTypes
    const input: {
      organizationId: string;
      key: string;
      nameI18n: Record<string, string>;
      description?: string;
      permissionKeys?: string[];
      createdBy: string;
    } = {
      organizationId: orgId,
      key: dto.key,
      nameI18n: dto.nameI18n ?? {},
      createdBy: userId,
    };
    if (dto.description !== undefined) input.description = dto.description;
    if (dto.permissionKeys !== undefined) input.permissionKeys = dto.permissionKeys;

    const result = await this.createRoleUseCase.execute(input);
    return { data: result };
  }

  @Patch('roles/:id')
  @ApiOkResponse({ type: RoleMessageEnvelopeResponse })
  @UsePipes(new ZodValidationPipe(updateRoleSchema))
  @RequiresPermission('platform:roles:manage')
  @Audit({ action: 'UPDATE', entityType: 'role', captureAfter: true, captureBefore: true })
  async updateRole(@Param('id') id: string, @Body() dto: UpdateRoleDto): Promise<{ data: { message: string } }> {
    const organizationId = TenantContext.requireOrganizationId();
    const userId = TenantContext.requireUserId();

    const input: {
      roleId: string;
      organizationId: string;
      nameI18n?: Record<string, string>;
      description?: string | null;
      permissionKeys?: string[];
      updatedBy: string;
    } = {
      roleId: id,
      organizationId,
      updatedBy: userId,
    };
    if (dto.nameI18n !== undefined) input.nameI18n = dto.nameI18n;
    if (dto.description !== undefined) input.description = dto.description;
    if (dto.permissionKeys !== undefined) input.permissionKeys = dto.permissionKeys;

    await this.updateRoleUseCase.execute(input);
    return { data: { message: 'Role updated.' } };
  }

  @Delete('roles/:id')
  @ApiOkResponse({ type: RoleMessageEnvelopeResponse })
  @RequiresPermission('platform:roles:manage')
  @Audit({ action: 'SOFT_DELETE', entityType: 'role', captureBefore: true })
  async deleteRole(@Param('id') id: string): Promise<{ data: { message: string } }> {
    const organizationId = TenantContext.requireOrganizationId();
    const userId = TenantContext.requireUserId();

    await this.deleteRoleUseCase.execute({
      roleId: id,
      organizationId,
      updatedBy: userId,
    });

    return { data: { message: 'Role deleted.' } };
  }

  @Post('memberships/:id/assign-role')
  @ApiCreatedResponse({ type: RoleMessageEnvelopeResponse })
  @UsePipes(new ZodValidationPipe(assignRoleSchema))
  @RequiresPermission('platform:members:assign-role')
  @Audit({ action: 'UPDATE', entityType: 'membership', captureAfter: true, captureBefore: true })
  async assignRole(@Param('id') id: string, @Body() dto: AssignRoleDto): Promise<{ data: { message: string } }> {
    const organizationId = TenantContext.requireOrganizationId();
    const userId = TenantContext.requireUserId();

    await this.assignRoleUseCase.execute({
      membershipId: id,
      organizationId,
      newRoleId: dto.roleId,
      currentUserId: userId,
    });

    return { data: { message: 'Role assigned.' } };
  }

  @Post('organizations/:orgId/transfer-ownership')
  @ApiCreatedResponse({ type: RoleMessageEnvelopeResponse })
  @UsePipes(new ZodValidationPipe(transferOwnershipSchema))
  @RequiresPermission('platform:ownership:transfer')
  @Audit({ action: 'UPDATE', entityType: 'membership', captureAfter: true })
  async transferOwnership(
    @Param('orgId') orgId: string,
    @Body() dto: TransferOwnershipDto,
  ): Promise<{ data: { message: string } }> {
    const userId = TenantContext.requireUserId();

    await this.transferOwnershipUseCase.execute({
      organizationId: orgId,
      currentUserId: userId,
      targetUserId: dto.targetUserId,
    });

    return { data: { message: 'Ownership transferred.' } };
  }
}
