import { Module } from '@nestjs/common';

import { MembershipsModule } from '../memberships/memberships.module.js';
import { RolesModule } from '../roles/roles.module.js';
import { OrganizationsController } from './api/index.js';
import {
  CreateOrganizationUseCase,
  GetOrganizationUseCase,
  UpdateOrganizationUseCase,
  DeleteOrganizationUseCase,
  CancelDeletionUseCase,
  UpdateOrganizationSettingsUseCase,
} from './application/index.js';
import { DrizzleOrganizationRepository } from './infrastructure/repositories/drizzle-organization.repository.js';
import { ORGANIZATION_REPOSITORY } from './ports/index.js';

/**
 * OrganizationsModule — platform module for organization management.
 *
 * Provides:
 *   - Organization CRUD (create, read, update, soft-delete)
 *   - Organization settings management
 *   - Deletion with 30-day grace period (GDPR-2)
 *
 * @see PLAN.md §2.2
 * @see BUSINESS_RULES.md — AUTH-10, CUR-1, GDPR-2
 */
@Module({
  imports: [MembershipsModule, RolesModule],
  controllers: [OrganizationsController],
  providers: [
    // Repository — registered by token so use cases depend on the interface
    {
      provide: ORGANIZATION_REPOSITORY,
      useClass: DrizzleOrganizationRepository,
    },
    // Use cases
    CreateOrganizationUseCase,
    GetOrganizationUseCase,
    UpdateOrganizationUseCase,
    DeleteOrganizationUseCase,
    CancelDeletionUseCase,
    UpdateOrganizationSettingsUseCase,
  ],
  exports: [
    ORGANIZATION_REPOSITORY,
    CreateOrganizationUseCase,
    GetOrganizationUseCase,
  ],
})
export class OrganizationsModule {}
