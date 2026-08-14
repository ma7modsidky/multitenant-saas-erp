import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import { EntitlementsModule } from '../entitlements/entitlements.module.js';

import { EntitlementGuard } from './entitlement.guard.js';
import { JwtAuthGuard } from './jwtauth.guard.js';
import { PermissionGuard } from './permission.guard.js';
import { PlatformAdminGuard } from './platform-admin.guard.js';

/**
 * AuthorizationModule — the authorization infrastructure module.
 *
 * Registers four global guards that run in sequence for every request:
 *
 *   1. JwtAuthGuard         — verifies the Bearer access token (AUTH-4)
 *   2. EntitlementGuard     — checks module entitlement (AUTHZ-6)
 *   3. PermissionGuard      — checks @RequiresPermission via CASL (AUTHZ-5)
 *   4. PlatformAdminGuard   — checks @RequiresPlatformAdmin (PLT-2)
 *
 * The guard ordering matters and follows ARCHITECTURE.md §5:
 *   auth → tenancy → entitlement → permission → platform-admin → handler
 *
 * Routes are skipped appropriately:
 *   - @PublicRoute(): all guards skip (no auth, no checks)
 *   - @SystemContext(): JwtAuthGuard allows optional auth, other guards skip
 *   - @RequiresModule(): EntitlementGuard checks module access
 *   - @RequiresPermission(): PermissionGuard checks each permission
 *   - @RequiresPlatformAdmin(): PlatformAdminGuard checks the isPlatformAdmin
 *     claim — admin routes are ordinary authenticated routes, so the JWT
 *     guard still enforces auth first (PLT-2).
 *
 * @see ARCHITECTURE.md §3 — core/authorization
 * @see ARCHITECTURE.md §5 — Request lifecycle
 */
@Module({
  imports: [EntitlementsModule],
  providers: [
    // JwtAuthGuard — runs first, authenticates the request
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    // EntitlementGuard — runs second, checks module entitlement (AUTHZ-6)
    {
      provide: APP_GUARD,
      useClass: EntitlementGuard,
    },
    // PermissionGuard — runs third, checks @RequiresPermission (AUTHZ-5)
    {
      provide: APP_GUARD,
      useClass: PermissionGuard,
    },
    // PlatformAdminGuard — runs last, checks @RequiresPlatformAdmin (PLT-2)
    {
      provide: APP_GUARD,
      useClass: PlatformAdminGuard,
    },
  ],
  exports: [],
})
export class AuthorizationModule {}
