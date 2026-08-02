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
export default getRequestConfig(async ({ requestLocale }) => {
  // This typically corresponds to the `[locale]` segment
  const rawLocale = await requestLocale;

  // Ensure a valid locale is used
  const locale: Locale =
    rawLocale && routing.locales.includes(rawLocale as Locale) ? (rawLocale as Locale) : routing.defaultLocale;

  // Load messages from @modubiz/i18n workspace package
  const messages = (await catalogs[locale]()).default;

  return {
    locale,
    messages,
  };
});
