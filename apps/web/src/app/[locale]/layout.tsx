import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';

import { LocaleDirectionSync } from '@/components/locale-direction-sync';

/**
 * Locale group layout — wraps all pages within a locale.
 *
 * Provides:
 * - next-intl client context (messages)
 *
 * Auth pages (login, signup, etc.) use the (auth) route group
 * which inherits this layout automatically.
 *
 * Dashboard pages use the (dashboard) route group which adds
 * ShellLayout on top of this one.
 *
 * NOTE: This layout does NOT render <html>/<body> tags.
 * The root layout (app/layout.tsx) already provides them.
 */
export default async function LocaleLayout({ children }: { children: React.ReactNode }) {
  const messages = await getMessages();

  return (
    <NextIntlClientProvider messages={messages}>
      {/* Sync <html lang>/<html dir> on client-side locale switches — the
          root layout only sets them once from the server, so without this a
          language change keeps the old text direction until a full refresh. */}
      <LocaleDirectionSync />
      {children}
    </NextIntlClientProvider>
  );
}
