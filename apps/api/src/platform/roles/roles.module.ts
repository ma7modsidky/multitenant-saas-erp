import { Module } from '@nestjs/common';

import { AuthModule } from '../../core/auth/auth.module.js';
import { MembershipsModule } from '../memberships/memberships.module.js';
import { RolesController } from './api/index.js';
import {
  CreateRoleUseCase,
  UpdateRoleUseCase,
  DeleteRoleUseCase,
  AssignRoleUseCase,
  TransferOwnershipUseCase,
  GetRoleMatrixUseCase,
} from './application/index.js';
import { DrizzleRoleRepository } from './infrastructure/repositories/drizzle-role.repository.js';
import { ROLE_REPOSITORY } from './ports/index.js';

@Module({
  imports: [AuthModule, MembershipsModule],
  controllers: [RolesController],
  providers: [
    // Repository
    { provide: ROLE_REPOSITORY, useClass: DrizzleRoleRepository },
    // Use cases
    CreateRoleUseCase,
    UpdateRoleUseCase,
    DeleteRoleUseCase,
    AssignRoleUseCase,
    TransferOwnershipUseCase,
    GetRoleMatrixUseCase,
  ],
  exports: [
    ROLE_REPOSITORY,
    GetRoleMatrixUseCase,
  ],
})
export class RolesModule {}
