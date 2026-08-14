'use client';

import { ArrowLeft, Building2, LayoutDashboard, Settings, ShieldX, Tags, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { cn } from '@/components/cn';
import { AppProviders } from '@/components/providers';
import { Button } from '@/components/ui/button';
import { useSession } from '@/lib/auth/session-context';

/**
 * Admin console layout — the superuser back-office (PRD §5.5).
 *
 * A separate area from the tenant dashboard shell: its own top bar + nav, and
 * a hard client-side gate on the isPlatformAdmin claim (PLT-1/PLT-2). The API
 * guards every /v1/admin route server-authoritatively (OPS-8); this only
 * avoids rendering pages the user cannot use.
 */
export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <AppProviders>
      <AdminShell>{children}</AdminShell>
    </AppProviders>
  );
}

function AdminShell({ children }: { children: ReactNode }) {
  const t = useTranslations();
  const pathname = usePathname();
  const { status, isPlatformAdmin } = useSession();
  const locale = pathname.split('/')[1] ?? 'en';

  if (status !== 'authenticated') {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="size-8 animate-spin rounded-full border-4 border-muted border-t-primary" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">{t('shell.loading')}</p>
        </div>
      </div>
    );
  }

  if (!isPlatformAdmin) {
    return (
      <div className="flex min-h-screen items-center justify-center animate-fade-in">
        <div className="flex max-w-md flex-col items-center gap-3 rounded-lg border bg-card p-8 text-center shadow-sm">
          <div className="flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <ShieldX className="size-6" aria-hidden="true" />
          </div>
          <h1 className="text-lg font-semibold">{t('admin.accessDeniedTitle')}</h1>
          <p className="text-sm text-muted-foreground">{t('admin.accessDeniedBody')}</p>
          <Button asChild variant="outline" className="mt-2">
            <Link href={`/${locale}`}>{t('admin.nav.backToApp')}</Link>
          </Button>
        </div>
      </div>
    );
  }

  const items: Array<{ href: string; label: string; icon: LucideIcon; exact?: boolean }> = [
    { href: `/${locale}/admin`, label: t('admin.nav.overview'), icon: LayoutDashboard, exact: true },
    { href: `/${locale}/admin/organizations`, label: t('admin.nav.organizations'), icon: Building2 },
    { href: `/${locale}/admin/modules`, label: t('admin.nav.pricing'), icon: Tags },
    { href: `/${locale}/admin/settings`, label: t('admin.nav.settings'), icon: Settings },
  ];

  const isActive = (item: (typeof items)[number]) =>
    item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(item.href + '/');

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-4 px-4 md:px-6">
          <Link href={`/${locale}/admin`} className="flex items-center gap-2" aria-label="ModuBiz Admin">
            <div className="flex size-7 items-center justify-center rounded-md bg-primary text-xs font-bold text-primary-foreground">
              M
            </div>
            <span className="text-sm font-semibold">{t('admin.title')}</span>
          </Link>

          <nav className="hidden items-center gap-1 md:flex" aria-label="Admin navigation">
            {items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                  isActive(item)
                    ? 'bg-accent text-accent-foreground'
                    : 'text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground',
                )}
              >
                <item.icon className="size-4" aria-hidden="true" />
                {item.label}
              </Link>
            ))}
          </nav>

          <Link
            href={`/${locale}`}
            className="flex shrink-0 items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            <span className="hidden sm:inline">{t('admin.nav.backToApp')}</span>
          </Link>
        </div>

        {/* Mobile nav */}
        <nav
          className="flex items-center gap-1 overflow-x-auto border-t px-4 py-2 md:hidden"
          aria-label="Admin navigation"
        >
          {items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex shrink-0 items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                isActive(item)
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground',
              )}
            >
              <item.icon className="size-4" aria-hidden="true" />
              {item.label}
            </Link>
          ))}
        </nav>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 md:px-6 lg:px-8">{children}</main>

      <footer className="border-t px-6 py-3">
        <p className="text-center text-xs text-muted-foreground">
          &copy; {new Date().getFullYear()} ModuBiz. {t('shell.copyright')}
        </p>
      </footer>
    </div>
  );
}
