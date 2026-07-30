import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';

import { TenantInterceptor } from './tenant.interceptor.js';

/**
 * TenancyModule — the tenancy infrastructure module.
 *
 * Provides:
 *   - TenantInterceptor (global): binds tenant context from authenticated session
 *     Runs after guards, so request.user is available.
 *   - TenantContext: AsyncLocalStorage-based per-request context
 *   - @PublicRoute() / @SystemContext() decorators
 *   - withoutTenantContext() test helper
 *
 * The interceptor is registered globally via APP_INTERCEPTOR so it applies
 * to all routes. It reads route metadata (@PublicRoute, @SystemContext)
 * to decide whether to skip tenant context setup.
 *
 * @see ARCHITECTURE.md §3 — core/tenancy
 * @see ARCHITECTURE.md §5 — Request lifecycle
 */
@Module({
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: TenantInterceptor,
    },
  ],
  exports: [],
})
export class TenancyModule {}
