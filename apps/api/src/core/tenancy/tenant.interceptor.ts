import { type CallHandler, type ExecutionContext, Injectable, type NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';

import { TENANCY_METADATA } from './system-context.decorator.js';
import { TenantContext, type TenantContextData } from './tenant-context.js';

/**
 * Authenticated user payload attached to the request by the JWT auth guard.
 *
 * The shape of this interface mirrors what the JWT token service (Phase 1.3)
 * will embed in the access token and decode during verification.
 *
 * @see ARCHITECTURE.md §5 — Request lifecycle (steps 3-4)
 */
export interface AuthenticatedUser {
  /** User's unique identifier */
  sub: string;
  /** Session ID the access token was issued for */
  sessionId?: string;
  /** Active organization ID */
  organizationId?: string;
  /** User's email address */
  email?: string;
  /** User's role keys in the active organization */
  roles?: string[];
  /** Effective permission keys */
  permissions?: string[];
  /** Resolved locale */
  locale?: string;
}

/**
 * TenantInterceptor — extracts tenant context from the authenticated request
 * and binds it into TenantContext (AsyncLocalStorage) for the duration of
 * the request handler.
 *
 * This is a global interceptor (registered via APP_INTERCEPTOR) that runs
 * AFTER guards (JwtAuthGuard, etc.). This ordering is critical because:
 *   - Guards verify the JWT and set `request.user`
 *   - This interceptor reads `request.user` to extract tenant data
 *   - Route handlers access tenant data via TenantContext static getters
 *
 * For @PublicRoute() and @SystemContext() routes, this interceptor
 * checks the route handler metadata via Reflector and skips tenant setup.
 *
 * @see ARCHITECTURE.md §5 — Request lifecycle
 * @see DATA_MODEL.md §2 — Per-request binding
 */
@Injectable()
export class TenantInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    // Check if this route is marked as public (no auth, no tenant)
    const isPublic = this.reflector.getAllAndOverride<boolean>(TENANCY_METADATA.IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return next.handle();
    }

    // Check if this route is marked as system context (auth optional, no tenant)
    const isSystemContext = this.reflector.getAllAndOverride<boolean>(TENANCY_METADATA.IS_SYSTEM_CONTEXT, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isSystemContext) {
      // System context: auth optional, no tenant context required
      return next.handle();
    }

    // Extract user from the request (set by JwtAuthGuard in Phase 1.3)
    /* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
    const request = context.switchToHttp().getRequest();
    const user = request.user as AuthenticatedUser | undefined;
    /* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */

    if (!user) {
      // No user: let it pass (the JWT guard will reject if auth is required)
      return next.handle();
    }

    // Resolve locale
    const locale = user.locale ?? 'en';

    // Build the tenant context data
    const tenantData: TenantContextData = {
      userId: user.sub,
      sessionId: user.sessionId,
      organizationId: user.organizationId,
      roles: user.roles ?? [],
      permissions: user.permissions ?? [],
      locale,
    };

    // Wrap the handler in TenantContext scope.
    // Uses Observable subscriber pattern to forward inner events.
    // TenantContext.run expects an async callback, so we wrap the subscribe in a Promise.
    return new Observable((subscriber) => {
      void TenantContext.run(tenantData, async () => {
        return new Promise<void>((resolve) => {
          next.handle().subscribe({
            next: (value: unknown) => subscriber.next(value),
            error: (err: unknown) => {
              subscriber.error(err);
              resolve();
            },
            complete: () => {
              subscriber.complete();
              resolve();
            },
          });
        });
      });
    });
  }
}
