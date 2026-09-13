'use client';

import { Boxes } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { ThemeToggle } from '@/components/theme-toggle';
import { LocaleSwitcher } from '@/components/shell/locale-switcher';
import { Button } from '@/components/ui/button';

/** Anchor navigation shared by the topbar and the footer. */
const NAV_ANCHORS: readonly string[] = ['product', 'modules', 'how', 'testimonials'];

/**
 * Public marketing topbar — brand, section anchors, locale switcher,
 * theme toggle, and the auth CTAs. Sticks to the top with a blur so the
 * landing stays navigable while scrolling.
 */
export function MarketingTopbar() {
  const t = useTranslations('landing');
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close the mobile section menu on click outside.
  useEffect(() => {
    if (!open) return;
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && event.target instanceof Node && !menuRef.current.contains(event.target)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  return (
    <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-3 px-4 sm:px-6">
        {/* Brand */}
        <Link href={`/${locale}`} className="flex items-center gap-2 font-semibold">
          <span className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Boxes className="size-5" />
          </span>
          <span className="flex flex-col leading-none">
            <span className="text-base">ModuBiz</span>
            <span className="hidden text-xs font-normal text-muted-foreground sm:block">{t('brandTagline')}</span>
          </span>
        </Link>

        {/* Section anchors — desktop */}
        <nav aria-label="Sections" className="ms-6 hidden items-center gap-5 text-sm text-muted-foreground md:flex">
          {NAV_ANCHORS.map((key) => (
            <a key={key} href={`#${key}`} className="transition-colors hover:text-foreground">
              {t(`nav.${key}`)}
            </a>
          ))}
        </nav>

        <div className="ms-auto flex items-center gap-2">
          <LocaleSwitcher />
          <ThemeToggle />

          {/* Sign in — outline on desktop, icon-compact on mobile */}
          <Button variant="ghost" asChild className="hidden sm:inline-flex">
            <Link href={`/${locale}/login`}>{t('nav.signIn')}</Link>
          </Button>

          {/* Primary CTA */}
          <Button asChild>
            <Link href={`/${locale}/signup`}>{t('nav.getStarted')}</Link>
          </Button>

          {/* Mobile section menu */}
          <div className="relative md:hidden" ref={menuRef}>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Sections"
              aria-expanded={open}
              onClick={() => setOpen(!open)}
            >
              <svg
                viewBox="0 0 24 24"
                className="size-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
              </svg>
            </Button>
            {open && (
              <div className="absolute end-0 top-10 w-44 rounded-md border bg-popover p-1 shadow-md">
                {NAV_ANCHORS.map((key) => (
                  <a
                    key={key}
                    href={`#${key}`}
                    onClick={() => setOpen(false)}
                    className="block rounded-sm px-3 py-2 text-sm text-popover-foreground hover:bg-accent"
                  >
                    {t(`nav.${key}`)}
                  </a>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
