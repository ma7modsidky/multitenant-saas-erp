import { Module } from '@nestjs/common';

import { EntitlementService } from './entitlement.service.js';
import { InMemoryEntitlementStore } from './entitlement-store.js';

/**
 * EntitlementsModule — global module providing module entitlement infrastructure.
 *
 * Provides:
 *   - EntitlementService  (injectable via class)
 *   - 'ENTITLEMENT_STORE' (injectable via token, default: InMemoryEntitlementStore)
 *
 * The entitlement store is abstracted behind IEntitlementStore so that
 * Phase 2+ can swap InMemoryEntitlementStore for DrizzleEntitlementStore
 * without changing any consuming code.
 *
 * @see BILL-4 — core_module_entitlements is the runtime authority
 * @see ARCHITECTURE.md §3 — core/entitlements
 */
@Module({
  providers: [
    EntitlementService,
    {
      provide: 'ENTITLEMENT_STORE',
      useClass: InMemoryEntitlementStore,
    },
  ],
  exports: [EntitlementService, 'ENTITLEMENT_STORE'],
})
export class EntitlementsModule {}
