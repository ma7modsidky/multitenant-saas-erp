// Exact integer money helpers (hard rule #3 — never floating-point money).
// Every amount is a minor-units string; quantity is a decimal string
// (`numeric(18,4)` in UoM units). All math is BigInt with explicit rounding.

/** True when the value is a non-negative minor-units string. */
export function isNonNegativeMinor(value: string): boolean {
  return /^\d+$/.test(value);
}

/** True when the value is a decimal quantity string (e.g. "3.5000"). */
export function isPositiveQuantity(value: string): boolean {
  if (!/^\d+(\.\d+)?$/.test(value)) return false;
  return parseQuantity(value) > 0n;
}

export function addMinor(a: string, b: string): string {
  return (BigInt(a) + BigInt(b)).toString();
}

export function subMinor(a: string, b: string): string {
  return (BigInt(a) - BigInt(b)).toString();
}

export function sumMinor(values: string[]): string {
  return values.reduce((sum, v) => sum + BigInt(v), 0n).toString();
}

export function compareMinor(a: string, b: string): number {
  return BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0;
}

/** Parse a decimal string (e.g. "3.5000") into ×10⁴ integer units. */
export function parseQuantity(value: string): bigint {
  const [whole = '0', frac = '0'] = value.split('.');
  const fracPadded = frac.padEnd(4, '0').slice(0, 4);
  return BigInt(whole) * 10000n + BigInt(fracPadded);
}

/** Format ×10⁴ integer units back to a decimal string (e.g. "3.5000"). */
export function formatQuantity(value: bigint): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = abs / 10000n;
  const frac = (abs % 10000n).toString().padStart(4, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${frac ? `.${frac}` : ''}`;
}

/** lineTotal = (unitPrice × qty) − discount, exact, qty scaled by 10⁴. */
export function computeLineTotal(unitPrice: string, quantity: string, discount: string): string {
  const qty = parseQuantity(quantity);
  const gross = BigInt(unitPrice) * qty;
  const rounded = (gross + 5000n) / 10000n;
  const total = rounded - BigInt(discount);
  return total < 0n ? '0' : total.toString();
}

/** tax = round(lineTotal × rateBp / 10000), once per line. */
export function computeLineTax(lineTotal: string, rateBp: number): string {
  const numerator = BigInt(lineTotal) * BigInt(rateBp);
  return ((numerator + 5000n) / 10000n).toString();
}
