import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import { EntitlementGuard } from './entitlement.guard.js';
import { JwtAuthGuard } from './jwtauth.guard.js';
import { PermissionGuard } from './permission.guard.js';

/**
 * AuthorizationModule — the authorization infrastructure module.
 *
 * Registers three global guards that run in sequence for every request:
 *
 *   1. JwtAuthGuard       — verifies the Bearer access token (AUTH-4)
 *   2. EntitlementGuard   — checks module entitlement (AUTHZ-6)
 *   3. PermissionGuard    — checks @RequiresPermission via CASL (AUTHZ-5)
 *
 * The guard ordering matters and follows ARCHITECTURE.md §5:
 *   auth → tenancy → entitlement → permission → handler
 *
 * Routes are skipped appropriately:
 *   - @PublicRoute(): all guards skip (no auth, no checks)
 *   - @SystemContext(): JwtAuthGuard allows optional auth, other guards skip
 *   - @RequiresModule(): EntitlementGuard checks module access
 *   - @RequiresPermission(): PermissionGuard checks each permission
 *
 * @see ARCHITECTURE.md §3 — core/authorization
 * @see ARCHITECTURE.md §5 — Request lifecycle
 */
@Module({
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
  ],
  exports: [],
})
export class AuthorizationModule {}
