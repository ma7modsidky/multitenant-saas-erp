// Authentication library
// Session management, org switching, token storage.
//
// Minimal client for the auth endpoints. Token storage is in-memory +
// localStorage for now; Phase 2 moves to httpOnly cookies
// (see CODING_STANDARDS.md §12).

import { apiFetch } from '../api';

import { decodeJwtPayload, setAuthedCookie, sessionStore } from './session';

/**
 * User info returned by login.
 */
export interface AuthUser {
  id: string;
  email: string;
  name: string;
  preferredLocale: string | null;
  emailVerified: boolean;
}

/**
 * Response of a successful login.
 */
export interface AuthSession {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
}

/**
 * Persist a freshly-issued session (tokens + user + middleware cookie).
 */
export function applyAuthSession(session: AuthSession): void {
  sessionStore.setTokens({ accessToken: session.accessToken, refreshToken: session.refreshToken });
  sessionStore.setUser(session.user);
  setAuthedCookie(true);
}

/**
 * Register a new account (POST /v1/auth/signup).
 */
export function signup(input: {
  name: string;
  email: string;
  password: string;
  preferredLocale?: string;
}): Promise<{ message: string }> {
  return apiFetch<{ message: string }>('/v1/auth/signup', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/**
 * Log in with email + password (POST /v1/auth/login).
 * Stores the resulting session for the app shell.
 */
export async function login(input: { email: string; password: string; device?: string }): Promise<AuthSession> {
  const session = await apiFetch<AuthSession>('/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  applyAuthSession(session);
  return session;
}

/**
 * Switch the active organization (POST /v1/auth/switch-org).
 * The API re-issues tokens scoped to the target organization; the user
 * profile is unchanged, so it is preserved from the current session.
 */
export async function switchOrg(organizationId: string): Promise<void> {
  const data = await apiFetch<{ accessToken: string; refreshToken: string }>('/v1/auth/switch-org', {
    method: 'POST',
    body: JSON.stringify({ organizationId }),
  });
  sessionStore.setTokens({ accessToken: data.accessToken, refreshToken: data.refreshToken });
  setAuthedCookie(true);
}

/**
 * End the local session. Best-effort server-side session revocation
 * (AUTH-5); failures never block sign-out.
 */
export async function logout(): Promise<void> {
  const token = sessionStore.getAccessToken();
  const sessionId = token ? decodeJwtPayload(token)?.sessionId : undefined;
  if (typeof sessionId === 'string') {
    try {
      await apiFetch<{ message: string }>(`/v1/users/me/sessions/${sessionId}`, { method: 'DELETE' });
    } catch {
      // revocation is best-effort
    }
  }
  sessionStore.clear();
  setAuthedCookie(false);
}

/**
 * Attempt a silent token refresh with the STORED refresh token.
 *
 * Used at session hydration: a stored access token may already be expired
 * (15-min lifetime). Previously hydration marked the session "authenticated"
 * from the mere presence of a token, so the server-rendered dashboard shell
 * flashed on screen until the first API call 401'd and the client bounced to
 * login. Now hydration validates the token's `exp` and refreshes BEFORE the
 * shell renders — a stale `modubiz_authed` cookie can no longer cause the
 * flash because the loading gate stays up until the session is verified.
 *
 * Returns true when the tokens were rotated successfully. On failure the
 * caller clears the session (tokens + cookie) and redirects to login.
 */
export async function refreshStoredSession(): Promise<boolean> {
  const refreshToken = sessionStore.getRefreshToken();
  if (refreshToken === null) return false;
  try {
    const data = await apiFetch<{ accessToken: string; refreshToken: string }>(
      '/v1/auth/refresh',
      {
        method: 'POST',
        body: JSON.stringify({ refreshToken }),
      },
      // The refresh endpoint takes the refresh token from the body, not the
      // Authorization header; apiFetch's automatic 401→refresh retry must not
      // run here (it would recurse into itself).
      { auth: false },
    );
    sessionStore.setTokens({ accessToken: data.accessToken, refreshToken: data.refreshToken });
    setAuthedCookie(true);
    return true;
  } catch {
    return false;
  }
}

/**
 * Fetch the current user profile (GET /v1/users/me).
 */
export function fetchMe(): Promise<AuthUser> {
  return apiFetch<AuthUser>('/v1/users/me', {}, { auth: true });
}

/**
 * Update the current user profile (PATCH /v1/users/me).
 */
export async function updateProfile(input: { name?: string; preferredLocale?: string }): Promise<AuthUser> {
  const user = await apiFetch<AuthUser>('/v1/users/me', {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
  sessionStore.setUser(user);
  return user;
}

/**
 * Change the password (POST /v1/users/me/change-password).
 */
export function changePassword(input: { currentPassword: string; newPassword: string }): Promise<{ message: string }> {
  return apiFetch<{ message: string }>('/v1/users/me/change-password', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/**
 * Request a password reset email (POST /v1/auth/password-reset/request).
 */
export function requestPasswordReset(input: { email: string }): Promise<{ message: string }> {
  return apiFetch<{ message: string }>('/v1/auth/password-reset/request', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/**
 * Complete a password reset (POST /v1/auth/password-reset/complete).
 */
export function completePasswordReset(input: {
  email: string;
  token: string;
  newPassword: string;
}): Promise<{ message: string }> {
  return apiFetch<{ message: string }>('/v1/auth/password-reset/complete', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export { sessionStore };
