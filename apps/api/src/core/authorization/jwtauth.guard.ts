import { type ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import type { Observable } from 'rxjs';

import { TENANCY_METADATA } from '../tenancy/system-context.decorator.js';

/**
 * JwtAuthGuard — NestJS authentication guard using the JwtAccessStrategy.
 *
 * This guard:
 *   1. Checks if the route is marked @PublicRoute() — if so, skips auth
 *   2. Checks if the route is marked @SystemContext() — if so, allows
 *      optional auth (doesn't throw if no token is present)
 *   3. Otherwise, validates the Bearer token via passport-jwt strategy
 *      and attaches the decoded user to `request.user`
 *
 * The guard MUST run before TenantInterceptor, which reads `request.user`.
 *
 * @see ARCHITECTURE.md §5 — Request lifecycle (step 3: JwtAuthGuard)
 * @see AUTH-4 — Access tokens expire in 15 minutes
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  /**
   * Determine whether the current request is authenticated.
   *
   * @param context - The execution context
   * @returns True if the request is allowed, throws UnauthorizedException otherwise
   */
  override canActivate(
    context: ExecutionContext,
  ): boolean | Promise<boolean> | Observable<boolean> {
    // Check if the route is marked as public (no auth required)
    const isPublic = this.reflector.getAllAndOverride<boolean>(
      TENANCY_METADATA.IS_PUBLIC,
      [context.getHandler(), context.getClass()],
    );

    if (isPublic) {
      return true;
    }

    return super.canActivate(context);
  }

  /**
   * Custom error handling for authentication failures.
   *
   * For @SystemContext routes, auth failure is tolerated (the user is simply
   * not authenticated). The TenantInterceptor will handle the missing user.
   */
  override handleRequest<TUser = unknown>(
    err: Error | null,
    user: TUser | false,
    _info: { message?: string },
    context: ExecutionContext,
  ): TUser | null {
    const isSystemContext = this.reflector.getAllAndOverride<boolean>(
      TENANCY_METADATA.IS_SYSTEM_CONTEXT,
      [context.getHandler(), context.getClass()],
    );

    // For system-context routes, return null instead of throwing
    if (isSystemContext && (err || !user)) {
      return null as unknown as TUser;
    }

    // For authenticated routes, throw on invalid/missing tokens
    if (err || !user) {
      throw err ?? new UnauthorizedException('AUTH_INVALID_TOKEN');
    }

    return user;
  }
}
