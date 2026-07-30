import { Injectable } from '@nestjs/common';
import {
  resolveLocale,
  formatNumber,
  formatMoney,
  formatDate,
  getLocaleDirection,
  SUPPORTED_LOCALES,
} from '@modubiz/i18n';

export type Locale = (typeof SUPPORTED_LOCALES)[number];

/**
 * I18nService — provides locale resolution and formatting services
 * for the API layer, wrapping @modubiz/i18n.
 *
 * Locale resolution order (I18N-1):
 *   1. Explicit request (from header or query param)
 *   2. User preference (from session/profile)
 *   3. Organization default
 *   4. Accept-Language header
 *   5. 'en' (fallback)
 *
 * @see PLAN.md §1.8 — i18n
 * @see BUSINESS_RULES.md — I18N-1, I18N-4, I18N-7
 */
@Injectable()
export class I18nService {
  /**
   * Resolve the effective locale for the current request.
   *
   * @see I18N-1 — Locale resolution order
   */
  resolve(
    explicit?: string | null,
    userPreference?: string | null,
    orgDefault?: string | null,
    acceptLanguage?: string | null,
  ): Locale {
    return resolveLocale(explicit, userPreference, orgDefault, acceptLanguage) as Locale;
  }

  /**
   * Get the text direction for a locale.
   */
  getDirection(locale: string): 'ltr' | 'rtl' {
    return getLocaleDirection(locale);
  }

  /**
   * Format a number according to locale.
   *
   * @see I18N-7 — Formatters produce locale-correct output
   */
  formatNumber(value: number, locale: string = 'en', options?: Intl.NumberFormatOptions): string {
    return formatNumber(value, locale, options);
  }

  /**
   * Format a monetary amount according to locale and currency.
   *
   * @see I18N-7 — Formatters produce locale-correct output
   */
  formatMoney(amountMinor: bigint | number, currency: string, locale: string = 'en'): string {
    return formatMoney(amountMinor, currency, locale);
  }

  /**
   * Format a date according to locale and timezone.
   *
   * @see I18N-7 — Formatters produce locale-correct output
   */
  formatDate(date: Date, locale: string = 'en', timezone?: string, options?: Intl.DateTimeFormatOptions): string {
    return formatDate(date, locale, timezone, options);
  }

  /**
   * Check if a locale is supported.
   */
  isSupported(locale: string): boolean {
    return (SUPPORTED_LOCALES as readonly string[]).includes(locale);
  }

  /**
   * Get all supported locale codes.
   */
  getSupportedLocales(): readonly string[] {
    return SUPPORTED_LOCALES;
  }
}
