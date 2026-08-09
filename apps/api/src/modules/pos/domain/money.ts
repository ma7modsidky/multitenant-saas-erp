// Exact minor-unit arithmetic for the POS domain (hard rule #3).
//
// Money is ALWAYS integer minor units (bigint); quantities are plain decimal
// strings (numeric(18,4) UoM units). No floats anywhere.

/** Parse a plain decimal string into a scaled bigint (e.g. "3.5" → 35n/1). */
export function parseDecimal(value: string): { amount: bigint; scale: number } {
  const [whole = '0', fraction = ''] = value.trim().split('.');
  const scale = fraction.length;
  return {
    amount: BigInt(whole) * 10n ** BigInt(scale) + BigInt(fraction || '0'),
    scale,
  };
}

/** Parse a non-negative integer minor-units string into a bigint. */
export function parseMinor(value: string): bigint {
  if (!/^\d+$/.test(value)) {
    throw new Error(`POS money invariant: minor units must be a non-negative integer string, got "${value}"`);
  }
  return BigInt(value);
}

/** bigint → minor-units string. */
export function toMinorString(minor: bigint): string {
  return minor.toString();
}

/**
 * `amountMinor × quantity`, half-up rounded to the nearest minor unit.
 * Quantity is a decimal string (UoM units, up to 4 decimals).
 */
export function multiplyMinorByQuantity(amountMinor: bigint, quantity: string): bigint {
  const { amount, scale } = parseDecimal(quantity);
  if (scale === 0) return amountMinor * amount;
  const divisor = 10n ** BigInt(scale);
  return (amountMinor * amount + divisor / 2n) / divisor;
}

/**
 * Tax on `amountMinor` at `basisPoints` per 10,000, half-up rounded.
 * POS-17: tax is calculated per line using the line's tax rate in basis
 * points and stored on the line.
 */
export function taxInBp(amountMinor: bigint, basisPoints: number): bigint {
  if (basisPoints <= 0) return 0n;
  return (amountMinor * BigInt(basisPoints) + 5000n) / 10000n;
}

/** Σ of minor-unit strings (for cumulative refund checks — POS-21). */
export function sumMinor(...values: string[]): bigint {
  return values.reduce((acc, value) => acc + parseMinor(value), 0n);
}

/**
 * Sum decimal quantity strings exactly (POS-21 per-line cap).
 *
 * Quantities are numeric(18,4) decimal strings with VARIABLE scale, so raw
 * `parseDecimal(...).amount` values cannot be summed or compared directly
 * ('0.5' → 5@scale1 + '0.25' → 25@scale2 must be 0.75, not 30). This
 * normalizes every operand to the common max scale before summing.
 */
export function sumDecimalQuantities(...values: string[]): string {
  const parsed = values.map((v) => parseDecimal(v));
  const scale = Math.max(...parsed.map((v) => v.scale));
  const total = parsed.reduce((acc, v) => acc + v.amount * 10n ** BigInt(scale - v.scale), 0n);
  const divisor = 10n ** BigInt(scale);
  return `${total / divisor}.${String(total % divisor).padStart(scale, '0')}`;
}

/** True when decimal quantity `a` is strictly greater than `b` (exact). */
export function decimalQuantityExceeds(a: string, b: string): boolean {
  const pa = parseDecimal(a);
  const pb = parseDecimal(b);
  const scale = Math.max(pa.scale, pb.scale);
  const na = pa.amount * 10n ** BigInt(scale - pa.scale);
  const nb = pb.amount * 10n ** BigInt(scale - pb.scale);
  return na > nb;
}
