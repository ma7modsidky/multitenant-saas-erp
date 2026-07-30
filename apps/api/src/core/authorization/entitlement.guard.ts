import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { EntitlementService } from '../entitlements/entitlement.service.js';
import { REQUIRED_MODULE_KEY } from './module.decorator.js';

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
 * EntitlementGuard — checks whether the active organization is entitled to
 * the module required by a route handler.
 *
 * This guard implements AUTHZ-6: entitlement is checked BEFORE permission.
 * An unentitled module returns `403 MODULE_NOT_ENTITLED` even for an OWNER.
 *
 * IMPORTANT: Guards run BEFORE interceptors in NestJS. This guard reads
 * organizationId from `request.user` (set by JwtAuthGuard) rather than from
 * TenantContext (set by TenantInterceptor), because TenantContext is not
 * available yet when guards execute.
 *
 * The guard delegates to EntitlementService.isEntitled(), which checks
 * the organization's entitlement state in the entitlement store.
 *
 * This replaces the Phase 1.4 simplified check (permission prefix matching)
 * with a proper entitlement check against core_module_entitlements.
 *
 * @see AUTHZ-6 — Entitlement is checked before permission
 * @see ARCHITECTURE.md §5 — Request lifecycle (step: EntitlementGuard)
 * @see BILL-4 — core_module_entitlements is the runtime authority
 */
@Injectable()
export class EntitlementGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly entitlementService: EntitlementService,
  ) {}

  /**
   * Check if the active organization is entitled to the required module.
   *
   * @param context - The execution context
   * @returns True if entitled, throws ForbiddenException otherwise
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Read @RequiresModule() metadata
    const requiredModule = this.reflector.getAllAndOverride<string>(
      REQUIRED_MODULE_KEY,
      [context.getHandler(), context.getClass()],
    );

    // No module requirement — always allowed
    if (!requiredModule) {
      return true;
    }

    // Extract the user from request.user (set by JwtAuthGuard).
    // We read from request.user rather than TenantContext because guards
    // run before interceptors in NestJS, so TenantContext is not yet set.
    const request = context.switchToHttp().getRequest();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const user = request.user as AuthenticatedUser | undefined;

    // No authenticated user — let it pass (JwtAuthGuard will reject upstream
    // if auth is required; @PublicRoute() routes shouldn't have @RequiresModule)
    if (!user) {
      return true;
    }

    // No org context — system user can't be entitled to a tenant module
    if (!user.organizationId) {
      throw new ForbiddenException('MODULE_NOT_ENTITLED');
    }

    // Delegate to EntitlementService for the actual entitlement check
    const isEntitled = await this.entitlementService.isEntitled(
      user.organizationId,
      requiredModule,
    );

    if (!isEntitled) {
      throw new ForbiddenException('MODULE_NOT_ENTITLED');
    }

    return true;
  }
}
