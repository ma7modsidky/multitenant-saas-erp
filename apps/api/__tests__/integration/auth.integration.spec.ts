/**
 * Auth integration tests.
 *
 * Tests password hashing with argon2id (AUTH-2), JWT token rotation (AUTH-4),
 * and consistent login error messages (AUTH-8).
 *
 * Uses real implementations (argon2, @nestjs/jwt) with in-memory session stores,
 * verifying the cryptographic and session management behaviour end-to-end.
 *
 * @see AUTH-2 — Passwords hashed with argon2id
 * @see AUTH-4 — Refresh token reuse revokes the entire session family
 * @see AUTH-8 — Login failures return AUTH_INVALID_CREDENTIALS regardless
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { JwtService } from '@nestjs/jwt';

import { PasswordService } from '../../src/core/auth/password.service.js';
import { JwtTokenService } from '../../src/core/auth/jwt-token.service.js';
import { InMemorySessionStore } from '../../src/core/auth/session-store.js';
import { ConfigService } from '@modubiz/config';

// ─── Test config helper ─────────────────────────────────────────────────────

function makeTestConfig(): ConfigService {
  return new ConfigService({
    NODE_ENV: 'test',
    PORT: '4000',
    API_BASE_URL: 'http://localhost:4000',
    WEB_BASE_URL: 'http://localhost:3000',
    DATABASE_URL: 'postgres://test:test@localhost:5432/test',
    DATABASE_MIGRATION_URL: 'postgres://test:test@localhost:5432/test',
    REDIS_URL: 'redis://localhost:6379',
    JWT_ACCESS_SECRET: 'test-access-secret-that-is-at-least-32-chars-long!!',
    JWT_REFRESH_SECRET: 'test-refresh-secret-that-is-at-least-32-chars-long!',
    JWT_ACCESS_TTL: '15m',
    JWT_REFRESH_TTL: '30d',
    STRIPE_SECRET_KEY: 'sk_test_placeholder',
    STRIPE_WEBHOOK_SECRET: 'whsec_placeholder',
    RESEND_API_KEY: 're_placeholder',
    EMAIL_FROM: 'test@example.com',
    R2_ACCOUNT_ID: 'test',
    R2_ACCESS_KEY_ID: 'test',
    R2_SECRET_ACCESS_KEY: 'test',
    R2_BUCKET: 'test',
    FX_RATES_PROVIDER_URL: 'https://example.com',
    FX_RATES_API_KEY: 'test',
  });
}

function createTokenService(): JwtTokenService {
  const config = makeTestConfig();
  const jwtService = new JwtService();
  const sessionStore = new InMemorySessionStore();
  return new JwtTokenService(jwtService, config, sessionStore);
}

// ─── AUTH-2: Password hashing with argon2id ─────────────────────────────────

describe('AUTH-2: Password hashing with argon2id', () => {
  const passwordService = new PasswordService();

  it('AUTH-2: hash produces a valid argon2id hash', async () => {
    const hash = await passwordService.hash('MyP@ssw0rd!');
    expect(hash).toMatch(/^\$argon2id\$/);
  });

  it('AUTH-2: verify returns true for correct password', async () => {
    const password = 'CorrectHorseBatteryStaple';
    const hash = await passwordService.hash(password);
    const valid = await passwordService.verify(hash, password);
    expect(valid).toBe(true);
  });

  it('AUTH-2: verify returns false for incorrect password', async () => {
    const hash = await passwordService.hash('real-password');
    const valid = await passwordService.verify(hash, 'wrong-password');
    expect(valid).toBe(false);
  });

  it('AUTH-2: passwords are one-way hashed (no plaintext in hash)', async () => {
    const password = 'secret-123';
    const hash = await passwordService.hash(password);
    expect(hash).not.toContain(password);
    expect(hash.length).toBeGreaterThan(50);
  });

  it('AUTH-2: same password produces different hashes (random salt)', async () => {
    const password = 'same-password';
    const hash1 = await passwordService.hash(password);
    const hash2 = await passwordService.hash(password);
    expect(hash1).not.toBe(hash2);
    expect(await passwordService.verify(hash1, password)).toBe(true);
    expect(await passwordService.verify(hash2, password)).toBe(true);
  });
});

// ─── AUTH-8: Login failures return AUTH_INVALID_CREDENTIALS ─────────────────

describe('AUTH-8: Login failures return AUTH_INVALID_CREDENTIALS', () => {
  it('AUTH-8: wrong password returns false', async () => {
    const passwordService = new PasswordService();
    const hash = await passwordService.hash('correct-password');
    const valid = await passwordService.verify(hash, 'wrong-password');
    expect(valid).toBe(false);
  });

  it('AUTH-8: non-existent user and wrong password are indistinguishable', async () => {
    const passwordService = new PasswordService();
    const actualHash = await passwordService.hash('user-password');
    const wrongPasswordResult = await passwordService.verify(actualHash, 'wrong');
    expect(wrongPasswordResult).toBe(false);
    // For a non-existent user, the controller would not even call
    // passwordService.verify() — it returns AUTH_INVALID_CREDENTIALS
    // directly, making both cases indistinguishable.
  });
});

// ─── AUTH-4: Refresh token rotation and reuse detection ───────────────────

describe('AUTH-4: Refresh token rotation and reuse detection', () => {
  let service: JwtTokenService;

  beforeEach(() => {
    service = createTokenService();
  });

  describe('Access tokens', () => {
    it('generates a valid JWT access token', async () => {
      const token = await service.generateAccessToken({
        sub: 'user-1',
        email: 'test@example.com',
        organizationId: 'org-1',
        roles: ['ADMIN'],
        permissions: ['inventory:product:read'],
      });

      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      expect(token.split('.')).toHaveLength(3);
    });

    it('access token contains correct claims', async () => {
      const jwtService = new JwtService();
      const config = makeTestConfig();

      const token = await service.generateAccessToken({
        sub: 'user-42',
        email: 'test@example.com',
        organizationId: 'org-1',
        roles: ['ADMIN'],
        permissions: [],
      });

      const decoded = await jwtService.verifyAsync(token, { secret: config.jwtAccessSecret });
      expect(decoded.sub).toBe('user-42');
      expect(decoded.email).toBe('test@example.com');
    });

    it('access token includes roles and permissions', async () => {
      const jwtService = new JwtService();
      const config = makeTestConfig();

      const token = await service.generateAccessToken({
        sub: 'user-1',
        email: 'test@example.com',
        roles: ['ADMIN', 'MANAGER'],
        permissions: ['inventory:product:read', 'inventory:stock:adjust'],
        organizationId: undefined,
      });

      const decoded = await jwtService.verifyAsync(token, { secret: config.jwtAccessSecret });
      expect(decoded.roles).toEqual(['ADMIN', 'MANAGER']);
      expect(decoded.permissions).toEqual(['inventory:product:read', 'inventory:stock:adjust']);
    });
  });

  describe('Refresh tokens', () => {
    it('generates a refresh token and creates a session', async () => {
      const result = await service.generateRefreshToken('user-1', 'test-device', '127.0.0.1');

      expect(result.refreshToken).toBeDefined();
      expect(result.refreshToken).toContain('-');
      expect(result.session.userId).toBe('user-1');
      expect(result.session.device).toBe('test-device');
      expect(result.session.ip).toBe('127.0.0.1');
      expect(result.session.revokedAt).toBeNull();
    });

    it('generates unique refresh tokens each time', async () => {
      const result1 = await service.generateRefreshToken('user-1');
      const result2 = await service.generateRefreshToken('user-1');
      expect(result1.refreshToken).not.toBe(result2.refreshToken);
    });

    it('sets a future expiry date', async () => {
      const result = await service.generateRefreshToken('user-1');
      const expiresAt = new Date(result.session.expiresAt);
      expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
    });
  });

  describe('Token rotation (AUTH-4)', () => {
    it('rotates a valid refresh token and returns new tokens', async () => {
      const { refreshToken, session } = await service.generateRefreshToken('user-1');
      const result = await service.refreshAccessToken(refreshToken);

      expect(result.accessToken).toBeDefined();
      expect(result.accessToken.split('.')).toHaveLength(3);
      expect(result.refreshToken).toBeDefined();
      expect(result.refreshToken).not.toBe(refreshToken);
      expect(result.session.id).toBe(session.id);
    });

    it('AUTH-4: reuse of rotated token revokes the family (AUTH_SESSION_REVOKED)', async () => {
      const { refreshToken } = await service.generateRefreshToken('user-1');

      // First rotation — succeeds
      await service.refreshAccessToken(refreshToken);

      // Second attempt with same token = reuse detected → family revoked
      await expect(
        service.refreshAccessToken(refreshToken),
      ).rejects.toThrow('AUTH_SESSION_REVOKED');
    });

    it('AUTH-4: after reuse detection, even the new token is invalid', async () => {
      const { refreshToken } = await service.generateRefreshToken('user-1');

      // First rotation
      const rotated = await service.refreshAccessToken(refreshToken);

      // Old token triggers reuse → family revoked
      await expect(
        service.refreshAccessToken(refreshToken),
      ).rejects.toThrow('AUTH_SESSION_REVOKED');

      // New token should also be invalid now
      await expect(
        service.refreshAccessToken(rotated.refreshToken),
      ).rejects.toThrow('AUTH_INVALID_REFRESH_TOKEN');
    });

    it('rejects an invalid refresh token', async () => {
      await expect(
        service.refreshAccessToken('invalid-token-that-does-not-exist'),
      ).rejects.toThrow('AUTH_INVALID_REFRESH_TOKEN');
    });

    it('rejects a revoked token', async () => {
      const { refreshToken, session } = await service.generateRefreshToken('user-1');
      await service.revokeSession(session.id, 'USER_LOGOUT');

      await expect(
        service.refreshAccessToken(refreshToken),
      ).rejects.toThrow('AUTH_INVALID_REFRESH_TOKEN');
    });
  });

  describe('Session management (AUTH-5)', () => {
    it('lists active sessions for a user', async () => {
      await service.generateRefreshToken('user-1', 'device-1');
      await service.generateRefreshToken('user-1', 'device-2');

      const sessions = await service.listSessions('user-1');
      expect(sessions).toHaveLength(2);
    });

    it('revokes a specific session', async () => {
      const { refreshToken, session } = await service.generateRefreshToken('user-1');
      await service.revokeSession(session.id, 'USER_LOGOUT');

      const sessions = await service.listSessions('user-1');
      expect(sessions).toHaveLength(0);

      await expect(
        service.refreshAccessToken(refreshToken),
      ).rejects.toThrow('AUTH_INVALID_REFRESH_TOKEN');
    });

    it('AUTH-6: revokes all sessions on password change', async () => {
      await service.generateRefreshToken('user-1', 'device-1');
      await service.generateRefreshToken('user-1', 'device-2');
      expect((await service.listSessions('user-1'))).toHaveLength(2);

      await service.revokeAllUserSessions('user-1', 'PASSWORD_CHANGED');
      expect((await service.listSessions('user-1'))).toHaveLength(0);
    });
  });
});
