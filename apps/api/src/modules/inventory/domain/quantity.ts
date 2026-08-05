/**
 * Decimal-string quantity helpers.
 *
 * Stock quantities are `numeric(18,4)` (INV-15) and cross the domain boundary
 * as decimal strings — never JS numbers. All comparisons here operate on
 * integer minor units scaled to a fixed 4-decimal precision so the domain can
 * compare fractional UoM quantities without floating-point equality traps.
 */

/** Compare two decimal strings: -1 | 0 | 1. Exact — no float involved. */
export function compareQuantity(a: string, b: string): -1 | 0 | 1 {
  const aBig = toBigInt(a);
  const bBig = toBigInt(b);
  if (aBig < bBig) return -1;
  if (aBig > bBig) return 1;
  return 0;
}

export function isZeroQuantity(q: string): boolean {
  return compareQuantity(q, '0') === 0;
}

export function isNegativeQuantity(q: string): boolean {
  return q.trim().startsWith('-');
}

/** True when `available < requested` (INV-5 sales gate). */
export function isQuantityShort(available: string, requested: string): boolean {
  return compareQuantity(available, requested) < 0;
}

/** Sum two decimal strings exactly (returns a plain decimal string). */
export function addQuantity(a: string, b: string): string {
  return fromBigInt(toBigInt(a) + toBigInt(b));
}

/** a − b exactly (returns a plain decimal string). */
export function subtractQuantity(a: string, b: string): string {
  return fromBigInt(toBigInt(a) - toBigInt(b));
}

// ─── internals ──────────────────────────────────────────────────────────────

const SCALE = 10_000; // 4 decimal places (numeric(18,4))

/** Split "12.3450" → integer + fractional parts (strings, no zero-padding). */
function normalize(q: string): [string, string] {
  const [int = '0', frac = ''] = q.trim().split('.');
  return [int.replace(/^0+(?=\d)/, '') || '0', frac.replace(/0+$/, '') || '0'];
}

/** Decimal string → scaled integer BigInt (supports a leading minus). */
function toBigInt(q: string): bigint {
  const negative = q.trim().startsWith('-');
  const [int, frac] = normalize(q.replace(/^-/, ''));
  return (BigInt(int) * BigInt(SCALE) + BigInt(frac.padEnd(4, '0'))) * (negative ? -1n : 1n);
}

/** Scaled integer BigInt → plain decimal string ("12345000" → "1234.5"). */
function fromBigInt(scaled: bigint): string {
  const negative = scaled < 0n;
  const abs = negative ? -scaled : scaled;
  const whole = abs / BigInt(SCALE);
  const frac = (abs % BigInt(SCALE)).toString().padStart(4, '0').replace(/0+$/, '');
  const value = frac ? `${whole}.${frac}` : whole.toString();
  return negative ? `-${value}` : value;
}
