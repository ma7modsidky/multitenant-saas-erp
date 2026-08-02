'use client';

import { Check, ChevronDown, Globe } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';

/**
 * Locale switcher — a dropdown that switches the active locale while keeping
 * the user on the same page (the [locale] segment is swapped in the path).
 *
 * Used in the dashboard topbar and the auth-page topbar so the language can
 * be changed from anywhere (the previous auth pages had no top bar at all).
 *
 * Locale metadata is typed explicitly (a readonly array instead of `as const`
 * — base no-restricted-syntax bans TSAsExpression casts).
 */
interface LocaleMeta {
  code: string;
  label: string;
  short: string;
}

const LOCALES: readonly LocaleMeta[] = [
  { code: 'en', label: 'English', short: 'EN' },
  { code: 'ar', label: 'العربية', short: 'AR' },
  { code: 'fr', label: 'Français', short: 'FR' },
  { code: 'es', label: 'Español', short: 'ES' },
];

export function LocaleSwitcher() {
  const t = useTranslations();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // The current locale is the first path segment (/en/..., /ar/...).
  const current = LOCALES.find((l) => pathname === `/${l.code}` || pathname.startsWith(`/${l.code}/`));
  const currentCode = current?.code ?? 'en';

  // Close on click outside + Escape.
  useEffect(() => {
    if (!open) return;
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && event.target instanceof Node && !menuRef.current.contains(event.target)) {
        setOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  // Swap the locale segment in the current path; on the bare locale root just
  // switch to `/<code>`.
  const hrefFor = (code: string): string => {
    if (pathname === `/${currentCode}`) return `/${code}`;
    if (pathname.startsWith(`/${currentCode}/`)) {
      return `/${code}${pathname.slice(currentCode.length + 1)}`;
    }
    return `/${code}`;
  };

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        className="flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm transition-colors hover:bg-accent"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="true"
        aria-label={t('shell.language')}
      >
        <Globe className="size-3.5 text-muted-foreground" aria-hidden="true" />
        <span className="font-medium">{current?.short ?? 'EN'}</span>
        <ChevronDown className="size-3 text-muted-foreground" aria-hidden="true" />
      </button>

      {open && (
        <div className="absolute end-0 top-full mt-1 w-44 rounded-lg border bg-popover p-1 shadow-lg animate-fade-in">
          <p className="px-2 py-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {t('shell.language')}
          </p>
          {LOCALES.map((locale) => (
            <Link
              key={locale.code}
              href={hrefFor(locale.code)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent"
              onClick={() => setOpen(false)}
              aria-current={locale.code === currentCode ? 'true' : undefined}
            >
              <span className="flex-1 text-start">{locale.label}</span>
              {locale.code === currentCode && <Check className="size-4 shrink-0 text-primary" aria-hidden="true" />}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
