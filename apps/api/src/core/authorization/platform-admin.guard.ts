import { type CanActivate, type ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { PLATFORM_ADMIN_KEY } from './platform-admin.decorator.js';

/**
 * Authenticated user interface matching what JwtAuthGuard attaches
 * to request.user after successful token validation.
 */
interface AuthenticatedUser {
  sub: string;
  isPlatformAdmin?: boolean;
}

/**
 * PlatformAdminGuard — enforces @RequiresPlatformAdmin() (PLT-2).
 *
 * Runs AFTER JwtAuthGuard (4th global guard), so request.user is set for
 * authenticated callers. For routes without the decorator it is a no-op.
 *
 * Admin routes are ordinary authenticated routes (never @PublicRoute() /
 * @SystemContext()), so an unauthenticated caller is rejected by JwtAuthGuard
 * with 401 before this guard runs; an authenticated non-admin reaches this
 * guard and is rejected with 403 PLATFORM_ADMIN_REQUIRED.
 *
 * @see docs/ARCHITECTURE.md §8 — Platform Admin Console
 * @see docs/BUSINESS_RULES.md — PLT-1/PLT-2
 */
@Injectable()
export class PlatformAdminGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // Read @RequiresPlatformAdmin() metadata
    const required = this.reflector.getAllAndOverride<boolean>(PLATFORM_ADMIN_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!required) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const user = request.user as AuthenticatedUser | undefined;

    // No authenticated user — let JwtAuthGuard reject upstream (admin routes
    // are never public/system-context, so auth is always enforced).
    if (!user) {
      return true;
    }

    if (user.isPlatformAdmin !== true) {
      throw new ForbiddenException('PLATFORM_ADMIN_REQUIRED');
    }

    return true;
  }
}
