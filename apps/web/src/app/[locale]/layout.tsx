import { NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations } from 'next-intl/server';

/**
 * Locale group layout — wraps all pages within a locale.
 *
 * Provides:
 * - next-intl client context (messages)
 * - App shell structure (topbar, sidebar, main content)
 *
 * NOTE: This layout does NOT render <html>/<body> tags.
 * The root layout (app/layout.tsx) already provides them.
 * The `lang` and `dir` attributes are set on the root layout
 * based on the locale cookie via next-intl middleware.
 *
 * Modules add their own routes under their locale path:
 *   /[locale]/m/crm/...
 *   /[locale]/m/inventory/...
 *   /[locale]/m/pos/...
 */
export default async function LocaleLayout({ children }: { children: React.ReactNode }) {
  const messages = await getMessages();
  const t = await getTranslations({ namespace: 'nav' });

  return (
    <NextIntlClientProvider messages={messages}>
      <div className="flex min-h-screen flex-col">
        {/* Topbar placeholder */}
        <header className="sticky top-0 z-50 h-14 border-b bg-background">
          <div className="flex h-full items-center px-4">
            <span className="text-lg font-semibold">ModuBiz</span>
            <nav className="ms-auto flex items-center gap-4 text-sm text-muted-foreground">
              <span>{t('dashboard')}</span>
              <span>{t('settings')}</span>
            </nav>
          </div>
        </header>

        {/* Main content */}
        <main className="flex-1 p-6">
          <div className="mx-auto max-w-7xl">{children}</div>
        </main>
      </div>
    </NextIntlClientProvider>
  );
}
