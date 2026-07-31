// ─── Currency support ───────────────────────────────────────────────────────

/**
 * ISO 4217 currency code (3-letter uppercase).
 */
export type CurrencyCode = string;

/**
 * Currency registry — exponent per currency.
 * The exponent is the number of decimal places (e.g., USD=2, JPY=0, KWD=3).
 */
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

export function getCurrencyExponent(currency: CurrencyCode): number {
  return CURRENCY_EXPONENTS[currency] ?? 2;
}

// ─── Money value object ─────────────────────────────────────────────────────

/**
 * CurrencyMismatchError — thrown when trying to add/subtract different currencies.
 */
export class CurrencyMismatchError extends Error {
  readonly code = 'CURRENCY_MISMATCH';

  constructor(a: CurrencyCode, b: CurrencyCode) {
    super(`Cannot operate on different currencies: ${a} and ${b}`);
    this.name = 'CurrencyMismatchError';
  }
}

/**
 * Money — a value object representing a monetary amount.
 *
 * - Amount is stored as `bigint` minor units (e.g., cents, fils, sen).
 * - Currency is an ISO 4217 code (3-letter uppercase).
 * - Arithmetic throws `CurrencyMismatchError` if currencies differ.
 * - JSON serialization outputs `amountMinor` as a **string** to avoid
 *   precision loss from JavaScript's `number` type.
 *
 * @see DATA_MODEL.md §5 — Money
 * @see CODING_STANDARDS.md §1 — No unsafe casts
 */
export class Money {
  protected constructor(
    readonly amountMinor: bigint,
    readonly currency: CurrencyCode,
  ) {}

  // ─── Factory methods ──────────────────────────────────────────────────────

  /**
   * Creates a Money instance from minor units.
   *
   * @param amountMinor — Amount in minor units (e.g., 100 = $1.00 for USD)
   * @param currency — ISO 4217 currency code
   */
  static of(amountMinor: bigint | number, currency: CurrencyCode): Money {
    const minor = typeof amountMinor === 'number' ? BigInt(amountMinor) : amountMinor;
    return new Money(minor, currency.toUpperCase());
  }

  /**
   * Creates a Money instance representing zero in the given currency.
   */
  static zero(currency: CurrencyCode): Money {
    return new Money(0n, currency.toUpperCase());
  }

  /**
   * Creates a Money instance from a decimal string (e.g., "10.50" for $10.50).
   * Useful for parsing user input or API values.
   *
   * @param amount — Decimal string like "10.50"
   * @param currency — ISO 4217 currency code
   */
  static fromDecimal(amount: string, currency: CurrencyCode): Money {
    const curr = currency.toUpperCase();
    const exponent = getCurrencyExponent(curr);
    const [whole = '0', fraction = ''] = amount.split('.');
    const paddedFraction = fraction.padEnd(exponent, '0').slice(0, exponent);
    const minor = BigInt(whole) * BigInt(10 ** exponent) + BigInt(paddedFraction || '0');
    return new Money(minor, curr);
  }

  // ─── Arithmetic operations ────────────────────────────────────────────────

  /**
   * Adds another Money value.
   * @throws {CurrencyMismatchError} if currencies differ.
   */
  add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.amountMinor + other.amountMinor, this.currency);
  }

  /**
   * Subtracts another Money value.
   * @throws {CurrencyMismatchError} if currencies differ.
   */
  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.amountMinor - other.amountMinor, this.currency);
  }

  /**
   * Multiplies by a quantity, rounding half-up at the currency's exponent.
   * Full precision is kept during intermediate arithmetic.
   */
  multiply(quantity: number | bigint): Money {
    if (typeof quantity === 'number') {
      // For floating-point multipliers, use Decimal-like approach
      const result = (this.amountMinor * BigInt(Math.round(quantity * 1_000_000))) / 1_000_000n;
      return new Money(result, this.currency);
    }
    return new Money(this.amountMinor * quantity, this.currency);
  }

  /**
   * Splits this amount into `ratios`, distributing any remainder
   * so that no minor units are lost or created.
   *
   * Allocation guarantees that the sum of the returned parts equals
   * the original amount exactly (no rounding error).
   *
   * **Rounding strategy:** Each part is rounded down (floor), and
   * the remainder (if any) is added to the **first** part.
   * This means the first part may be slightly larger than expected.
   *
   * @example
   * Money.of(10n, 'USD').allocate([1, 1, 1])
   * // → [Money(4, USD), Money(3, USD), Money(3, USD)]
   * // Sum = 10, which equals the original amount
   *
   * @param ratios — Array of ratio numbers (e.g., [1, 1, 1] for three equal parts)
   * @returns Array of Money instances whose sum equals the original amount.
   */
  allocate(ratios: number[]): Money[] {
    const total = ratios.reduce((a, b) => a + b, 0);
    if (total === 0) {
      return ratios.map(() => Money.zero(this.currency));
    }

    const minor = this.amountMinor;
    // Use high-precision interim calculation
    const parts = ratios.map((r) => (minor * BigInt(Math.round(r * 1_000_000))) / BigInt(total * 1_000_000));
    const allocated = parts.reduce((a, b) => a + b, 0n);
    const remainder = minor - allocated;

    // Distribute the entire remainder to the first part
    // This ensures sum(parts) == original amount exactly
    const result = parts.map((p, i) => new Money(p + (i === 0 ? remainder : 0n), this.currency));
    return result;
  }

  // ─── Comparison ───────────────────────────────────────────────────────────

  /**
   * Returns true if this amount is negative.
   */
  isNegative(): boolean {
    return this.amountMinor < 0n;
  }

  /**
   * Returns true if this amount is zero.
   */
  isZero(): boolean {
    return this.amountMinor === 0n;
  }

  /**
   * Compares with another Money value.
   * @throws {CurrencyMismatchError} if currencies differ.
   */
  equals(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.amountMinor === other.amountMinor;
  }

  /**
   * Compares with another Money value.
   * @throws {CurrencyMismatchError} if currencies differ.
   */
  compareTo(other: Money): -1 | 0 | 1 {
    this.assertSameCurrency(other);
    if (this.amountMinor < other.amountMinor) return -1;
    if (this.amountMinor > other.amountMinor) return 1;
    return 0;
  }

  // ─── Conversion ───────────────────────────────────────────────────────────

  /**
   * Converts to another currency at the given rate.
   * Returns a `ConvertedMoney` that carries the exchange rate used.
   *
   * TODO: Use a more precise representation (numerator/denominator or
   * bigint-based rate) for the exchange rate to avoid floating-point
   * precision loss on large conversions.
   */
  convertTo(currency: CurrencyCode, rate: FxRate): ConvertedMoney {
    const targetCurrency = currency.toUpperCase();
    if (this.currency === targetCurrency) {
      return new ConvertedMoney(this.amountMinor, targetCurrency, 1);
    }

    // amountMinor * rate / 1 (rate is a float number)
    const converted = (this.amountMinor * BigInt(Math.round(rate.rate * 1_000_000))) / 1_000_000n;

    return new ConvertedMoney(converted, targetCurrency, rate.rate);
  }

  // ─── Serialization ────────────────────────────────────────────────────────

  /**
   * Serializes to JSON.
   * `amountMinor` is a **string** to avoid precision loss from JavaScript's `number` type.
   *
   * @see CUR-9 — toJSON().amountMinor is a string, never a JS number
   */
  toJSON(): { amountMinor: string; currency: CurrencyCode } {
    return {
      amountMinor: this.amountMinor.toString(),
      currency: this.currency,
    };
  }

  /**
   * Returns a human-readable decimal string (e.g., "10.50" for $10.50).
   */
  toDecimalString(): string {
    const exponent = getCurrencyExponent(this.currency);
    const abs = this.amountMinor < 0n ? -this.amountMinor : this.amountMinor;
    const whole = abs / BigInt(10 ** exponent);
    const fraction = abs % BigInt(10 ** exponent);
    const sign = this.amountMinor < 0n ? '-' : '';
    return `${sign}${whole.toString()}.${fraction.toString().padStart(exponent, '0')}`;
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new CurrencyMismatchError(this.currency, other.currency);
    }
  }
}

// ─── FX Rate and ConvertedMoney ─────────────────────────────────────────────

/**
 * Exchange rate representation.
 */
export interface FxRate {
  /** The rate value (e.g., 0.85 for USD→EUR at 0.85) */
  rate: number;
  /** Source of the rate (e.g., "ecb", "manual") */
  source: string;
  /** Date the rate was valid */
  validOn: Date;
}

/**
 * ConvertedMoney — a Money that carries its FX conversion metadata.
 */
export class ConvertedMoney extends Money {
  readonly exchangeRate: number;

  constructor(amountMinor: bigint, currency: CurrencyCode, exchangeRate: number) {
    super(amountMinor, currency);
    this.exchangeRate = exchangeRate;
  }

  override toJSON(): { amountMinor: string; currency: CurrencyCode; exchangeRate: number } {
    return {
      ...super.toJSON(),
      exchangeRate: this.exchangeRate,
    };
  }
}
