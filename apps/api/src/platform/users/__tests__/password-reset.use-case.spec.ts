import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DomainError } from '../../../core/common/errors.js';
import { PasswordService } from '../../../core/auth/password.service.js';
import { AUTH_INVALID_RESET_TOKEN, type UserData } from '../domain/index.js';
import { PasswordResetUseCase } from '../application/password-reset.use-case.js';

function makeUser(overrides: Partial<UserData> = {}): UserData {
  return {
    id: 'user-1',
    email: 'user@example.com',
    passwordHash: 'old-hash',
    name: 'Test User',
    preferredLocale: null,
    emailVerifiedAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    failedLoginAttempts: 0,
    lockedUntil: null,
    isPlatformAdmin: false,
    ...overrides,
  };
}

describe('PasswordResetUseCase (AUTH-9)', () => {
  let userRepo: { findByEmail: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  let passwordService: { hash: ReturnType<typeof vi.fn> };
  let useCase: PasswordResetUseCase;

  beforeEach(() => {
    userRepo = {
      findByEmail: vi.fn().mockResolvedValue(makeUser()),
      update: vi.fn().mockResolvedValue(makeUser()),
    };
    passwordService = {
      hash: vi.fn().mockResolvedValue('new-argon2-hash'),
    };

    useCase = new PasswordResetUseCase(userRepo as never, passwordService as never);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('AUTH-9: requestReset issues a reset token for an existing user', async () => {
    const result = await useCase.requestReset({ email: '  USER@Example.COM  ' });

    expect(userRepo.findByEmail).toHaveBeenCalledWith('user@example.com');
    expect(result.resetToken).toBeTruthy();
    expect(result.resetToken).not.toBe('noop-token');
  });

  it('AUTH-8: requestReset returns a noop token for unknown emails (no enumeration)', async () => {
    userRepo.findByEmail.mockResolvedValue(undefined);

    const result = await useCase.requestReset({ email: 'missing@example.com' });

    expect(result.resetToken).toBe('noop-token');
  });

  it('AUTH-9: completeReset replaces the password with a freshly hashed value', async () => {
    const { resetToken } = await useCase.requestReset({ email: 'user@example.com' });

    await useCase.completeReset({ email: 'user@example.com', resetToken, newPassword: 'NewPass123!' });

    expect(passwordService.hash).toHaveBeenCalledWith('NewPass123!');
    expect(userRepo.update).toHaveBeenCalledWith('user-1', { passwordHash: 'new-argon2-hash' });
  });

  it('AUTH-9: completeReset rejects an unknown email with AUTH_INVALID_RESET_TOKEN', async () => {
    userRepo.findByEmail.mockResolvedValue(undefined);

    await expect(
      useCase.completeReset({ email: 'missing@example.com', resetToken: 'anything', newPassword: 'NewPass123!' }),
    ).rejects.toMatchObject({ code: AUTH_INVALID_RESET_TOKEN });
  });

  it('AUTH-9: completeReset rejects a wrong token', async () => {
    await useCase.requestReset({ email: 'user@example.com' });

    await expect(
      useCase.completeReset({ email: 'user@example.com', resetToken: 'wrong-token', newPassword: 'NewPass123!' }),
    ).rejects.toMatchObject({ code: AUTH_INVALID_RESET_TOKEN });
    expect(userRepo.update).not.toHaveBeenCalled();
  });

  it('AUTH-9: reset tokens are single-use — the second use is rejected', async () => {
    const { resetToken } = await useCase.requestReset({ email: 'user@example.com' });

    await useCase.completeReset({ email: 'user@example.com', resetToken, newPassword: 'NewPass123!' });

    await expect(
      useCase.completeReset({ email: 'user@example.com', resetToken, newPassword: 'AnotherPass1!' }),
    ).rejects.toMatchObject({ code: AUTH_INVALID_RESET_TOKEN });
    // Exactly one password update happened.
    expect(userRepo.update).toHaveBeenCalledTimes(1);
  });

  it('AUTH-9: completeReset rejects an expired token after the 60-minute window', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-02T00:00:00Z'));

    const { resetToken } = await useCase.requestReset({ email: 'user@example.com' });

    // 61 minutes later — beyond the 60-minute expiry.
    vi.advanceTimersByTime(61 * 60 * 1000);

    await expect(
      useCase.completeReset({ email: 'user@example.com', resetToken, newPassword: 'NewPass123!' }),
    ).rejects.toBeInstanceOf(DomainError);
    await expect(
      useCase.completeReset({ email: 'user@example.com', resetToken, newPassword: 'NewPass123!' }),
    ).rejects.toMatchObject({ code: AUTH_INVALID_RESET_TOKEN });
    expect(userRepo.update).not.toHaveBeenCalled();
  });
});
