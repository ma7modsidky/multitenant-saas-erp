'use client';

import Link from 'next/link';
import { useLocale } from 'next-intl';
import type { ReactNode } from 'react';

import { LocaleSwitcher } from '../shell/locale-switcher';

/**
 * AuthShell — the top bar shown on the unauthenticated pages (login, signup,
 * forgot/reset password, invitation acceptance).
 *
 * Previously the auth route group rendered no header at all, so a user who
 * landed on /login (e.g. bounced from a protected route) had no way to switch
 * the interface language. The brand links to the locale root; the locale
 * switcher lets the user pick a language without losing their place.
 */
export function AuthShell({ children }: { children: ReactNode }) {
  const locale = useLocale();

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 h-14 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="flex h-full items-center justify-between px-4">
          <Link href={`/${locale}`} className="flex items-center gap-2" aria-label="ModuBiz Home">
            <div className="flex size-7 items-center justify-center rounded-md bg-primary text-xs font-bold text-primary-foreground">
              M
            </div>
            <span className="text-base font-semibold">ModuBiz</span>
          </Link>
          <LocaleSwitcher />
        </div>
      </header>
      <main className="flex flex-1 flex-col">{children}</main>
    </div>
  );
}
