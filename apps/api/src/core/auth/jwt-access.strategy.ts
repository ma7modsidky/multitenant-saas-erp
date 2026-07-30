import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

import { ConfigService } from '@modubiz/config';

/**
 * Payload expected in a valid access token.
 * This matches what JwtTokenService.generateAccessToken() produces.
 *
 * Properties use `string | undefined` (not optional `?`) to be compatible
 * with `exactOptionalPropertyTypes: true` in tsconfig.
 */
interface JwtAccessPayload {
  sub: string;
  email: string;
  organizationId: string | undefined;
  roles: string[];
  permissions: string[];
}

/**
 * Authenticated user object attached to `request.user` after successful
 * access token validation.
 */
export interface AuthenticatedUser {
  sub: string;
  email: string;
  organizationId: string | undefined;
  roles: string[];
  permissions: string[];
  locale: string;
}

/**
 * JwtAccessStrategy — validates Bearer access tokens using passport-jwt.
 *
 * This strategy:
 *   1. Extracts the JWT from the `Authorization: Bearer <token>` header
 *   2. Verifies the signature using JWT_ACCESS_SECRET
 *   3. Calls validate() with the decoded payload
 *   4. Attaches the returned user object to `request.user`
 *
 * The validated user is then consumed by TenantInterceptor to populate
 * TenantContext (AsyncLocalStorage) for the rest of the request lifecycle.
 *
 * @see AUTH-4 — Access tokens expire in 15 minutes
 * @see ARCHITECTURE.md §5 — Request lifecycle (step 3: JwtAuthGuard)
 */
@Injectable()
export class JwtAccessStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: config.jwtAccessSecret,
      ignoreExpiration: false,
    });
  }

  /**
   * Validate the decoded JWT payload.
   *
   * Passport calls this after signature verification succeeds.
   * The returned value is attached to `request.user`.
   *
   * @param payload - Decoded JWT payload from a valid access token
   * @returns AuthenticatedUser — the user object for the request
   * @throws UnauthorizedException if the payload is missing required fields
   */
  async validate(payload: JwtAccessPayload): Promise<AuthenticatedUser> {
    if (!payload.sub) {
      throw new UnauthorizedException('AUTH_INVALID_TOKEN_PAYLOAD');
    }

    return {
      sub: payload.sub,
      email: payload.email ?? '',
      organizationId: payload.organizationId ?? undefined,
      roles: payload.roles ?? [],
      permissions: payload.permissions ?? [],
      locale: 'en', // Resolved by TenantInterceptor from headers
    };
  }
}
