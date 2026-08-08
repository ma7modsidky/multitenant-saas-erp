/**
 * Display helpers for translatable names (`name_i18n` jsonb).
 *
 * Products store their name per locale; the UI falls back locale → en → a
 * caller-provided fallback (usually the SKU or an em dash).
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

/** `Name (SKU)` for variant pickers and table rows. */
export function variantLabel(
  nameI18n: Record<string, string> | null | undefined,
  sku: string | null | undefined,
  locale: string,
): string {
  const name = localizedLabel(nameI18n, locale);
  return sku ? `${name} (${sku})` : name;
}
