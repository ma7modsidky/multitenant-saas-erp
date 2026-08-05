import { Module } from '@nestjs/common';

import { DrizzleEntitlementStore } from './drizzle-entitlement.store.js';
import { EntitlementService } from './entitlement.service.js';

/**
 * EntitlementsModule — global module providing module entitlement infrastructure.
 *
 * Provides:
 *   - EntitlementService  (injectable via class)
 *   - 'ENTITLEMENT_STORE' (injectable via token: DrizzleEntitlementStore)
 *
 * The store is backed by core_module_entitlements (BILL-4: the runtime
 * authority) so the EntitlementGuard sees trial/enable/disable writes made
 * through the billing platform immediately. The InMemoryEntitlementStore
 * (Phase 1.6 stub) remains available for unit tests.
 *
 * @see BILL-4 — core_module_entitlements is the runtime authority
 * @see ARCHITECTURE.md §3 — core/entitlements
 */
@Module({
  providers: [
    EntitlementService,
    {
      provide: 'ENTITLEMENT_STORE',
      useClass: DrizzleEntitlementStore,
    },
  ],
  exports: [EntitlementService, 'ENTITLEMENT_STORE'],
})
export class EntitlementsModule {}
