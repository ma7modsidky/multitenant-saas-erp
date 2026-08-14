import { SetMetadata } from '@nestjs/common';

/**
 * Metadata key marking a route as platform-admin only (PLT-2).
 */
export const PLATFORM_ADMIN_KEY = 'authorization:isPlatformAdmin';

/**
 * @RequiresPlatformAdmin() — declares that a route may only be invoked by a
 * platform admin (superuser), enforced by the global PlatformAdminGuard.
 *
 * Admin routes are ordinary authenticated routes — never @PublicRoute() or
 * @SystemContext() — so JwtAuthGuard still 401s unauthenticated callers and
 * TenantInterceptor still binds TenantContext; this decorator only adds the
 * isPlatformAdmin claim check (403 PLATFORM_ADMIN_REQUIRED otherwise).
 *
 * @see docs/ARCHITECTURE.md §8 — Platform Admin Console
 * @see docs/BUSINESS_RULES.md — PLT-1/PLT-2
 */
export const RequiresPlatformAdmin = (): MethodDecorator & ClassDecorator => SetMetadata(PLATFORM_ADMIN_KEY, true);
