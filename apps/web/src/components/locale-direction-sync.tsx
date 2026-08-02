'use client';

import { useLocale } from 'next-intl';
import { useEffect } from 'react';

/**
 * LocaleDirectionSync — keeps the `<html lang>` and `dir` attributes in sync
 * with the active locale on the CLIENT.
 *
 * The root layout (app/layout.tsx) sets lang/dir from getLocale() on the
 * server, but a client-side locale switch (e.g. via the LocaleSwitcher Link)
 * does not re-render the root layout's <html> element. Without this sync the
 * page content would switch language while the layout stayed LTR (for ar) or
 * RTL (for en/fr/es) until a full refresh. This effect fixes the direction on
 * every locale change.
 *
 * Direction rule mirrors app/layout.tsx exactly (ar → rtl, everything else →
 * ltr). Kept inline instead of importing @modubiz/i18n's getLocaleDirection:
 * that package's barrel re-exports all four message catalogs, and this
 * component runs on every page — no need to ship them here.
 */
export function LocaleDirectionSync() {
  const locale = useLocale();

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = locale.startsWith('ar') ? 'rtl' : 'ltr';
  }, [locale]);

  return null;
}
