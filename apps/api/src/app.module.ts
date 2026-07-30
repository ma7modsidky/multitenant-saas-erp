import { Module } from '@nestjs/common';

import { AuthModule } from './core/auth/auth.module.js';
import { AuthorizationModule } from './core/authorization/authorization.module.js';
import { CommonModule } from './core/common/common.module.js';
import { DatabaseModule } from './core/database/database.module.js';
import { EntitlementsModule } from './core/entitlements/entitlements.module.js';
import { EventsModule } from './core/events/events.module.js';
import { ObservabilityModule } from './core/observability/observability.module.js';
import { TenancyModule } from './core/tenancy/tenancy.module.js';
import { AuditModule } from './core/audit/audit.module.js';
import { I18nModule } from './core/i18n/i18n.module.js';
import { CacheModule } from './core/cache/cache.module.js';
import { JobsModule } from './core/jobs/jobs.module.js';
import { StorageModule } from './core/storage/storage.module.js';
import { NotificationsModule } from './core/notifications/notifications.module.js';

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
  imports: [CommonModule, ObservabilityModule, EventsModule, DatabaseModule, TenancyModule, EntitlementsModule, AuthModule, AuthorizationModule, AuditModule, I18nModule, CacheModule, JobsModule, StorageModule, NotificationsModule],
  controllers: [],
  providers: [],
})
export class AppModule {}
