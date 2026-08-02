// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { authEvents, sessionStore } from '../../auth/session';
import { ApiError, apiFetch } from '../index';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function asApiError(value: unknown): ApiError {
  if (value instanceof ApiError) return value;
  throw new Error('Expected an ApiError');
}

describe('apiFetch', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('returns the data field of a success envelope', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => jsonResponse(200, { data: { ok: true } })),
    );
    await expect(apiFetch<{ ok: boolean }>('/v1/test')).resolves.toEqual({ ok: true });
  });

  it('throws ApiError with the error code on a failed envelope', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => jsonResponse(401, { error: { code: 'AUTH_INVALID_CREDENTIALS', correlationId: 'c-1' } })),
    );
    const err = asApiError(await apiFetch<unknown>('/v1/auth/login').catch((e: unknown) => e));
    expect(err.status).toBe(401);
    expect(err.code).toBe('AUTH_INVALID_CREDENTIALS');
    expect(err.correlationId).toBe('c-1');
  });

  it('throws EMPTY_RESPONSE when the envelope has no data', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => jsonResponse(200, { something: true })),
    );
    const err = asApiError(await apiFetch<unknown>('/v1/test').catch((e: unknown) => e));
    expect(err.code).toBe('EMPTY_RESPONSE');
  });

  it('throws NETWORK_ERROR on a network-level failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        throw new TypeError('Failed to fetch');
      }),
    );
    const err = asApiError(await apiFetch<unknown>('/v1/test').catch((e: unknown) => e));
    expect(err.code).toBe('NETWORK_ERROR');
    expect(err.status).toBe(0);
  });

  it('attaches the Bearer token from the session store', async () => {
    sessionStore.setTokens({ accessToken: 'tok-1', refreshToken: 'ref-1' });
    const fetchMock = vi.fn((_url: string, init: RequestInit) => {
      expect(new Headers(init.headers).get('Authorization')).toBe('Bearer tok-1');
      return jsonResponse(200, { data: { ok: true } });
    });
    vi.stubGlobal('fetch', fetchMock);
    await apiFetch<{ ok: boolean }>('/v1/users/me');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not attach a token when auth is disabled', async () => {
    sessionStore.setTokens({ accessToken: 'tok-1', refreshToken: 'ref-1' });
    const fetchMock = vi.fn((_url: string, init: RequestInit) => {
      expect(new Headers(init.headers).get('Authorization')).toBeNull();
      return jsonResponse(200, { data: { ok: true } });
    });
    vi.stubGlobal('fetch', fetchMock);
    await apiFetch<{ ok: boolean }>('/v1/auth/login', { method: 'POST' }, { auth: false });
  });

  it('refreshes once on a 401 and retries the original request', async () => {
    sessionStore.setTokens({ accessToken: 'expired', refreshToken: 'ref-1' });
    const calls: Array<{ url: string; auth: string | undefined }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init: RequestInit) => {
        calls.push({ url: String(url), auth: new Headers(init.headers).get('Authorization') ?? undefined });
        if (String(url).endsWith('/v1/auth/refresh')) {
          return jsonResponse(200, { data: { accessToken: 'fresh', refreshToken: 'ref-2' } });
        }
        if (calls.filter((c) => c.url === String(url)).length === 1) {
          return jsonResponse(401, { error: { code: 'AUTH_TOKEN_EXPIRED' } });
        }
        return jsonResponse(200, { data: { ok: true } });
      }),
    );

    await expect(apiFetch<{ ok: boolean }>('/v1/users/me')).resolves.toEqual({ ok: true });
    expect(calls.filter((c) => !c.url.endsWith('/v1/auth/refresh'))).toHaveLength(2);
    expect(calls[0]?.auth).toBe('Bearer expired');
    expect(calls[2]?.auth).toBe('Bearer fresh');
    expect(sessionStore.getAccessToken()).toBe('fresh');
  });

  it('clears the session and emits expired when refresh fails', async () => {
    sessionStore.setTokens({ accessToken: 'expired', refreshToken: 'dead' });
    let expired = false;
    const off = authEvents.on('expired', () => {
      expired = true;
    });

    vi.stubGlobal(
      'fetch',
      vi.fn(() => jsonResponse(401, { error: { code: 'AUTH_TOKEN_EXPIRED' } })),
    );

    const err = asApiError(await apiFetch<unknown>('/v1/users/me').catch((e: unknown) => e));
    expect(err.code).toBe('AUTH_TOKEN_EXPIRED');
    expect(sessionStore.getTokens()).toBeNull();
    expect(expired).toBe(true);
    off();
  });
});
