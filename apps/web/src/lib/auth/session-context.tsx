// React session context — single source of truth for auth state in the app shell.

'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useLocale } from 'next-intl';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { authEvents, decodeJwtPayload, setAuthedCookie, sessionStore } from './session';

import {
  login as loginRequest,
  logout as logoutRequest,
  refreshStoredSession,
  switchOrg as switchOrgRequest,
  type AuthUser,
} from './index';

export type SessionStatus = 'loading' | 'authenticated' | 'unauthenticated';

export interface SessionContextValue {
  status: SessionStatus;
  user: AuthUser | null;
  organizationId: string | null;
  permissions: string[];
  login: (input: { email: string; password: string }) => Promise<void>;
  switchOrg: (organizationId: string) => Promise<void>;
  logout: () => Promise<void>;
  setUser: (user: AuthUser) => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

function toAuthUser(user: AuthUser): AuthUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    preferredLocale: user.preferredLocale ?? null,
    emailVerified: user.emailVerified,
  };
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const locale = useLocale();

  const [status, setStatus] = useState<SessionStatus>('loading');
  const [user, setUserState] = useState<AuthUser | null>(null);
  const [organizationId, setOrganizationId] = useState<string | null>(null);

  const refreshOrgId = useCallback(() => {
    setOrganizationId(sessionStore.getOrganizationId());
  }, []);

  // Initial hydrate from the stored session.
  //
  // The access token expires every 15 minutes while the `modubiz_authed`
  // cookie (the only thing Next.js middleware can read) lasts 30 days. A
  // stored-but-expired token used to mark the session "authenticated", so the
  // server-rendered dashboard shell flashed on screen until the first API call
  // 401'd and the client bounced to login. Now the token's `exp` claim is
  // checked BEFORE the shell is shown: an expired token triggers a silent
  // refresh and the loading gate (ShellLayout) stays up until the session is
  // verified — no flash, and no stale-cookie bounce.
  useEffect(() => {
    let cancelled = false;

    async function hydrate() {
      const accessToken = sessionStore.getAccessToken();
      const storedUser = sessionStore.getUser();

      if (accessToken === null) {
        // No stored token — clear any stale middleware cookie so protected
        // routes are guarded server-side again (a 30-day cookie would
        // otherwise keep letting the dashboard shell render for logged-out
        // users).
        setAuthedCookie(false);
        setStatus('unauthenticated');
        return;
      }

      const payload = decodeJwtPayload(accessToken);
      const exp = typeof payload?.exp === 'number' ? payload.exp : undefined;
      // exp is in seconds (JWT convention); already expired (with a 5s grace)
      const expired = exp !== undefined && exp * 1000 <= Date.now() + 5000;

      if (!expired) {
        setUserState(storedUser ? toAuthUser(storedUser) : null);
        setStatus('authenticated');
        refreshOrgId();
        return;
      }

      // Token is expired — try a silent refresh before deciding. The user
      // profile is preserved from the stored session (refresh only rotates
      // tokens).
      const refreshed = await refreshStoredSession();
      if (cancelled) return;
      if (refreshed) {
        setUserState(storedUser ? toAuthUser(storedUser) : null);
        setStatus('authenticated');
        refreshOrgId();
      } else {
        sessionStore.clear();
        setAuthedCookie(false);
        setStatus('unauthenticated');
      }
    }

    void hydrate();
    return () => {
      cancelled = true;
    };
  }, [refreshOrgId]);

  const redirectToLogin = useCallback(() => {
    if (!pathname.includes('/login') && !pathname.includes('/signup')) {
      router.replace(`/${locale}/login`);
    }
  }, [locale, pathname, router]);

  // Redirect to login whenever the session resolves to unauthenticated on a
  // protected (dashboard) route. Covers hydration resolving to a stale cookie
  // with no usable token, the expired-token refresh failure path, and the
  // API-client `expired` event. redirectToLogin() itself skips /login and
  // /signup, so this can never bounce the user between auth pages.
  useEffect(() => {
    if (status === 'unauthenticated') {
      redirectToLogin();
    }
  }, [status, redirectToLogin]);

  // Listen for session expiry emitted by the API client.
  useEffect(() => {
    return authEvents.on('expired', () => {
      setUserState(null);
      setOrganizationId(null);
      setStatus('unauthenticated');
      redirectToLogin();
    });
  }, [redirectToLogin]);

  // Keep the org id in sync with token rotation.
  useEffect(() => {
    return authEvents.on('tokens', () => refreshOrgId());
  }, [refreshOrgId]);

  const setUser = useCallback((next: AuthUser) => {
    setUserState(toAuthUser(next));
  }, []);

  const login = useCallback(
    async (input: { email: string; password: string }) => {
      const session = await loginRequest(input);
      setUserState(toAuthUser(session.user));
      setStatus('authenticated');
      refreshOrgId();
    },
    [refreshOrgId],
  );

  const switchOrg = useCallback(
    async (orgId: string) => {
      await switchOrgRequest(orgId);
      refreshOrgId();
    },
    [refreshOrgId],
  );

  const logout = useCallback(async () => {
    await logoutRequest();
    setUserState(null);
    setOrganizationId(null);
    setStatus('unauthenticated');
    redirectToLogin();
  }, [redirectToLogin]);

  const value = useMemo<SessionContextValue>(
    () => ({
      status,
      user,
      organizationId,
      permissions: sessionStore.getPermissions(),
      login,
      switchOrg,
      logout,
      setUser,
    }),
    [status, user, organizationId, login, switchOrg, logout, setUser],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (ctx === null) {
    throw new Error('useSession must be used within a SessionProvider');
  }
  return ctx;
}
