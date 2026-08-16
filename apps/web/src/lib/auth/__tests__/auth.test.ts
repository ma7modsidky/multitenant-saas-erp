// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { login, logout, refreshStoredSession, switchOrg } from '../index';
import { AUTH_COOKIE, sessionStore } from '../session';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function sign(payload: Record<string, unknown>): string {
  return `${btoa(JSON.stringify({ alg: 'none' }))}.${btoa(JSON.stringify(payload))}.signature`;
}

const USER = { id: 'u1', email: 'a@b.c', name: 'Ana B', preferredLocale: 'en', emailVerified: true };

describe('auth', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('login stores tokens, user, and the middleware cookie', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => jsonResponse(200, { data: { accessToken: 'a1', refreshToken: 'r1', user: USER } })),
    );

    const session = await login({ email: USER.email, password: 'password123' });
    expect(session.user.email).toBe(USER.email);
    expect(sessionStore.getAccessToken()).toBe('a1');
    expect(sessionStore.getUser()).toEqual(USER);
    expect(document.cookie).toContain(`${AUTH_COOKIE}=1`);
  });

  it('switchOrg re-issues tokens and preserves the stored user', async () => {
    sessionStore.setTokens({ accessToken: 'old', refreshToken: 'old-r' });
    sessionStore.setUser(USER);

    vi.stubGlobal(
      'fetch',
      vi.fn(() => jsonResponse(200, { data: { accessToken: 'scoped', refreshToken: 'scoped-r' } })),
    );

    await switchOrg('org-2');
    expect(sessionStore.getAccessToken()).toBe('scoped');
    expect(sessionStore.getRefreshToken()).toBe('scoped-r');
    expect(sessionStore.getUser()).toEqual(USER);
  });

  it('refreshStoredSession rotates tokens and returns refreshed on success', async () => {
    sessionStore.setTokens({ accessToken: 'expired', refreshToken: 'r1' });

    vi.stubGlobal(
      'fetch',
      vi.fn(() => jsonResponse(200, { data: { accessToken: 'a2', refreshToken: 'r2' } })),
    );

    expect(await refreshStoredSession()).toBe('refreshed');
    expect(sessionStore.getAccessToken()).toBe('a2');
    expect(sessionStore.getRefreshToken()).toBe('r2');
    expect(document.cookie).toContain(`${AUTH_COOKIE}=1`);
  });

  it('refreshStoredSession returns unreachable (not invalid) when the API cannot be reached', async () => {
    sessionStore.setTokens({ accessToken: 'expired', refreshToken: 'r1' });

    // Offline / dead network — fetch rejects before any HTTP response.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    );

    expect(await refreshStoredSession()).toBe('unreachable');
    // The stored session is untouched — the caller keeps it for offline use.
    expect(sessionStore.getAccessToken()).toBe('expired');
    expect(sessionStore.getRefreshToken()).toBe('r1');
  });

  it('refreshStoredSession returns invalid when the server rejects the refresh', async () => {
    sessionStore.setTokens({ accessToken: 'expired', refreshToken: 'r1' });

    vi.stubGlobal(
      'fetch',
      vi.fn(() => jsonResponse(401, { error: { code: 'INVALID_REFRESH_TOKEN', correlationId: 'c' } })),
    );

    expect(await refreshStoredSession()).toBe('invalid');
    expect(sessionStore.getAccessToken()).toBe('expired');
  });

  it('refreshStoredSession returns invalid when no refresh token is stored', async () => {
    window.localStorage.clear();
    // No fetch is attempted — the missing refresh token short-circuits.
    expect(await refreshStoredSession()).toBe('invalid');
  });

  it('logout revokes the session, clears storage and the cookie', async () => {
    const token = sign({ sub: 'u1', sessionId: 'session-1' });
    sessionStore.setTokens({ accessToken: token, refreshToken: 'r1' });
    sessionStore.setUser(USER);
    document.cookie = `${AUTH_COOKIE}=1; path=/`;

    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init: RequestInit) => {
        const path = String(url);
        expect(path.endsWith('/v1/users/me/sessions/session-1')).toBe(true);
        expect(init.method).toBe('DELETE');
        return jsonResponse(200, { data: { message: 'Session revoked.' } });
      }),
    );

    await logout();
    expect(sessionStore.getTokens()).toBeNull();
    expect(sessionStore.getUser()).toBeNull();
    expect(document.cookie).not.toContain(`${AUTH_COOKIE}=1`);
  });
});
