import { ORGANIZATION_READ_PORT } from '@modubiz/contracts';
import { Module, type OnModuleInit } from '@nestjs/common';

import { PortRegistry } from '../../core/ports/port-registry.js';
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
import { DrizzleOrganizationReadPort } from './infrastructure/read-ports/drizzle-organization-read.port.js';
import { DrizzleOrganizationRepository } from './infrastructure/repositories/drizzle-organization.repository.js';
import { ORGANIZATION_REPOSITORY } from './ports/index.js';

/**
 * OrganizationsModule — platform module for organization management.
 *
 * Provides:
 *   - Organization CRUD (create, read, update, soft-delete)
 *   - Organization settings management
 *   - Deletion with 30-day grace period (GDPR-2)
 *   - Level 2 read port (`ORGANIZATION_READ_PORT`) for business modules (CRM-8)
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
    // Level 2 read port implementation (consumed by business modules)
    DrizzleOrganizationReadPort,
    // Use cases
    CreateOrganizationUseCase,
    GetOrganizationUseCase,
    UpdateOrganizationUseCase,
    DeleteOrganizationUseCase,
    CancelDeletionUseCase,
    UpdateOrganizationSettingsUseCase,
  ],
  exports: [ORGANIZATION_REPOSITORY, CreateOrganizationUseCase, GetOrganizationUseCase],
})
export class OrganizationsModule implements OnModuleInit {
  constructor(
    private readonly portRegistry: PortRegistry,
    // Concrete class here (not the contracts interface): Nest DI resolves
    // runtime providers, and TS interfaces are erased at compile time.
    private readonly organizationReadPort: DrizzleOrganizationReadPort,
  ) {}

  onModuleInit(): void {
    this.portRegistry.register(ORGANIZATION_READ_PORT, this.organizationReadPort);
  }
}
