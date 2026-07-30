// ─── Supported locales ──────────────────────────────────────────────────────

export const SUPPORTED_LOCALES = ['en', 'ar', 'fr', 'es'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

/**
 * RTL locales — text direction can be derived from the locale code.
 */
const RTL_LOCALES: readonly string[] = ['ar', 'he', 'fa', 'ur'];

/**
 * Returns the text direction for a given locale.
 * @param locale — BCP 47 locale code
 * @returns 'rtl' for RTL locales, 'ltr' otherwise
 */
export function getLocaleDirection(locale: string): 'ltr' | 'rtl' {
  const lang = locale.split('-')[0]?.toLowerCase() ?? '';
  return RTL_LOCALES.includes(lang) ? 'rtl' : 'ltr';
}

/**
 * Locale resolution order per I18N-1:
 *   explicit request → user preference → org default → Accept-Language → 'en'
 */
export function resolveLocale(
  explicit?: string | null,
  userPreference?: string | null,
  orgDefault?: string | null,
  acceptLanguage?: string | null,
): Locale {
  const candidate =
    explicit ?? userPreference ?? orgDefault ?? acceptLanguage?.split(',')[0]?.split('-')[0]?.trim() ?? 'en';

  if (SUPPORTED_LOCALES.includes(candidate as Locale)) {
    return candidate as Locale;
  }

  // Fall back to 'en' for unsupported locales
  return 'en';
}

// ─── Number formatting ──────────────────────────────────────────────────────

/**
 * Formats a number according to the given locale.
 * @param value — Number to format
 * @param locale — BCP 47 locale
 * @param options — Intl.NumberFormat options
 */
export function formatNumber(value: number, locale: string = 'en', options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(locale.replace('_', '-'), options).format(value);
}

/**
 * Formats a monetary amount as a locale-aware string.
 * @param amountMinor — Amount in minor units (e.g., cents)
 * @param currency — ISO 4217 currency code
 * @param locale — BCP 47 locale
 */
export function formatMoney(amountMinor: bigint | number, currency: string, locale: string = 'en'): string {
  const minor = typeof amountMinor === 'number' ? BigInt(amountMinor) : amountMinor;
  const exponent = getCurrencyExponent(currency);
  const divisor = BigInt(10 ** exponent);
  const whole = minor / divisor;
  const fraction = minor % divisor;
  const value = Number(`${whole}.${fraction.toString().padStart(exponent, '0')}`);

  return new Intl.NumberFormat(locale.replace('_', '-'), {
    style: 'currency',
    currency,
    minimumFractionDigits: exponent,
    maximumFractionDigits: exponent,
  }).format(value);
}

/**
 * Formats a date according to the given locale and timezone.
 */
export function formatDate(
  date: Date,
  locale: string = 'en',
  timezone?: string,
  options?: Intl.DateTimeFormatOptions,
): string {
  return new Intl.DateTimeFormat(locale.replace('_', '-'), {
    timeZone: timezone ?? 'UTC',
    ...options,
  }).format(date);
}

// ─── Currency exponent helper ───────────────────────────────────────────────

const CURRENCY_EXPONENTS: Record<string, number> = {
  USD: 2,
  EUR: 2,
  GBP: 2,
  JPY: 0,
  KWD: 3,
  BHD: 3,
  OMR: 3,
  TND: 3,
  SAR: 2,
  AED: 2,
  EGP: 2,
};

function getCurrencyExponent(currency: string): number {
  return CURRENCY_EXPONENTS[currency.toUpperCase()] ?? 2;
}

// ─── Message catalogs ───────────────────────────────────────────────────────

export { default as en } from './messages/en/index.js';
export { default as ar } from './messages/ar/index.js';
export { default as fr } from './messages/fr/index.js';
export { default as es } from './messages/es/index.js';
