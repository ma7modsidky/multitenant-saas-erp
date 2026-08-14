// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest';

import { AUTH_COOKIE, authEvents, decodeJwtPayload, sessionStore, setAuthedCookie } from '../session';

function sign(payload: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: 'none', typ: 'JWT' }));
  const body = btoa(JSON.stringify(payload));
  return `${header}.${body}.signature`;
}

describe('decodeJwtPayload', () => {
  it('extracts claims from a token payload', () => {
    const token = sign({
      sub: 'user-1',
      sessionId: 'session-1',
      organizationId: 'org-1',
      permissions: ['crm:contact:read'],
    });
    const payload = decodeJwtPayload(token);
    expect(payload).toEqual({
      sub: 'user-1',
      sessionId: 'session-1',
      organizationId: 'org-1',
      permissions: ['crm:contact:read'],
    });
  });

  it('returns null for a malformed token', () => {
    expect(decodeJwtPayload('not-a-token')).toBeNull();
  });

  it('returns null for a token without a payload segment', () => {
    expect(decodeJwtPayload('header-only')).toBeNull();
  });
});

describe('sessionStore', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('stores and reads tokens', () => {
    sessionStore.setTokens({ accessToken: 'a', refreshToken: 'r' });
    expect(sessionStore.getTokens()).toEqual({ accessToken: 'a', refreshToken: 'r' });
    expect(sessionStore.getAccessToken()).toBe('a');
    expect(sessionStore.getRefreshToken()).toBe('r');
  });

  it('derives the organization id from the access token', () => {
    sessionStore.setTokens({ accessToken: sign({ organizationId: 'org-9' }), refreshToken: 'r' });
    expect(sessionStore.getOrganizationId()).toBe('org-9');
  });

  it('returns null organization id when the token has none', () => {
    sessionStore.setTokens({ accessToken: sign({}), refreshToken: 'r' });
    expect(sessionStore.getOrganizationId()).toBeNull();
  });

  it('reads permissions from the token payload', () => {
    sessionStore.setTokens({ accessToken: sign({ permissions: ['crm:deal:read'] }), refreshToken: 'r' });
    expect(sessionStore.getPermissions()).toEqual(['crm:deal:read']);
  });

  it('stores and reads the user', () => {
    const user = { id: 'u1', email: 'a@b.c', name: 'A B', preferredLocale: 'en', emailVerified: true };
    sessionStore.setUser(user);
    expect(sessionStore.getUser()).toEqual(user);
  });

  it('clears everything', () => {
    sessionStore.setTokens({ accessToken: 'a', refreshToken: 'r' });
    sessionStore.setUser({ id: 'u1', email: 'a@b.c', name: 'A', preferredLocale: null, emailVerified: false });
    sessionStore.clear();
    expect(sessionStore.getTokens()).toBeNull();
    expect(sessionStore.getUser()).toBeNull();
  });

  it('stores and reads the org-scoped billing snapshot', () => {
    const billing = {
      subscription: null,
      entitlements: [
        { moduleKey: 'pos', state: 'trialing', trialStartedAt: null, trialEndsAt: null, activatedAt: null },
      ],
    };
    sessionStore.setCachedBilling('org-1', billing);
    expect(sessionStore.getCachedBilling('org-1')).toEqual(billing);
  });

  it('keeps billing snapshots scoped per organization', () => {
    sessionStore.setCachedBilling('org-1', { subscription: null, entitlements: [] });
    sessionStore.setCachedBilling('org-2', {
      subscription: null,
      entitlements: [{ moduleKey: 'crm', state: 'active', trialStartedAt: null, trialEndsAt: null, activatedAt: null }],
    });
    expect(sessionStore.getCachedBilling('org-2')).toEqual({
      subscription: null,
      entitlements: [{ moduleKey: 'crm', state: 'active', trialStartedAt: null, trialEndsAt: null, activatedAt: null }],
    });
    expect(sessionStore.getCachedBilling('org-3')).toBeNull();
  });

  it('clears billing snapshots for every org on logout', () => {
    sessionStore.setCachedBilling('org-1', { subscription: null, entitlements: [] });
    sessionStore.setCachedBilling('org-2', { subscription: null, entitlements: [] });
    sessionStore.clear();
    expect(sessionStore.getCachedBilling('org-1')).toBeNull();
    expect(sessionStore.getCachedBilling('org-2')).toBeNull();
  });

  it('clears billing snapshots independently on org switch', () => {
    sessionStore.setCachedBilling('org-1', { subscription: null, entitlements: [] });
    sessionStore.clearBillingCache();
    expect(sessionStore.getCachedBilling('org-1')).toBeNull();
    expect(sessionStore.getTokens()).toBeNull();
  });

  it('is a no-op without localStorage access (node)', () => {
    const store = sessionStore;
    // Simulate absence of window.localStorage
    Object.defineProperty(window, 'localStorage', { value: undefined, configurable: true });
    expect(store.getTokens()).toBeNull();
    store.setTokens({ accessToken: 'a', refreshToken: 'r' });
    expect(store.getTokens()).toBeNull();
  });
});

describe('setAuthedCookie', () => {
  it('sets the middleware cookie on login', () => {
    setAuthedCookie(true);
    expect(document.cookie).toContain(`${AUTH_COOKIE}=1`);
  });

  it('expires the middleware cookie on logout', () => {
    setAuthedCookie(true);
    setAuthedCookie(false);
    expect(document.cookie).not.toContain(`${AUTH_COOKIE}=1`);
  });
});

describe('authEvents', () => {
  it('subscribes and emits tokens events', () => {
    const handler = (tokens: { accessToken: string; refreshToken: string }) => {
      expect(tokens.accessToken).toBe('new');
    };
    const off = authEvents.on('tokens', handler);
    authEvents.emit('tokens', { accessToken: 'new', refreshToken: 'new-r' });
    off();
    // After unsubscribing, emitting must not throw.
    authEvents.emit('tokens', { accessToken: 'again', refreshToken: 'again-r' });
  });

  it('emits expired events to subscribers', () => {
    let expired = false;
    const off = authEvents.on('expired', () => {
      expired = true;
    });
    authEvents.emit('expired');
    expect(expired).toBe(true);
    off();
  });
});
