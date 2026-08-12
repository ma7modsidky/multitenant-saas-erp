/**
 * Pure formatting helpers for the audit log (entity labels, field diffs,
 * value rendering). No React, no i18n — callers pass translations in.
 */

/** Keys that add noise to an audit diff (row bookkeeping, not business data). */
const NOISE_KEYS = new Set([
  'id',
  'organizationId',
  'createdAt',
  'updatedAt',
  'createdBy',
  'updatedBy',
  'deletedAt',
  'deletionScheduledAt',
]);

/** One before/after row for a changed field. */
export interface ChangeRow {
  key: string;
  before: unknown;
  after: unknown;
}

/** Common acronyms rendered in title case for field labels (sku → SKU). */
const ACRONYMS: Record<string, string> = {
  id: 'ID',
  sku: 'SKU',
  url: 'URL',
  api: 'API',
  ip: 'IP',
  i18n: 'I18N',
  fx: 'FX',
  uom: 'UOM',
  json: 'JSON',
  pos: 'POS',
  crm: 'CRM',
};

/**
 * `amountMinor` → "Amount minor", `roleId` → "Role ID", `nameI18n` → "Name I18N".
 * Splits camelCase and snake_case into spaced, title-cased words.
 */
export function humanizeKey(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .toLowerCase()
    .split(' ')
    .filter((w) => w.length > 0);
  if (words.length === 0) return key;
  return words
    .map((w) => ACRONYMS[w] ?? (w.length > 1 ? w.charAt(0).toUpperCase() + w.slice(1) : w.toUpperCase()))
    .join(' ');
}

/** Money envelope `{ currency, amountMinor }` (DATA_MODEL §5 — minor units). */
export function isMoneyValue(value: unknown): value is { currency: string; amountMinor: string | number } {
  if (typeof value !== 'object' || value === null) return false;
  // `in` narrowing on `object` yields `object & Record<key, unknown>` — no casts.
  if (!('currency' in value) || !('amountMinor' in value)) return false;
  return (
    typeof value.currency === 'string' &&
    (typeof value.amountMinor === 'string' || typeof value.amountMinor === 'number')
  );
}

/** Currency exponents for minor-unit → major-unit conversion (mirrors @modubiz/i18n). */
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

/** "180 USD" → "$1.80" (locale-aware, exponent-aware). Never toFixed on money. */
export function formatMinorCurrency(amountMinor: string | number, currency: string, locale: string): string {
  const exponent = CURRENCY_EXPONENTS[currency.toUpperCase()] ?? 2;
  const value = Number(amountMinor) / 10 ** exponent;
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: exponent,
      maximumFractionDigits: exponent,
    }).format(value);
  } catch {
    return `${amountMinor} ${currency}`;
  }
}

/** Full ISO datetime or date-only strings → localized date/time. */
function formatIso(value: string, locale: string): string | null {
  const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const isDateTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value);
  if (!isDateOnly && !isDateTime) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return isDateOnly ? date.toLocaleDateString(locale) : date.toLocaleString(locale);
}

/**
 * Render a snapshot value the way an operator expects:
 * money → "$1.80", ISO dates → localized, booleans → Yes/No,
 * objects → compact JSON (expanded in the raw view), else as-is.
 */
export function formatValue(value: unknown, locale: string, labels: { yes: string; no: string }): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? labels.yes : labels.no;
  if (isMoneyValue(value)) return formatMinorCurrency(value.amountMinor, value.currency, locale);
  if (typeof value === 'string') {
    const formattedDate = formatIso(value, locale);
    return formattedDate ?? value;
  }
  if (typeof value === 'number') return String(value);
  return JSON.stringify(value);
}

/**
 * Changed fields for an entry.
 *
 * The `after` snapshot is the request patch (UPDATE) or the full body
 * (CREATE); the `before` snapshot is the pre-mutation row. Diff semantics:
 *   - before + after: the patch keys ARE the change set — compare old → new
 *     and drop keys whose value didn't actually change.
 *   - after only:     list the recorded fields.
 *   - before only:    list the pre-mutation state (e.g. delete/void).
 */
export function changedFields(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): ChangeRow[] {
  if (!before && !after) return [];
  const source = after ?? before;
  if (!source) return [];
  const serialize = (v: unknown): string => JSON.stringify(v ?? null);

  return Object.keys(source)
    .filter((key) => !NOISE_KEYS.has(key))
    .map((key) => ({ key, before: before?.[key] ?? null, after: after?.[key] ?? null }))
    .filter((row) => (before && after ? serialize(row.before) !== serialize(row.after) : true));
}

/** "3a2f9c1e-…" — keep the table scannable; the full id rides in the title. */
export function shortId(id: string): string {
  return id.length > 11 ? `${id.slice(0, 8)}…` : id;
}

/** Localized entity label; unknown types fall back to a humanized form. */
export function entityLabel(t: { has(key: string): boolean; (key: string): string }, type: string): string {
  const key = `audit.entities.${type}`;
  return t.has(key) ? t(key) : humanizeKey(type);
}
