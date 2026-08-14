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
export default getRequestConfig(async ({ locale, requestLocale }) => {
  // `locale` is ONLY set when an explicit override is passed to an awaitable
  // function (e.g. `getTranslations({locale})`) — on a plain request it is
  // undefined. The actual request locale arrives in the `requestLocale`
  // promise: the `[locale]` segment matched by the middleware (header
  // `X-NEXT-INTL-LOCALE`). Reading `locale` alone silently pinned the app to
  // the default locale — this is why language switching showed English.
  //
  // NOTE: `requestLocale` is marked @deprecated in 4.x (migrate to
  // next/root-params). If a future next-intl bump drops it, the middleware-
  // header mechanism is gone too — re-verify locale resolution on upgrade
  // (the 3.x → 4.x bump broke it exactly this way; see locale-journey spec).
  const requested = locale ?? (await requestLocale);

  // Falls back to the default locale for undefined or invalid values (e.g. an
  // unknown catch-all segment).
  const resolvedLocale: Locale =
    requested && routing.locales.includes(requested as Locale) ? (requested as Locale) : routing.defaultLocale;

  // Load messages from @modubiz/i18n workspace package
  const messages = (await catalogs[resolvedLocale]()).default;

  return {
    locale: resolvedLocale,
    messages,
  };
});
