import type { Pathnames } from 'next-intl/routing';
import { defineRouting } from 'next-intl/routing';

/**
 * Supported locales — must match packages/i18n SUPPORTED_LOCALES.
 */
export const locales = ['en', 'ar', 'fr', 'es'] as const;

/**
 * Narrow a string to a supported locale.
 */
export function isLocale(code: string): boolean {
  return locales.some((locale) => locale === code);
}

/**
 * Locale prefix strategy:
 * - Always show the locale in the URL (e.g., /en/settings, /ar/settings)
 * - No redirect from root (visitors always get redirected to their preferred locale)
 */
export const localePrefix = 'always';

/**
 * Pathname mappings for SEO and consistency.
 * Currently identity mapping; can define custom paths per locale later.
 */
export const pathnames: Pathnames<typeof locales> = {};

/**
 * Routing configuration used by middleware and navigation utilities.
 */
export const routing = defineRouting({
  locales,
  defaultLocale: 'en',
  localePrefix,
  pathnames,
});
