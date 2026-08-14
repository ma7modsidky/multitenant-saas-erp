import { describe, expect, it } from 'vitest';

import { User, type UserData } from '../domain/index.js';

function makeUserData(overrides: Partial<UserData> = {}): UserData {
  return {
    id: 'user-1',
    email: '  John@Example.COM  ',
    passwordHash: 'argon2-hash-value',
    name: 'John Doe',
    preferredLocale: 'en',
    emailVerifiedAt: new Date('2026-01-01T00:00:00Z'),
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    failedLoginAttempts: 0,
    lockedUntil: null,
    isPlatformAdmin: false,
    ...overrides,
  };
}

describe('User.normalizeEmail() AUTH-1', () => {
  it('trims whitespace and lowercases', () => {
    expect(User.normalizeEmail('  John@Example.COM  ')).toBe('john@example.com');
  });

  it('handles already normalized email', () => {
    expect(User.normalizeEmail('john@example.com')).toBe('john@example.com');
  });

  it('handles uppercase email', () => {
    expect(User.normalizeEmail('JANE@EXAMPLE.COM')).toBe('jane@example.com');
  });
});

describe('User.create()', () => {
  it('creates a user from data', () => {
    const user = User.create(makeUserData());
    expect(user.id).toBe('user-1');
    expect(user.name).toBe('John Doe');
  });
});

describe('User.isEmailVerified AUTH-3', () => {
  it('returns true when emailVerifiedAt is set', () => {
    const user = User.create(makeUserData({ emailVerifiedAt: new Date() }));
    expect(user.isEmailVerified).toBe(true);
  });

  it('returns false when emailVerifiedAt is null', () => {
    const user = User.create(makeUserData({ emailVerifiedAt: null }));
    expect(user.isEmailVerified).toBe(false);
  });
});

describe('User.verifyEmail() AUTH-3', () => {
  it('sets emailVerifiedAt', () => {
    const user = User.create(makeUserData({ emailVerifiedAt: null }));
    expect(user.isEmailVerified).toBe(false);
    user.verifyEmail();
    expect(user.isEmailVerified).toBe(true);
    expect(user.emailVerifiedAt).toBeInstanceOf(Date);
  });
});

describe('AUTH-7: Login rate limiting and lockout', () => {
  it('recordSuccessfulLogin resets failed attempts and clears lock', () => {
    const user = User.create(makeUserData({ failedLoginAttempts: 5, lockedUntil: new Date(Date.now() + 3600000) }));
    user.recordSuccessfulLogin();
    expect(user.failedLoginAttempts).toBe(0);
    expect(user.lockedUntil).toBeNull();
  });

  it('recordFailedLogin increments the counter', () => {
    const user = User.create(makeUserData({ failedLoginAttempts: 0 }));
    user.recordFailedLogin();
    expect(user.failedLoginAttempts).toBe(1);
  });

  it('locks the account after 10 consecutive failures', () => {
    const user = User.create(makeUserData({ failedLoginAttempts: 9 }));
    const before = Date.now();
    user.recordFailedLogin();
    expect(user.failedLoginAttempts).toBe(10);
    expect(user.lockedUntil).toBeInstanceOf(Date);
    expect(user.lockedUntil!.getTime()).toBeGreaterThanOrEqual(before + 14 * 60 * 1000);
    expect(user.lockedUntil!.getTime()).toBeLessThanOrEqual(before + 16 * 60 * 1000);
  });

  it('isLocked returns true when lock is active', () => {
    const future = new Date(Date.now() + 3600000);
    const user = User.create(makeUserData({ lockedUntil: future }));
    expect(user.isLocked).toBe(true);
  });

  it('isLocked returns false when no lock is set', () => {
    const user = User.create(makeUserData({ lockedUntil: null }));
    expect(user.isLocked).toBe(false);
  });

  it('isLocked returns false when lock has expired', () => {
    const past = new Date(Date.now() - 3600000);
    const user = User.create(makeUserData({ lockedUntil: past }));
    expect(user.isLocked).toBe(false);
  });
});

describe('User.updatePasswordHash()', () => {
  it('updates the password hash', () => {
    const user = User.create(makeUserData());
    user.updatePasswordHash('new-argon2-hash');
    expect(user.passwordHash).toBe('new-argon2-hash');
  });
});

describe('User.updateProfile()', () => {
  it('updates name', () => {
    const user = User.create(makeUserData());
    user.updateProfile({ name: 'Jane Doe' });
    expect(user.name).toBe('Jane Doe');
  });

  it('updates preferredLocale', () => {
    const user = User.create(makeUserData());
    user.updateProfile({ preferredLocale: 'ar' });
    expect(user.preferredLocale).toBe('ar');
  });

  it('sets preferredLocale to null', () => {
    const user = User.create(makeUserData());
    user.updateProfile({ preferredLocale: null });
    expect(user.preferredLocale).toBeNull();
  });

  it('does not change fields not provided', () => {
    const user = User.create(makeUserData({ name: 'Original', preferredLocale: 'fr' }));
    user.updateProfile({ name: 'Updated' });
    expect(user.name).toBe('Updated');
    expect(user.preferredLocale).toBe('fr');
  });
});

describe('User.toJSON()', () => {
  it('returns a copy of the user data', () => {
    const data = makeUserData();
    const user = User.create(data);
    const json = user.toJSON();
    expect(json.email).toBe(data.email);
  });
});
