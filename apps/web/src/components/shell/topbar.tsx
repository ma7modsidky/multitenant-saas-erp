'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, Moon, Sun, Monitor, LogOut, User, Settings, Building2, ChevronDown, Menu, Check } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState, useRef, useEffect } from 'react';

import { getMyOrganizations } from '@/lib/api/resources';
import type { MembershipOrg } from '@/lib/api/types';
import { useSession } from '@/lib/auth/session-context';
import { applyTheme, getStoredTheme, storeTheme, type Theme } from '@/lib/theme';

import { Button } from '../ui/button';
import { Separator } from '../ui/separator';
import { LocaleSwitcher } from './locale-switcher';

interface TopbarProps {
  onMenuToggle?: () => void;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0] ?? '';
  if (parts.length === 0) return '?';
  if (parts.length === 1) return first.charAt(0).toUpperCase();
  return (first.charAt(0) + (parts[parts.length - 1] ?? first).charAt(0)).toUpperCase();
}

export function Topbar({ onMenuToggle }: TopbarProps) {
  const t = useTranslations();
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  const locale = pathname.split('/')[1] ?? 'en';

  const { status, user, organizationId, switchOrg, logout } = useSession();

  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showOrgMenu, setShowOrgMenu] = useState(false);
  const [isSwitching, setIsSwitching] = useState(false);
  // NOTE: the initial state MUST match what SSR renders ('light') — reading
  // localStorage in the initializer would make the client's first render
  // differ from the server HTML and break hydration. The persisted selection
  // is restored in the effect below (the root layout's inline script already
  // applied it pre-paint, so there is no flash of the wrong theme).
  const [theme, setTheme] = useState<Theme>('light');

  // Restore the persisted selection after hydration (idempotent), and follow
  // the OS whenever the stored selection is 'system'.
  useEffect(() => {
    const stored = getStoredTheme();
    setTheme(stored);
    applyTheme(stored);
  }, []);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const orgMenuRef = useRef<HTMLDivElement>(null);

  const { data: myOrgs } = useQuery({
    queryKey: ['my-organizations'],
    queryFn: getMyOrganizations,
    // Only fetch while a real session exists. The shell gate (ShellLayout)
    // already keeps this component mounted only when authenticated, but a
    // stale-cookie render must not fire API calls that 401 and bounce the
    // user to login mid-hydration.
    enabled: status === 'authenticated',
  });

  // Close menus on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (userMenuRef.current && event.target instanceof Node && !userMenuRef.current.contains(event.target)) {
        setShowUserMenu(false);
      }
      if (orgMenuRef.current && event.target instanceof Node && !orgMenuRef.current.contains(event.target)) {
        setShowOrgMenu(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const cycleTheme = () => {
    const themes: Theme[] = ['light', 'dark', 'system'];
    const nextIndex = (themes.indexOf(theme) + 1) % themes.length;
    const next = themes[nextIndex];
    if (!next) return;
    setTheme(next);
    storeTheme(next);
    applyTheme(next);
  };

  const themeIcon = theme === 'dark' ? Moon : theme === 'light' ? Sun : Monitor;
  const ThemeIcon = themeIcon;

  const activeOrg: MembershipOrg | undefined = (myOrgs ?? []).find((org) => org.organizationId === organizationId);

  const handleSwitchOrg = async (orgId: string) => {
    if (orgId === organizationId) return;
    setIsSwitching(true);
    try {
      await switchOrg(orgId);
      await queryClient.invalidateQueries();
      router.refresh();
    } finally {
      setIsSwitching(false);
      setShowOrgMenu(false);
    }
  };

  const handleLogout = async () => {
    await logout();
  };

  return (
    <header className="sticky start-0 top-0 z-30 h-14 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex h-full items-center gap-2 px-4">
        <Button variant="ghost" size="icon" className="md:hidden" onClick={onMenuToggle} aria-label="Toggle menu">
          <Menu className="size-4" />
        </Button>

        {/* Org switcher */}
        <div className="flex items-center gap-2">
          <div className="relative" ref={orgMenuRef}>
            <button
              type="button"
              className="flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm hover:bg-accent transition-colors"
              onClick={() => setShowOrgMenu(!showOrgMenu)}
              aria-expanded={showOrgMenu}
              aria-haspopup="true"
              aria-label={t('shell.switchOrg')}
            >
              <Building2 className="size-3.5 text-muted-foreground" />
              <span className="max-w-40 truncate font-medium">{activeOrg?.organizationName ?? t('nav.dashboard')}</span>
              <ChevronDown className="size-3 text-muted-foreground" />
            </button>

            {showOrgMenu && (
              <div className="absolute start-0 top-full mt-1 w-64 rounded-lg border bg-popover p-1 shadow-lg animate-fade-in">
                <p className="px-2 py-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  {t('shell.organizations')}
                </p>
                <div className="max-h-64 overflow-y-auto">
                  {(myOrgs ?? []).length === 0 && (
                    <p className="px-2 py-1.5 text-sm text-muted-foreground">{t('shell.noOrganizations')}</p>
                  )}
                  {(myOrgs ?? []).map((org) => (
                    <button
                      key={org.organizationId}
                      type="button"
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent"
                      onClick={() => void handleSwitchOrg(org.organizationId)}
                      disabled={isSwitching}
                    >
                      <Building2 className="size-4 shrink-0 text-muted-foreground" />
                      <span className="flex-1 truncate text-start">{org.organizationName}</span>
                      {org.organizationStatus === 'pending_deletion' && (
                        <span className="shrink-0 text-xs text-amber-600 dark:text-amber-400">
                          {t('shell.pendingDeletion')}
                        </span>
                      )}
                      {org.current && <Check className="size-4 text-primary" aria-hidden="true" />}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex-1" />

        <div className="flex items-center gap-1">
          {/* Locale switcher (dropdown) */}
          <LocaleSwitcher />

          <Separator orientation="vertical" className="mx-1 h-6" />

          {/* Theme toggle */}
          <Button
            variant="ghost"
            size="icon"
            onClick={cycleTheme}
            aria-label={t(
              theme === 'dark' ? 'shell.darkMode' : theme === 'light' ? 'shell.lightMode' : 'shell.systemMode',
            )}
          >
            <ThemeIcon className="size-4" />
          </Button>

          {/* Notifications */}
          <Button variant="ghost" size="icon" className="relative" aria-label={t('shell.notifications')}>
            <Bell className="size-4" />
          </Button>

          {/* User menu */}
          <div className="relative" ref={userMenuRef}>
            <Button
              variant="ghost"
              size="sm"
              className="gap-2 pe-2"
              onClick={() => setShowUserMenu(!showUserMenu)}
              aria-expanded={showUserMenu}
              aria-haspopup="true"
              aria-label={t('shell.userMenu')}
            >
              <div className="flex size-7 items-center justify-center rounded-full bg-primary text-xs font-medium text-primary-foreground">
                {user ? initials(user.name) : '?'}
              </div>
              <span className="hidden sm:inline text-sm font-medium">{user?.name ?? ''}</span>
              <ChevronDown className="size-3 text-muted-foreground" />
            </Button>

            {showUserMenu && (
              <div className="absolute end-0 top-full mt-1 w-56 rounded-lg border bg-popover p-1 shadow-lg animate-fade-in">
                <div className="px-2 py-1.5">
                  <p className="text-sm font-medium">{user?.name ?? ''}</p>
                  <p className="text-xs text-muted-foreground">{user?.email ?? ''}</p>
                </div>
                <Separator className="my-1" />
                <Link
                  href={`/${locale}/settings/profile`}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent"
                  onClick={() => setShowUserMenu(false)}
                >
                  <User className="size-4" />
                  {t('shell.profile')}
                </Link>
                <Link
                  href={`/${locale}/settings`}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent"
                  onClick={() => setShowUserMenu(false)}
                >
                  <Settings className="size-4" />
                  {t('shell.accountSettings')}
                </Link>
                <Separator className="my-1" />
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-destructive transition-colors hover:bg-destructive/10"
                  onClick={() => void handleLogout()}
                >
                  <LogOut className="size-4" />
                  {t('auth.logout')}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
