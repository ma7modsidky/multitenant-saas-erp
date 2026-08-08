/**
 * Money + quantity helpers for the inventory feature.
 *
 * Computation always happens in integer minor units (hard rule #3 — no
 * floating-point money). Quantities are decimal strings (numeric(18,4),
 * INV-15) and are compared/scaled with BigInt, never JS floats.
 *
 * These mirror the pure helpers the CRM feature owns; the inventory feature
 * keeps its own copy so features stay self-contained (no cross-feature
 * imports — same principle as the API module boundary).
 */

/** Formats minor units as a localized currency string (exponent-aware). */
export function formatMinorAmount(
  amountMinor: string,
  currency: string,
  options: { locale: string; exponent?: number },
): string {
  const exponent = options.exponent ?? 2;
  const major = Number(amountMinor) / 10 ** exponent;
  try {
    return new Intl.NumberFormat(options.locale, {
      style: 'currency',
      currency,
      maximumFractionDigits: exponent,
    }).format(major);
  } catch {
    return `${amountMinor} ${currency}`;
  }
}

/**
 * Compares two decimal-string quantities as fixed-point (4 decimals), e.g.
 * for INV-13 low-stock checks. Returns -1 / 0 / 1.
 */
export function compareQuantity(a: string, b: string): number {
  const fixed = (value: string): bigint => {
    const parts = String(value || '0').split('.');
    const whole = parts[0] ?? '0';
    const fraction = (parts[1] ?? '').padEnd(4, '0');
    const sign = whole.startsWith('-') ? '-' : '';
    const digits = `${sign}${whole.replace('-', '')}${fraction}`;
    return BigInt(digits || '0');
  };
  const left = fixed(a);
  const right = fixed(b);
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Sums minor-unit amounts (same currency) exactly. */
export function sumMinorAmounts(amounts: string[]): string {
  return amounts.reduce((total, amount) => total + BigInt(amount || '0'), 0n).toString();
}

/**
 * Sums decimal-string quantities as fixed-point (4 decimals) — the exact
 * counterpart of `compareQuantity`, so totals never touch JS floats
 * (INV-15). Returns a plain decimal string with no trailing zeros.
 */
export function sumQuantities(quantities: string[]): string {
  const fixed = (value: string): bigint => {
    const parts = String(value || '0').split('.');
    const whole = parts[0] ?? '0';
    const fraction = (parts[1] ?? '').padEnd(4, '0');
    const sign = whole.startsWith('-') ? '-' : '';
    return BigInt(`${sign}${whole.replace('-', '')}${fraction}`);
  };
  const total = quantities.reduce((sum, q) => sum + fixed(q), 0n);
  const negative = total < 0n;
  const digits = (negative ? -total : total).toString().padStart(5, '0');
  const whole = digits.slice(0, -4).replace(/^0+(?=\d)/, '') || '0';
  const fraction = digits.slice(-4).replace(/\.?0+$/, '');
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
}

/**
 * Value of a quantity at a unit cost — exact integer math (no floats).
 * Sign is preserved (`(-q) × cost = −(q × cost)`). The valuation widget only
 * feeds non-negative on-hand quantities, but the helper stays sign-correct.
 */
export function valueAtCost(quantity: string, amountMinor: string): string {
  const parts = String(quantity || '0').split('.');
  const negative = (parts[0] ?? '0').startsWith('-');
  const whole = (parts[0] ?? '0').replace('-', '');
  const fraction = (parts[1] ?? '').padEnd(4, '0');
  const scaled = BigInt(`${whole}${fraction}`) * BigInt(amountMinor || '0');
  const value = scaled / 10_000n;
  return (negative ? -value : value).toString();
}

/**
 * Per-currency stock valuation for a set of stock rows — on-hand × unit cost,
 * exact BigInt math (hard rule #3), with per-currency totals only (no invented
 * FX conversion). Returns `[currency, valueMinor]` pairs sorted by currency
 * code — the same semantics the dashboard valuation widget uses.
 */
export function sumValuationByCurrency(
  rows: Array<{ quantityOnHand: string; unitCost: { amountMinor: string; currency: string } | null }>,
): Array<[string, string]> {
  const byCurrency = new Map<string, string>();
  for (const row of rows) {
    if (row.unitCost === null) continue;
    const value = valueAtCost(row.quantityOnHand, row.unitCost.amountMinor);
    byCurrency.set(row.unitCost.currency, sumMinorAmounts([byCurrency.get(row.unitCost.currency) ?? '0', value]));
  }
  return [...byCurrency.entries()].sort(([a], [b]) => a.localeCompare(b));
}
