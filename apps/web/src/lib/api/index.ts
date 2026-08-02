// API client library
// Minimal fetch wrapper around the ModuBiz API.
//
// Wraps @modubiz/api-client later (Phase 2); for now it is a small typed
// client that knows the wire format: `{ data }` on success, `{ error }`
// on failure. Error codes are surfaced so the UI can render i18n keys.
//
// Authenticated requests attach a `Bearer` token from the session store.
// A 401 from a protected endpoint triggers a single-flight token refresh
// (POST /v1/auth/refresh) and one retry; if the refresh fails the session
// is cleared and `authEvents` emits `expired`.

import { authEvents, setAuthedCookie, sessionStore } from '../auth/session';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000';

/**
 * Standard error envelope returned by the API (see AppExceptionFilter).
 */
export interface ApiErrorBody {
  code: string;
  params?: Record<string, unknown>;
  details?: Array<{ path: string; code: string; message?: string }>;
  correlationId: string;
}

/**
 * Error thrown for any non-2xx API response.
 * Carries the machine-readable code and params for i18n interpolation.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly params?: Record<string, unknown>;
  readonly details?: ApiErrorBody['details'];
  readonly correlationId?: string;

  constructor(status: number, body: Partial<ApiErrorBody>) {
    super(`API request failed with ${status} ${body.code ?? 'UNKNOWN_ERROR'}`);
    this.name = 'ApiError';
    this.status = status;
    this.code = body.code ?? 'UNKNOWN_ERROR';
    if (body.params !== undefined) {
      this.params = body.params;
    }
    if (body.details !== undefined) {
      this.details = body.details;
    }
    if (body.correlationId !== undefined) {
      this.correlationId = body.correlationId;
    }
  }
}

interface Envelope {
  data?: unknown;
  error?: Partial<ApiErrorBody>;
}

function isEnvelope(value: unknown): value is Envelope {
  return typeof value === 'object' && value !== null;
}

/** Endpoints that must never be retried through a token refresh. */
const AUTH_ENDPOINTS = ['/v1/auth/login', '/v1/auth/signup', '/v1/auth/refresh'];

let refreshing: Promise<boolean> | null = null;

/**
 * Single-flight token refresh. Concurrent 401s share one refresh call;
 * the API rotates the refresh token, so all callers must re-read the store.
 */
async function refreshTokens(): Promise<boolean> {
  const refreshToken = sessionStore.getRefreshToken();
  if (!refreshToken) return false;

  if (refreshing === null) {
    refreshing = (async () => {
      try {
        let res: Response;
        try {
          res = await fetch(`${API_BASE_URL}/v1/auth/refresh`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refreshToken }),
          });
        } catch {
          return false;
        }
        const raw: unknown = await res.json().catch(() => null);
        const envelope = isEnvelope(raw) ? raw : null;
        if (!res.ok || envelope?.data === undefined) {
          return false;
        }
        const data = envelope.data;
        if (
          typeof data !== 'object' ||
          data === null ||
          !('accessToken' in data) ||
          !('refreshToken' in data) ||
          typeof data.accessToken !== 'string' ||
          typeof data.refreshToken !== 'string'
        ) {
          return false;
        }
        const refreshed = { accessToken: data.accessToken, refreshToken: data.refreshToken };
        sessionStore.setTokens(refreshed);
        authEvents.emit('tokens', refreshed);
        return true;
      } finally {
        refreshing = null;
      }
    })();
  }

  return refreshing;
}

async function doFetch(path: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(`${API_BASE_URL}${path}`, init);
  } catch {
    throw new ApiError(0, { code: 'NETWORK_ERROR' });
  }
}

/**
 * Perform a JSON request against the API.
 *
 * @param path  API path, e.g. `/v1/auth/signup`
 * @param init  Fetch init; `Content-Type: application/json` is set automatically
 * @param opts.auth  Attach the Bearer token and refresh on 401 (default true)
 * @param opts.envelope  Return the full response envelope (e.g. `{ data, settings }`)
 *        instead of just its `data` field. Some endpoints return extra sibling
 *        fields (e.g. GET /v1/organizations/me), which are otherwise dropped.
 * @returns The `data` field of the response envelope (or the whole envelope)
 */
export async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
  opts: { auth?: boolean; envelope?: boolean } = {},
): Promise<T> {
  const auth = opts.auth !== false;
  const accessToken = auth ? sessionStore.getAccessToken() : null;

  // Only set Content-Type when there is a body. Fastify (API side) rejects an
  // empty body with `Content-Type: application/json` (FST_ERR_CTP_EMPTY_JSON_BODY)
  // and surfaces it as a 500 — which broke every bodyless DELETE (org delete,
  // member removal, role delete) from the browser.
  const headers: Record<string, string> = {};
  if (init.body != null) {
    headers['Content-Type'] = 'application/json';
  }
  if (init.headers) {
    for (const [key, value] of new Headers(init.headers)) {
      headers[key] = value;
    }
  }
  if (accessToken !== null) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  let res = await doFetch(path, { ...init, headers });

  // A protected endpoint 401 may mean the access token expired — refresh once and retry.
  if (res.status === 401 && auth && !AUTH_ENDPOINTS.some((endpoint) => path.startsWith(endpoint))) {
    if (await refreshTokens()) {
      headers.Authorization = `Bearer ${sessionStore.getAccessToken() ?? ''}`;
      res = await doFetch(path, { ...init, headers });
    }
  }

  const raw: unknown = await res.json().catch(() => null);
  const envelope = isEnvelope(raw) ? raw : null;

  if (!res.ok) {
    if (res.status === 401 && auth && !AUTH_ENDPOINTS.some((endpoint) => path.startsWith(endpoint))) {
      // Refresh failed — the session is no longer usable. Clear the middleware
      // cookie too: it outlives the access token (30 days vs 15 min) and would
      // otherwise keep letting the server render protected shells for a
      // session the client can no longer use.
      sessionStore.clear();
      setAuthedCookie(false);
      authEvents.emit('expired');
    }
    throw new ApiError(res.status, envelope?.error ?? { code: 'UNKNOWN_ERROR' });
  }

  if (envelope === null || envelope.data === undefined) {
    throw new ApiError(res.status, { code: 'EMPTY_RESPONSE' });
  }

  // Generic client: the caller's type T is the contract for a decoded JSON payload.
  // eslint-disable-next-line no-restricted-syntax -- unavoidable cast of decoded JSON to the generic caller type
  return (opts.envelope === true ? raw : envelope.data) as T;
}
