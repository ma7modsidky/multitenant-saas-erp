import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../core/database/database.module.js';
import { BillingModule } from '../billing/billing.module.js';
import { MembershipsModule } from '../memberships/memberships.module.js';
import { ModuleRegistryModule } from '../module-registry/module-registry.module.js';
import { OrganizationsModule } from '../organizations/organizations.module.js';
import { UsersModule } from '../users/users.module.js';

import { AdminController } from './api/index.js';
import {
  AdjustEntitlementUseCase,
  AdminBootstrapService,
  AdminOverviewUseCase,
  GetModulePricingUseCase,
  GetOrganizationDetailUseCase,
  GetSaasSettingsUseCase,
  ListOrganizationsUseCase,
  SetOrganizationModuleUseCase,
  UpdateModulePricingUseCase,
  UpdateSaasSettingsUseCase,
} from './application/index.js';
import { DrizzleAdminDirectoryRepository } from './infrastructure/repositories/drizzle-admin-directory.repository.js';
import { DrizzleModulePricingRepository } from './infrastructure/repositories/drizzle-module-pricing.repository.js';
import { DrizzlePlatformAuditRepository } from './infrastructure/repositories/drizzle-platform-audit.repository.js';
import { DrizzleSaasSettingsRepository } from './infrastructure/repositories/drizzle-saas-settings.repository.js';
import {
  ADMIN_DIRECTORY_REPOSITORY,
  MODULE_PRICING_REPOSITORY,
  PLATFORM_AUDIT_REPOSITORY,
  SAAS_SETTINGS_REPOSITORY,
} from './ports/index.js';

/**
 * AdminModule — the Platform Admin Console (back-office superuser tooling).
 *
 * Reuses the billing/membership/org/registry repositories (imported from
 * their owning modules) so admin operations go through the SAME domain rules
 * as tenant self-service (PLT-5); the admin-specific tables
 * (core_module_pricing, core_saas_settings, core_platform_audit_log) get
 * their own repositories here.
 *
 * @see docs/ARCHITECTURE.md §8 — Platform Admin Console
 * @see docs/BUSINESS_RULES.md §12 — PLT-1..PLT-7
 */
@Module({
  imports: [DatabaseModule, UsersModule, OrganizationsModule, MembershipsModule, BillingModule, ModuleRegistryModule],
  controllers: [AdminController],
  providers: [
    // Admin-owned global tables
    { provide: ADMIN_DIRECTORY_REPOSITORY, useClass: DrizzleAdminDirectoryRepository },
    { provide: MODULE_PRICING_REPOSITORY, useClass: DrizzleModulePricingRepository },
    { provide: SAAS_SETTINGS_REPOSITORY, useClass: DrizzleSaasSettingsRepository },
    { provide: PLATFORM_AUDIT_REPOSITORY, useClass: DrizzlePlatformAuditRepository },
    // Use cases + boot seeding
    AdminBootstrapService,
    AdminOverviewUseCase,
    ListOrganizationsUseCase,
    GetOrganizationDetailUseCase,
    SetOrganizationModuleUseCase,
    AdjustEntitlementUseCase,
    GetModulePricingUseCase,
    UpdateModulePricingUseCase,
    GetSaasSettingsUseCase,
    UpdateSaasSettingsUseCase,
  ],
  exports: [],
})
export class AdminModule {}
