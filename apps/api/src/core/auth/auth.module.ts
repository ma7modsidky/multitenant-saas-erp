import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';

import { ConfigService } from '@modubiz/config';

import { JwtAccessStrategy } from './jwt-access.strategy.js';
import { JwtTokenService } from './jwt-token.service.js';
import { PasswordService } from './password.service.js';
import { InMemorySessionStore } from './session-store.js';

/**
 * AuthModule — the authentication and session infrastructure module.
 *
 * Provides:
 *   - PasswordService: argon2id hashing and verification (AUTH-2)
 *   - JwtTokenService: access/refresh token lifecycle with rotation (AUTH-4)
 *   - JwtAccessStrategy: Passport strategy for Bearer token validation
 *   - InMemorySessionStore (as SESSION_STORE): session persistence (AUTH-5)
 *   - ConfigService: Zod-validated environment configuration
 *
 * Guards are NOT registered here. They are provided at the controller or
 * module level where they are needed:
 *   - JwtAuthGuard: protects authenticated routes (uses JwtAccessStrategy)
 *   - OptionalJwtAuthGuard: used for system-context routes
 *
 * Note on refresh token strategy:
 *   Refresh tokens are opaque (UUID-based), not JWTs. There is no
 *   Passport strategy for refresh tokens. The refresh endpoint directly
 *   calls JwtTokenService.refreshAccessToken() for validation and rotation,
 *   or uses JwtTokenService.verifyRefreshTokenJwt() for JWT-format tokens.
 *
 * @see AUTH-2 — Password hashing with argon2id
 * @see AUTH-4 — Access token expiry, refresh token rotation
 * @see AUTH-5 — Session storage, listing, and revocation
 * @see ARCHITECTURE.md §3 — core/auth
 */
@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.jwtAccessSecret,
        signOptions: { expiresIn: config.jwtAccessTtl },
      }),
    }),
  ],
  providers: [
    // ConfigService — Zod-validated env config
    {
      provide: ConfigService,
      useFactory: () => new ConfigService(),
    },
    PasswordService,
    JwtTokenService,
    JwtAccessStrategy,
    {
      provide: 'SESSION_STORE',
      useClass: InMemorySessionStore,
    },
  ],
  exports: [PasswordService, JwtTokenService, JwtAccessStrategy, 'SESSION_STORE'],
})
export class AuthModule {}
