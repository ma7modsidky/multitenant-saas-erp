/**
 * Display helpers for translatable names (`name_i18n` jsonb).
 *
 * POS lines snapshot the product/variant name at sale time (POS-12); the UI
 * resolves those snapshots for the current locale, falling back to `en`.
 */

/** Resolves a translatable name for the active locale, falling back to `en`. */
export function localizedLabel(
  nameI18n: Record<string, string> | null | undefined,
  locale: string,
  fallback = '—',
): string {
  if (!nameI18n) return fallback;
  return nameI18n[locale] ?? nameI18n.en ?? fallback;
}

/** `Name (SKU)` for cart rows and sale-line tables. */
export function variantLabel(
  nameI18n: Record<string, string> | null | undefined,
  sku: string | null | undefined,
  locale: string,
): string {
  const name = localizedLabel(nameI18n, locale);
  return sku ? `${name} (${sku})` : name;
}
