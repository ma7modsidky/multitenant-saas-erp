import { SetMetadata } from '@nestjs/common';

/**
 * Metadata keys for system-context route decorators.
 * Used by the TenantMiddleware to decide whether to set tenant context.
 */
export const TENANCY_METADATA = {
  /** Route requires neither auth nor tenant context (signup, login, webhooks) */
  IS_PUBLIC: 'tenancy:isPublic',
  /** Route may run without tenant context (auth is optional) */
  IS_SYSTEM_CONTEXT: 'tenancy:isSystemContext',
} as const;

/**
 * @PublicRoute() decorator.
 *
 * Marks a route as publicly accessible without authentication or tenant context.
 * No JWT verification is performed, and no TenantContext is set.
 *
 * Use for:
 *   - Signup, login, email verification, password reset
 *   - Stripe webhooks (signature verification replaces auth)
 *   - Health checks, readiness probes
 *   - Public module catalog
 *
 * @see ARCHITECTURE.md §5 — System-context routes
 *
 * @example
 * ```typescript
 * @PublicRoute()
 * @Post('auth/login')
 * async login(@Body() dto: LoginDto) { ... }
 * ```
 */
export const PublicRoute = () => SetMetadata(TENANCY_METADATA.IS_PUBLIC, true);

/**
 * @SystemContext() decorator.
 *
 * Marks a route that may run without tenant context but still allows auth.
 * The JWT guard runs normally, but the tenant middleware skips TenantContext setup.
 *
 * Use for:
 *   - Token refresh (may work with or without active org)
 *   - Module catalog (works without auth but shows more with it)
 *
 * @see ARCHITECTURE.md §5 — System-context routes
 *
 * @example
 * ```typescript
 * @SystemContext()
 * @Post('auth/refresh')
 * async refresh(@Body() dto: RefreshDto) { ... }
 * ```
 */
export const SystemContext = () => SetMetadata(TENANCY_METADATA.IS_SYSTEM_CONTEXT, true);
