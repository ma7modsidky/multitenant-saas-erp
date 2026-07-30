import createMiddleware from 'next-intl/middleware';

import { locales, localePrefix, pathnames } from './i18n/routing';

/**
 * next-intl middleware
 * Handles locale detection and redirects for all routes.
 *
 * Locale resolution order:
 *   1. Explicit locale in URL path (e.g., /en/settings, /ar/settings)
 *   2. User's preferred locale from cookie
 *   3. Browser Accept-Language header
 *   4. Default locale ('en')
 *
 * @see I18N-1 — Locale resolution order
 */
export default createMiddleware({
  locales,
  defaultLocale: 'en',
  localePrefix,
  pathnames,
  localeDetection: true,
});

export const config = {
  // Match all routes except static files and Next.js internals
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};
