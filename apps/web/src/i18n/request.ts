import type { AbstractIntlMessages } from 'next-intl';
import { getRequestConfig } from 'next-intl/server';

import { routing } from './routing';

type Locale = (typeof routing.locales)[number];

// Static subpath imports. next-intl relies on the package `exports` map,
// which only exposes exact paths (`./messages/en`, ...), so a dynamic
// `import(`@modubiz/i18n/messages/${locale}`)` cannot be resolved by
// webpack and would silently fall back to English.
const catalogs: Record<Locale, () => Promise<{ default: AbstractIntlMessages }>> = {
  en: () => import('@modubiz/i18n/messages/en'),
  ar: () => import('@modubiz/i18n/messages/ar'),
  fr: () => import('@modubiz/i18n/messages/fr'),
  es: () => import('@modubiz/i18n/messages/es'),
};

/**
 * next-intl request configuration.
 * Loads the appropriate message catalog for each locale.
 */
export default getRequestConfig(async ({ locale }) => {
  // v4 passes the resolved `locale` as a plain string (`requestLocale`,
  // the promise form, is deprecated). Falls back to the default locale for
  // undefined or invalid segment values (e.g. a language selection page).
  const resolvedLocale: Locale =
    locale && routing.locales.includes(locale as Locale) ? (locale as Locale) : routing.defaultLocale;

  // Load messages from @modubiz/i18n workspace package
  const messages = (await catalogs[resolvedLocale]()).default;

  return {
    locale: resolvedLocale,
    messages,
  };
});
