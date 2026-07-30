import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { createAbility, type AppActions, type AppSubjects } from './ability.factory.js';
import { REQUIRED_PERMISSIONS_KEY } from './permission.decorator.js';

/**
 * Authenticated user interface matching what JwtAuthGuard attaches
 * to request.user after successful token validation.
 *
 * Defined here locally to avoid a dependency on the tenant interceptor.
 */
interface AuthenticatedUser {
  sub: string;
  organizationId?: string;
  permissions?: string[];
  roles?: string[];
}

/**
 * PermissionGuard — checks @RequiresPermission() using CASL abilities.
 *
 * This guard implements AUTHZ-5: permission checks are declarative via
 * the @RequiresPermission decorator. Ad-hoc role comparisons in service
 * code are forbidden.
 *
 * IMPORTANT: Guards run BEFORE interceptors in NestJS. This guard reads
 * permissions from `request.user` (set by JwtAuthGuard) rather than from
 * TenantContext (set by TenantInterceptor), because TenantContext is not
 * available yet when guards execute.
 *
 * The guard runs AFTER the EntitlementGuard (AUTHZ-6), so module
 * entitlement is already checked by the time this guard runs.
 *
 * @see AUTHZ-5 — Permission checks are declarative via @RequiresPermission
 * @see ARCHITECTURE.md §5 — Request lifecycle (step: PermissionGuard)
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  /**
   * Check if the authenticated user has all required permissions.
   *
   * @param context - The execution context
   * @returns True if all permissions are satisfied, throws ForbiddenException otherwise
   */
  canActivate(context: ExecutionContext): boolean {
    // Read @RequiresPermission() metadata
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(
      REQUIRED_PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    // No permission requirement — always allowed
    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true;
    }

    // Extract the user from request.user (set by JwtAuthGuard).
    // We read from request.user rather than TenantContext because guards
    // run before interceptors in NestJS, so TenantContext is not yet set.
    const request = context.switchToHttp().getRequest();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const user = request.user as AuthenticatedUser | undefined;

    if (!user) {
      // Not authenticated — let JwtAuthGuard handle the rejection
      return true;
    }

    const userPermissions = user.permissions ?? [];

    // Build a CASL ability from the user's permissions
    const ability = createAbility(userPermissions);

    // Check each required permission against the ability
    for (const permission of requiredPermissions) {
      const parts = permission.split(':');

      if (parts.length < 3) {
        // Invalid permission format, reject
        throw new ForbiddenException('FORBIDDEN');
      }

      const action = parts[2] as AppActions;
      const subject = `${parts[0]}:${parts[1]}` as AppSubjects;

      if (!ability.can(action, subject)) {
        throw new ForbiddenException('FORBIDDEN');
      }
    }

    return true;
  }
}
