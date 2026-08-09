/**
 * Money + quantity helpers for the POS feature.
 *
 * Computation always happens in integer minor units (hard rule #3 — no
 * floating-point money). Quantities are decimal strings (numeric(18,4),
 * INV-15/POS-17) and are compared/scaled with BigInt, never JS floats.
 *
 * These mirror the pure helpers the inventory feature owns; the POS feature
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

/** Sums minor-unit amounts (same currency) exactly. */
export function sumMinorAmounts(amounts: string[]): string {
  return amounts.reduce((total, amount) => total + BigInt(amount || '0'), 0n).toString();
}

/** Exact subtraction of minor units: `a - b`. */
export function subtractMinorAmounts(a: string, b: string): string {
  return (BigInt(a || '0') - BigInt(b || '0')).toString();
}

/**
 * Scales a decimal-string quantity to fixed-point 4 decimals as a BigInt —
 * the exact counterpart of the API's numeric(18,4) UoM units (INV-15).
 */
export function scaleQuantity(quantity: string): bigint {
  const parts = String(quantity || '0').split('.');
  const whole = parts[0] ?? '0';
  const fraction = (parts[1] ?? '').padEnd(4, '0');
  const sign = whole.startsWith('-') ? '-' : '';
  return BigInt(`${sign}${whole.replace('-', '')}${fraction}`);
}

/** Formats a scaled quantity back to a plain decimal string (no trailing zeros). */
export function unscaleQuantity(scaled: bigint): string {
  const negative = scaled < 0n;
  const digits = (negative ? -scaled : scaled).toString().padStart(5, '0');
  const whole = digits.slice(0, -4).replace(/^0+(?=\d)/, '') || '0';
  const fraction = digits.slice(-4).replace(/\.?0+$/, '');
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
}

/**
 * Line total for a cart line — unit price (minor units) × quantity, exact
 * integer math. Quantity is decimal-string; the price is per ONE UoM unit.
 */
export function lineTotalMinor(unitPriceAmountMinor: string, quantity: string): string {
  return ((BigInt(unitPriceAmountMinor || '0') * scaleQuantity(quantity)) / 10_000n).toString();
}

/**
 * Refund proration — the portion of a sale line's total being refunded:
 * `lineTotal × (refundQty / lineQty)`, rounded DOWN to minor units (POS-21
 * cumulative caps are enforced server-side; rounding down can never exceed
 * the original line total).
 */
export function prorateRefundAmount(lineTotalAmountMinor: string, lineQty: string, refundQty: string): string {
  const total = BigInt(lineTotalAmountMinor || '0');
  const lineQtyScaled = scaleQuantity(lineQty);
  const refundQtyScaled = scaleQuantity(refundQty);
  if (lineQtyScaled <= 0n) return '0';
  return ((total * refundQtyScaled) / lineQtyScaled).toString();
}
