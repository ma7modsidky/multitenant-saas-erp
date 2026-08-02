import { randomUUID } from 'node:crypto';
import * as crypto from 'node:crypto';

import { ConfigService } from '@modubiz/config';
import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

import { type SessionStore, type Session } from './session-store.interface.js';

/**
 * Payload embedded in access tokens.
 */
export interface JwtAccessPayload {
  sub: string;
  email: string;
  /** Session ID the token was issued for (AUTH-5 current-session marking) */
  sessionId: string | undefined;
  organizationId: string | undefined;
  roles: string[];
  permissions: string[];
}

/**
 * Payload embedded in refresh tokens.
 */
export interface JwtRefreshPayload {
  sub: string;
  sessionId: string;
  tokenFamily: string;
}

/**
 * Result of a successful token refresh operation.
 */
export interface TokenRefreshResult {
  accessToken: string;
  refreshToken: string;
  session: Session;
}

/**
 * JwtTokenService — handles JWT access and refresh token lifecycle.
 *
 * Access tokens:
 *   - Short-lived (default 15 min, configurable via JWT_ACCESS_TTL)
 *   - Signed with JWT_ACCESS_SECRET
 *   - Contain user identity, org context, roles, and permissions
 *   - Validated by JwtAccessStrategy on every authenticated request
 *
 * Refresh tokens:
 *   - Long-lived (default 30 days, configurable via JWT_REFRESH_TTL)
 *   - Generated as opaque tokens (UUID), stored as SHA-256 hash
 *   - Single-use with rotation (AUTH-4)
 *
 * Token rotation (AUTH-4):
 *   Each refresh token belongs to a "token family". On rotation:
 *   1. The presented refresh token is hashed and looked up in the session store
 *   2. The old token hash is compared against the session's current hash
 *      - If they match: normal rotation (issue new tokens)
 *      - If they don't match: reuse detected (revoke entire family)
 *   3. A new refresh token is issued and the session hash is updated
 *   4. The old hash is KEPT in the index for future reuse detection
 *
 * @see AUTH-4 — Refresh token rotation and reuse detection
 * @see AUTH-5 — Session management and revocation
 */
@Injectable()
export class JwtTokenService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    @Inject('SESSION_STORE')
    private readonly sessionStore: SessionStore,
  ) {}

  /**
   * Generate an access token for a user.
   *
   * @param payload - The JWT access payload
   * @returns Signed access token string
   */
  async generateAccessToken(payload: JwtAccessPayload): Promise<string> {
    return this.jwtService.signAsync(
      { ...payload },
      {
        secret: this.config.jwtAccessSecret,
        expiresIn: this.config.jwtAccessTtl,
      },
    );
  }

  /**
   * Generate a refresh token and create a new session.
   *
   * @param userId - The user ID
   * @param device - Optional device identifier
   * @param ip - Optional IP address
   * @returns The refresh token string and session info
   */
  async generateRefreshToken(
    userId: string,
    device?: string,
    ip?: string,
    claims?: { organizationId?: string; roles?: string[]; permissions?: string[] },
  ): Promise<{ refreshToken: string; session: Session }> {
    const sessionId = randomUUID();
    const tokenFamily = randomUUID();
    const refreshToken = randomUUID() + '-' + randomUUID();
    const refreshTokenHash = this.hashToken(refreshToken);

    const expiresAt = new Date(Date.now() + this.parseTtl(this.config.jwtRefreshTtl)).toISOString();

    const session: Session = {
      id: sessionId,
      userId,
      tokenFamily,
      refreshTokenHash,
      previousRefreshTokenHash: null,
      device: device ?? undefined,
      ip: ip ?? undefined,
      expiresAt,
      createdAt: new Date().toISOString(),
      revokedAt: null,
      revokeReason: null,
      ...claims,
    };

    await this.sessionStore.create(session);

    return { refreshToken, session };
  }

  /**
   * Validate a refresh token's JWT payload.
   *
   * Decodes and verifies a JWT refresh token using JWT_REFRESH_SECRET.
   * This is used by the refresh endpoint to extract session info from
   * a JWT-format refresh token (if JWT mode is used).
   *
   * For opaque token mode, use refreshAccessToken() directly.
   *
   * @param refreshToken - The raw JWT refresh token string
   * @returns Decoded and verified payload
   */
  async verifyRefreshTokenJwt(refreshToken: string): Promise<JwtRefreshPayload> {
    const payload = await this.jwtService.verifyAsync<JwtRefreshPayload>(refreshToken, {
      secret: this.config.jwtRefreshSecret,
    });

    if (!payload.sub || !payload.sessionId || !payload.tokenFamily) {
      throw new Error('AUTH_INVALID_REFRESH_TOKEN_PAYLOAD');
    }

    return payload;
  }

  /**
   * Refresh an access token using a refresh token (rotation).
   *
   * This implements AUTH-4 token rotation with reuse detection:
   *   - The refresh token is hashed and looked up in the session store
   *   - If found and the hash matches the session's current hash:
   *     normal rotation (old hash kept as "previous" in index)
   *   - If found but the hash does NOT match the session's current hash:
   *     reuse detected — the entire token family is revoked
   *   - If not found at all: token is invalid
   *
   * @param refreshToken - The refresh token to rotate
   * @param device - Optional device identifier
   * @param ip - Optional IP address
   * @returns New access and refresh tokens
   * @throws Error if token is invalid, expired, or reused
   */
  async refreshAccessToken(refreshToken: string, device?: string, ip?: string): Promise<TokenRefreshResult> {
    const tokenHash = this.hashToken(refreshToken);
    const session = await this.sessionStore.findByRefreshTokenHash(tokenHash);

    if (!session) {
      throw new Error('AUTH_INVALID_REFRESH_TOKEN');
    }

    // REUSE DETECTION: If the presented token's hash doesn't match the
    // session's current hash, it means this token was rotated and is now
    // being reused — a classic sign of token theft (AUTH-4).
    if (session.refreshTokenHash !== tokenHash) {
      await this.sessionStore.revokeFamily(session.tokenFamily, 'TOKEN_REUSE');
      throw new Error('AUTH_SESSION_REVOKED');
    }

    if (session.revokedAt) {
      throw new Error('AUTH_INVALID_REFRESH_TOKEN');
    }

    if (new Date(session.expiresAt) < new Date()) {
      throw new Error('AUTH_EXPIRED_REFRESH_TOKEN');
    }

    // Generate new tokens and rotate
    const newRefreshToken = randomUUID() + '-' + randomUUID();
    const newRefreshTokenHash = this.hashToken(newRefreshToken);

    // Update the session with the new hash (old hash stays in index)
    await this.sessionStore.updateRefreshTokenHash(session.id, newRefreshTokenHash);

    // Generate a new access token. The session records the organization it was
    // created for (switch-org, TEN-4) plus its roles/permissions (AUTHZ-5), so
    // a refresh KEEPS the same org + authz claims instead of resetting them to
    // empty — an empty claims set would 403 every guarded endpoint after the
    // 15-minute access-token expiry. Sessions created before the user has an
    // organization (signup/login) carry no org and stay unauthenticated.
    const accessToken = await this.generateAccessToken({
      sub: session.userId,
      email: '',
      sessionId: session.id,
      organizationId: session.organizationId,
      roles: session.roles ?? [],
      permissions: session.permissions ?? [],
    });

    return {
      accessToken,
      refreshToken: newRefreshToken,
      session: {
        ...session,
        refreshTokenHash: newRefreshTokenHash,
      },
    };
  }

  /**
   * Handle suspected token theft (AUTH-4).
   * Called when a rotated (already-used) refresh token is presented.
   * Revokes the entire token family.
   *
   * Note: With the current reuse detection approach (keeping old hashes
   * in the index), refreshAccessToken() itself detects and handles
   * reuse. This method is kept for backward compatibility and for
   * cases where reuse is detected through other means.
   */
  async handleTokenReuse(refreshToken: string): Promise<void> {
    const tokenHash = this.hashToken(refreshToken);
    const session = await this.sessionStore.findByRefreshTokenHash(tokenHash);

    if (!session) return;

    // Revoke the entire family to lock out the attacker (and force re-auth)
    await this.sessionStore.revokeFamily(session.tokenFamily, 'TOKEN_REUSE');
  }

  /**
   * Revoke a specific session.
   */
  async revokeSession(sessionId: string, reason?: string): Promise<void> {
    await this.sessionStore.revoke(sessionId, reason);
  }

  /**
   * Revoke all sessions for a user (e.g., on password change, AUTH-6).
   */
  async revokeAllUserSessions(userId: string, reason?: string): Promise<void> {
    await this.sessionStore.revokeAllForUser(userId, reason);
  }

  /**
   * List all active sessions for a user.
   */
  async listSessions(userId: string): Promise<Session[]> {
    const sessions = await this.sessionStore.findByUserId(userId);
    return sessions.filter((s) => !s.revokedAt);
  }

  /**
   * Hash a refresh token for storage (SHA-256).
   * The raw token is never stored — only its hash.
   */
  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  /**
   * Parse a TTL string like '15m', '30d', '7d' into milliseconds.
   */
  private parseTtl(ttl: string): number {
    if (!ttl) {
      return 30 * 24 * 60 * 60 * 1000;
    }

    const match = ttl.match(/^(\d+)([smhd])$/);
    if (!match) {
      // Default to 30 days if unparseable
      return 30 * 24 * 60 * 60 * 1000;
    }

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const value = parseInt(match[1]!, 10);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const unit = match[2]!;

    switch (unit) {
      case 's':
        return value * 1000;
      case 'm':
        return value * 60 * 1000;
      case 'h':
        return value * 60 * 60 * 1000;
      case 'd':
        return value * 24 * 60 * 60 * 1000;
      default:
        return 30 * 24 * 60 * 60 * 1000;
    }
  }
}
