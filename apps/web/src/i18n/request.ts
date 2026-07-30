import { getRequestConfig } from 'next-intl/server';

import { routing } from './routing.js';

// Message catalog type
type Messages = Record<string, string>;

/**
 * next-intl request configuration.
 * Loads the appropriate message catalog for each locale.
 */
export default getRequestConfig(async ({ requestLocale }) => {
  // This typically corresponds to the `[locale]` segment
  let locale = await requestLocale;

  // Ensure a valid locale is used
  if (!locale || !routing.locales.includes(locale as (typeof routing.locales)[number])) {
    locale = routing.defaultLocale;
  }

  // Load messages from @modubiz/i18n workspace package
  let messages: Messages;
  try {
    messages = (await import(`@modubiz/i18n/messages/${locale}`)).default as Messages;
  } catch {
    // Fallback to English if locale messages are not found
    messages = (await import(`@modubiz/i18n/messages/en`)).default as Messages;
  }

  return {
    locale,
    messages,
  };
});
