// React session context — single source of truth for auth state in the app shell.

'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useLocale } from 'next-intl';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { authEvents, sessionStore } from './session';

import { login as loginRequest, logout as logoutRequest, switchOrg as switchOrgRequest, type AuthUser } from './index';

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
  useEffect(() => {
    const storedUser = sessionStore.getUser();
    if (sessionStore.getAccessToken() !== null) {
      setUserState(storedUser ? toAuthUser(storedUser) : null);
      setStatus('authenticated');
      refreshOrgId();
    } else {
      setStatus('unauthenticated');
    }
  }, [refreshOrgId]);

  const redirectToLogin = useCallback(() => {
    if (!pathname.includes('/login') && !pathname.includes('/signup')) {
      router.replace(`/${locale}/login`);
    }
  }, [locale, pathname, router]);

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
