import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DomainError, UnauthorizedError } from '../../../core/common/errors.js';
import { PasswordService } from '../../../core/auth/password.service.js';
import { JwtTokenService } from '../../../core/auth/jwt-token.service.js';
import { AUTH_ACCOUNT_LOCKED, AUTH_INVALID_CREDENTIALS, type UserData } from '../domain/index.js';
import { LoginUseCase } from '../application/login.use-case.js';

function makeUser(overrides: Partial<UserData> = {}): UserData {
  return {
    id: 'user-1',
    email: 'user@example.com',
    passwordHash: 'valid-argon2-hash',
    name: 'Test User',
    preferredLocale: null,
    emailVerifiedAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    failedLoginAttempts: 0,
    lockedUntil: null,
    ...overrides,
  };
}

describe('LoginUseCase (AUTH-7/8)', () => {
  let userRepo: { findByEmail: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  let passwordService: { verify: ReturnType<typeof vi.fn> };
  let jwtTokenService: {
    generateRefreshToken: ReturnType<typeof vi.fn>;
    generateAccessToken: ReturnType<typeof vi.fn>;
  };
  let useCase: LoginUseCase;

  beforeEach(() => {
    userRepo = {
      findByEmail: vi.fn().mockResolvedValue(makeUser()),
      update: vi.fn().mockResolvedValue(makeUser()),
    };
    passwordService = {
      verify: vi.fn().mockResolvedValue(true),
    };
    jwtTokenService = {
      generateRefreshToken: vi.fn().mockResolvedValue({
        refreshToken: 'refresh-token-1',
        session: { id: 'session-1', tokenFamily: 'fam-1' },
      }),
      generateAccessToken: vi.fn().mockResolvedValue('access-token-1'),
    };

    useCase = new LoginUseCase(userRepo as never, passwordService as never, jwtTokenService as never);
  });

  it('AUTH-8: returns a generic error for an unknown email (no enumeration, no timing leak)', async () => {
    userRepo.findByEmail.mockResolvedValue(undefined);

    await expect(useCase.execute({ email: 'missing@example.com', password: 'anything' })).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
    await expect(useCase.execute({ email: 'missing@example.com', password: 'anything' })).rejects.toMatchObject({
      code: AUTH_INVALID_CREDENTIALS,
    });
    // The dummy verification ran to keep response time constant.
    expect(passwordService.verify).toHaveBeenCalled();
    expect(userRepo.update).not.toHaveBeenCalled();
  });

  it('AUTH-8: returns a generic error on a wrong password and records the failed attempt', async () => {
    passwordService.verify.mockResolvedValue(false);

    await expect(useCase.execute({ email: 'user@example.com', password: 'wrong' })).rejects.toMatchObject({
      code: AUTH_INVALID_CREDENTIALS,
    });
    expect(userRepo.update).toHaveBeenCalledWith('user-1', {
      failedLoginAttempts: 1,
      lockedUntil: null,
    });
  });

  it('AUTH-7: locks the account on the 10th consecutive failure', async () => {
    userRepo.findByEmail.mockResolvedValue(makeUser({ failedLoginAttempts: 9 }));
    passwordService.verify.mockResolvedValue(false);

    await expect(useCase.execute({ email: 'user@example.com', password: 'wrong' })).rejects.toMatchObject({
      code: AUTH_INVALID_CREDENTIALS,
    });

    // The 10th failure sets a 15-minute lock.
    const update = userRepo.update.mock.calls[0]?.[1] as { failedLoginAttempts: number; lockedUntil: Date | null };
    expect(update.failedLoginAttempts).toBe(10);
    expect(update.lockedUntil).toBeInstanceOf(Date);
  });

  it('AUTH-7: rejects login while locked with AUTH_ACCOUNT_LOCKED (password not even checked)', async () => {
    userRepo.findByEmail.mockResolvedValue(makeUser({ lockedUntil: new Date(Date.now() + 15 * 60 * 1000) }));

    await expect(useCase.execute({ email: 'user@example.com', password: 'correct' })).rejects.toBeInstanceOf(
      DomainError,
    );
    await expect(useCase.execute({ email: 'user@example.com', password: 'correct' })).rejects.toMatchObject({
      code: AUTH_ACCOUNT_LOCKED,
    });
    expect(passwordService.verify).not.toHaveBeenCalled();
  });

  it('AUTH-7: allows login again once the lock has expired', async () => {
    userRepo.findByEmail.mockResolvedValue(makeUser({ lockedUntil: new Date(Date.now() - 1000) }));

    await expect(useCase.execute({ email: 'user@example.com', password: 'correct' })).resolves.toBeDefined();
  });

  it('AUTH-4: successful login resets the failure counter and issues access + refresh tokens', async () => {
    const result = await useCase.execute({
      email: 'user@example.com',
      password: 'correct',
      device: 'web',
      ip: '1.2.3.4',
    });

    expect(result.accessToken).toBe('access-token-1');
    expect(result.refreshToken).toBe('refresh-token-1');
    expect(userRepo.update).toHaveBeenCalledWith('user-1', { failedLoginAttempts: 0, lockedUntil: null });
    expect(jwtTokenService.generateRefreshToken).toHaveBeenCalledWith('user-1', 'web', '1.2.3.4');
  });
});
