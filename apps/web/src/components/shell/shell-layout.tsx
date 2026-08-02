'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { getMyOrganizations } from '@/lib/api/resources';
import { useSession } from '@/lib/auth/session-context';

import { cn } from '../cn';

import { Sidebar } from './sidebar';
import { Topbar } from './topbar';

interface ShellLayoutProps {
  children: ReactNode;
}

/**
 * ShellLayout — the main authenticated app layout.
 *
 * Provides sidebar navigation + topbar + main content area.
 * Used by the (dashboard) route group.
 *
 * The sidebar collapsed state is managed here so the main
 * content offset can react to it.
 *
 * AUTHZ-5 UX (org auto-select): login issues an org-less, permission-less
 * access token (login is a public route; claims are minted at switch-org). A
 * returning member who belongs to organizations therefore lands on ANY
 * dashboard route (e.g. a direct /settings/members link) with
 * organizationId === null and empty permissions — which would hide the
 * Members/Roles/Billing sidebar entries AND the role-change controls behind
 * the hasPermission gating. This layout auto-selects the user's FIRST
 * organization: switch-org re-issues the token with the member's role key +
 * effective permissions, so the gated UI appears on every entry point. A
 * brand-new user (resolved-empty membership list) stays on the create-org
 * form rendered by the dashboard page.
 */
export function ShellLayout({ children }: ShellLayoutProps) {
  const t = useTranslations();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  const { status, organizationId, switchOrg } = useSession();
  const autoSelectTried = useRef(false);
  const { data: myOrgs } = useQuery({
    queryKey: ['my-organizations-shell'],
    queryFn: getMyOrganizations,
    enabled: status === 'authenticated' && organizationId === null && !autoSelectTried.current,
  });

  useEffect(() => {
    if (status !== 'authenticated' || organizationId !== null || autoSelectTried.current) return;
    // myOrgs === undefined means the membership query is still loading — wait
    // for it (setting the guard here would permanently suppress auto-select
    // for returning members on a slow network). Only a RESOLVED empty array
    // means "brand-new user" → stay on the create-org form.
    if (!myOrgs) return;
    const firstOrg = myOrgs[0];
    if (!firstOrg) {
      autoSelectTried.current = true;
      return;
    }
    // Reset the guard on failure so a retry can happen on the next effect run
    // (the topbar org switcher is also always available as a fallback).
    switchOrg(firstOrg.organizationId).catch(() => {
      autoSelectTried.current = false;
    });
    autoSelectTried.current = true;
  }, [status, organizationId, myOrgs, switchOrg]);

  // Flash-guard: a stale `modubiz_authed` cookie lets the server render this
  // shell for a session the client can no longer use (expired/absent token).
  // SessionProvider now validates the token's `exp` at hydration and only
  // flips to `authenticated` after a successful refresh — so while the status
  // is anything else, show a loading gate instead of the dashboard. Without
  // this, visiting / could flash the dashboard layout for a second before the
  // client bounced to /login.
  if (status !== 'authenticated') {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="size-8 animate-spin rounded-full border-4 border-muted border-t-primary" aria-hidden="true" />
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {t('shell.loading')}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen">
      {/* Desktop sidebar */}
      <div className="hidden md:block">
        <Sidebar collapsed={sidebarCollapsed} onCollapsedChange={setSidebarCollapsed} />
      </div>

      {/* Mobile sidebar overlay */}
      {mobileSidebarOpen && (
        <>
          <div
            className="fixed inset-0 z-50 bg-black/50 md:hidden"
            onClick={() => setMobileSidebarOpen(false)}
            aria-hidden="true"
          />
          <div className="fixed inset-y-0 start-0 z-50 md:hidden animate-slide-in">
            <Sidebar />
          </div>
        </>
      )}

      {/* Main content area */}
      <div
        className={cn('flex flex-1 flex-col transition-all duration-200', sidebarCollapsed ? 'md:ms-16' : 'md:ms-64')}
      >
        <Topbar onMenuToggle={() => setMobileSidebarOpen(!mobileSidebarOpen)} />

        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-7xl px-4 py-6 md:px-6 lg:px-8">{children}</div>
        </main>

        {/* Footer */}
        <footer className="border-t py-3 px-6">
          <p className="text-center text-xs text-muted-foreground">
            &copy; {new Date().getFullYear()} ModuBiz. {t('shell.copyright')}
          </p>
        </footer>
      </div>
    </div>
  );
}
