import { Module } from '@nestjs/common';

import { AuditModule } from './core/audit/audit.module.js';
import { AuthModule } from './core/auth/auth.module.js';
import { AuthorizationModule } from './core/authorization/authorization.module.js';
import { CacheModule } from './core/cache/cache.module.js';
import { CommonModule } from './core/common/common.module.js';
import { ConfigModule } from './core/config/config.module.js';
import { DatabaseModule } from './core/database/database.module.js';
import { EntitlementsModule } from './core/entitlements/entitlements.module.js';
import { EventsModule } from './core/events/events.module.js';
import { I18nModule } from './core/i18n/i18n.module.js';
import { JobsModule } from './core/jobs/jobs.module.js';
import { NotificationsModule } from './core/notifications/notifications.module.js';
import { PortsModule } from './core/ports/ports.module.js';
import { ObservabilityModule } from './core/observability/observability.module.js';
import { StorageModule } from './core/storage/storage.module.js';
import { TenancyModule } from './core/tenancy/tenancy.module.js';
import { AuditLogModule } from './platform/audit-log/audit-log.module.js';
import { BillingModule } from './platform/billing/billing.module.js';
import { FxRatesModule } from './platform/fx-rates/fx-rates.module.js';
import { MembershipsModule } from './platform/memberships/memberships.module.js';
import { ModuleRegistryModule } from './platform/module-registry/module-registry.module.js';
import { OrganizationsModule } from './platform/organizations/organizations.module.js';
import { RolesModule } from './platform/roles/roles.module.js';
import { SearchModule } from './platform/search/search.module.js';
import { UsersModule } from './platform/users/users.module.js';

/**
 * AppModule — the composition root of the modular monolith.
 *
 * This is one of only two files permitted to import module public barrels.
 * It composes:
 *   - core/   (shared kernel: tenancy, auth, database, events, etc.)
 *   - platform/ (tenant-facing capabilities: orgs, users, billing, etc.)
 *   - modules/  (business modules: crm, inventory, pos)
 *
 * @see ARCHITECTURE.md §3 — The composition root exception
 */
@Module({
  imports: [
    ConfigModule,
    CommonModule,
    ObservabilityModule,
    EventsModule,
    DatabaseModule,
    TenancyModule,
    EntitlementsModule,
    AuthModule,
    AuthorizationModule,
    AuditModule,
    I18nModule,
    CacheModule,
    JobsModule,
    StorageModule,
    NotificationsModule,
    PortsModule,
    // Platform modules
    OrganizationsModule,
    UsersModule,
    MembershipsModule,
    RolesModule,
    BillingModule,
    ModuleRegistryModule,
    AuditLogModule,
    SearchModule,
    FxRatesModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
