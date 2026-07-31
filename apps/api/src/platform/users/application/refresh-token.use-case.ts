import { Injectable } from '@nestjs/common';

import { DomainError } from '../../../core/common/errors.js';
import { JwtTokenService } from '../../../core/auth/jwt-token.service.js';
import { AUTH_INVALID_REFRESH_TOKEN, AUTH_SESSION_REVOKED, AUTH_EXPIRED_REFRESH_TOKEN } from '../domain/errors.js';

/**
 * Input for refreshing an access token.
 */
export interface RefreshTokenInput {
  refreshToken: string;
  device?: string;
  ip?: string;
}

/**
 * Result of a successful token refresh.
 */
export interface RefreshTokenOutput {
  accessToken: string;
  refreshToken: string;
}

/**
 * RefreshTokenUseCase — wraps JwtTokenService.refreshAccessToken with domain error mapping.
 *
 * Business rules:
 * - AUTH-4: Refresh tokens are single-use with rotation
 * - AUTH-4: Reuse detection revokes the entire session family
 */
@Injectable()
export class RefreshTokenUseCase {
  constructor(
    private readonly jwtTokenService: JwtTokenService,
  ) {}

  async execute(input: RefreshTokenInput): Promise<RefreshTokenOutput> {
    try {
      const result = await this.jwtTokenService.refreshAccessToken(
        input.refreshToken,
        input.device,
        input.ip,
      );

      return {
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown';

      switch (message) {
        case 'AUTH_SESSION_REVOKED':
          throw new DomainError(AUTH_SESSION_REVOKED, 'Session revoked due to token reuse');
        case 'AUTH_EXPIRED_REFRESH_TOKEN':
          throw new DomainError(AUTH_EXPIRED_REFRESH_TOKEN, 'Refresh token has expired');
        default:
          throw new DomainError(AUTH_INVALID_REFRESH_TOKEN, 'Invalid refresh token');
      }
    }
  }
}
