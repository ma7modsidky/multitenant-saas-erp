/**
 * Money helpers for the CRM frontend.
 *
 * Computation always happens in integer minor units (hard rule #3 — no
 * floating-point money). `convertMinorAmount` mirrors `Money.convertTo` in
 * `@modubiz/money` (bigint math, 6-decimal scaled rate, truncating division)
 * so the deal-form preview shows exactly what the API will store in
 * `base_amount_minor` (CRM-8/CUR-5).
 */

/** Converts a minor-unit amount using a decimal FX rate string. */
export function convertMinorAmount(amountMinor: string, rate: string): string {
  const minor = BigInt(amountMinor || '0');
  if (minor === 0n) return '0';
  const scaledRate = BigInt(Math.round(Number(rate) * 1_000_000));
  return ((minor * scaledRate) / 1_000_000n).toString();
}

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
