/**
 * Money value object — property-based tests (CUR-4, CUR-7, CUR-8, CUR-9).
 *
 * Uses fast-check for random input generation and property verification.
 *
 * @see PLAN.md §1.7 — Money tests
 * @see BUSINESS_RULES.md
 */
import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';

import { Money, CurrencyMismatchError, getCurrencyExponent } from '../src/money.js';

// ─── Arbitraries ────────────────────────────────────────────────────────────

const currencies = fc.constantFrom('USD', 'EUR', 'GBP', 'JPY', 'KWD', 'EGP', 'SAR', 'BHD', 'OMR', 'TND', 'AED');

/** Currencies with non-zero exponents (USD, EUR, etc.) */
const nonzeroExponentCurrencies = fc.constantFrom('USD', 'EUR', 'GBP', 'KWD', 'EGP', 'SAR', 'BHD', 'OMR', 'TND', 'AED');

const smallAmount = fc.integer({ min: 0, max: 1_000_000_000 });
const positiveAmount = fc.integer({ min: 1, max: 1_000_000_000 });
const anyAmount = fc.integer({ min: -1_000_000_000, max: 1_000_000_000 });

const sameCurrencyPair = fc.record({
  a: fc.integer({ min: -100_000, max: 100_000 }),
  b: fc.integer({ min: -100_000, max: 100_000 }),
  currency: currencies,
});

const differentCurrencyPair = fc.tuple(currencies, currencies).filter(([a, b]) => a !== b);

// ─── CUR-4: Currency mismatch ───────────────────────────────────────────────

describe('CUR-4: Currency mismatch errors', () => {
  it('CUR-4: adding different currencies throws CURRENCY_MISMATCH', () => {
    fc.assert(
      fc.property(differentCurrencyPair, ([curA, curB]) => {
        const moneyA = Money.of(100n, curA as string);
        const moneyB = Money.of(200n, curB as string);

        expect(() => moneyA.add(moneyB)).toThrow(CurrencyMismatchError);
        expect(() => moneyA.add(moneyB)).toThrow(/different currencies/i);
      }),
      { numRuns: 100 },
    );
  });

  it('CUR-4: subtracting different currencies throws CURRENCY_MISMATCH', () => {
    fc.assert(
      fc.property(differentCurrencyPair, ([curA, curB]) => {
        const moneyA = Money.of(100n, curA as string);
        const moneyB = Money.of(200n, curB as string);

        expect(() => moneyA.subtract(moneyB)).toThrow(CurrencyMismatchError);
      }),
      { numRuns: 100 },
    );
  });

  it('CUR-4: comparing different currencies throws CURRENCY_MISMATCH', () => {
    fc.assert(
      fc.property(differentCurrencyPair, ([curA, curB]) => {
        const moneyA = Money.of(100n, curA as string);
        const moneyB = Money.of(200n, curB as string);

        expect(() => moneyA.equals(moneyB)).toThrow(CurrencyMismatchError);
        expect(() => moneyA.compareTo(moneyB)).toThrow(CurrencyMismatchError);
      }),
      { numRuns: 100 },
    );
  });

  it('CUR-4: same-currency operations do NOT throw', () => {
    fc.assert(
      fc.property(sameCurrencyPair, ({ a, b, currency }) => {
        const moneyA = Money.of(a, currency);
        const moneyB = Money.of(b, currency);

        expect(() => moneyA.add(moneyB)).not.toThrow();
        expect(() => moneyA.subtract(moneyB)).not.toThrow();
        expect(() => moneyA.equals(moneyB)).not.toThrow();
        expect(() => moneyA.compareTo(moneyB)).not.toThrow();
      }),
      { numRuns: 100 },
    );
  });
});

// ─── CUR-7: Rounding ────────────────────────────────────────────────────────

describe('CUR-7: Rounding matches the currency exponent', () => {
  it('CUR-7: multiply by an integer keeps exact precision', () => {
    fc.assert(
      fc.property(
        currencies,
        fc.integer({ min: -100_000_000, max: 100_000_000 }),
        fc.integer({ min: 0, max: 10 }),
        (currency, amountMinor, quantity) => {
          if (quantity === 0) return;
          const money = Money.of(amountMinor, currency);
          const result = money.multiply(quantity);
          expect(result.amountMinor).toBe(BigInt(amountMinor) * BigInt(quantity));
          expect(result.currency).toBe(currency.toUpperCase());
        },
      ),
      { numRuns: 100 },
    );
  });

  it('CUR-7: multiply by 1 returns the same value', () => {
    fc.assert(
      fc.property(currencies, anyAmount, (currency, amountMinor) => {
        const money = Money.of(amountMinor, currency);
        const result = money.multiply(1);
        expect(result.amountMinor).toBe(BigInt(amountMinor));
        expect(result.currency).toBe(currency.toUpperCase());
      }),
      { numRuns: 50 },
    );
  });

  it('CUR-7: multiply by 0 returns zero in the same currency', () => {
    fc.assert(
      fc.property(currencies, anyAmount, (currency, amountMinor) => {
        const money = Money.of(amountMinor, currency);
        const result = money.multiply(0);
        expect(result.amountMinor).toBe(0n);
        expect(result.currency).toBe(currency.toUpperCase());
      }),
      { numRuns: 50 },
    );
  });

  it('CUR-7: fromDecimal and toDecimalString round-trip preserves value', () => {
    // Use nonzero-exponent currencies only to avoid trailing dot issue with JPY
    fc.assert(
      fc.property(
        nonzeroExponentCurrencies,
        fc.integer({ min: 0, max: 999_999 }),
        fc.integer({ min: 0, max: 999 }),
        (currency, whole, fraction) => {
          const exponent = getCurrencyExponent(currency);
          const fractionStr = String(fraction).padStart(exponent, '0').slice(0, exponent);
          const decimalStr = `${whole}.${fractionStr}`;

          const money = Money.fromDecimal(decimalStr, currency);
          const resultStr = money.toDecimalString();

          expect(resultStr).toBe(decimalStr);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── CUR-8: Allocation ──────────────────────────────────────────────────────

describe('CUR-8: allocate never loses or creates minor units', () => {
  it('CUR-8: sum of allocated parts equals the original amount', () => {
    fc.assert(
      fc.property(
        currencies,
        positiveAmount,
        fc.array(fc.integer({ min: 1, max: 100 }), { minLength: 1, maxLength: 5 }),
        (currency, amountMinor, ratios) => {
          if (ratios.length === 0) return;
          const money = Money.of(amountMinor, currency);
          const parts = money.allocate(ratios);
          const sum = parts.reduce((acc, part) => acc.add(part), Money.zero(currency));
          expect(sum.amountMinor).toBe(money.amountMinor);
          expect(sum.currency).toBe(money.currency);
          for (const part of parts) {
            expect(part.currency).toBe(currency.toUpperCase());
          }
          expect(parts).toHaveLength(ratios.length);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('CUR-8: allocation with a single ratio of 1 returns the original amount', () => {
    fc.assert(
      fc.property(currencies, anyAmount, (currency, amountMinor) => {
        const money = Money.of(amountMinor, currency);
        const parts = money.allocate([1]);
        expect(parts).toHaveLength(1);
        expect(parts[0]!.amountMinor).toBe(money.amountMinor);
      }),
      { numRuns: 50 },
    );
  });

  it('CUR-8: allocation with all-zero ratios returns zero parts', () => {
    fc.assert(
      fc.property(currencies, anyAmount, (currency, amountMinor) => {
        const money = Money.of(amountMinor, currency);
        const parts = money.allocate([0, 0, 0]);
        expect(parts).toHaveLength(3);
        for (const part of parts) {
          expect(part.amountMinor).toBe(0n);
        }
      }),
      { numRuns: 50 },
    );
  });

  it('CUR-8: allocation never produces negative parts', () => {
    fc.assert(
      fc.property(
        currencies,
        positiveAmount,
        fc.array(fc.integer({ min: 1, max: 10 }), { minLength: 1, maxLength: 5 }),
        (currency, amountMinor, ratios) => {
          if (ratios.length === 0) return;
          const money = Money.of(amountMinor, currency);
          const parts = money.allocate(ratios);
          for (const part of parts) {
            expect(part.isNegative()).toBe(false);
          }
        },
      ),
      { numRuns: 50 },
    );
  });
});

// ─── CUR-9: JSON serialization ──────────────────────────────────────────────

describe('CUR-9: toJSON().amountMinor is a string, never a JS number', () => {
  it('CUR-9: amountMinor is serialized as a string', () => {
    fc.assert(
      fc.property(currencies, anyAmount, (currency, amountMinor) => {
        const money = Money.of(amountMinor, currency);
        const json = money.toJSON();
        expect(typeof json.amountMinor).toBe('string');
        expect(json.currency).toBe(currency.toUpperCase());
      }),
      { numRuns: 50 },
    );
  });

  it('CUR-9: large values survive JSON round-trip without precision loss', () => {
    const largeValues = ['9999999999999999', '1234567890123456', '99999999999', '1', '0', '-1', '-9999999999999999'];

    for (const amountStr of largeValues) {
      const amount = BigInt(amountStr);
      const money = Money.of(amount, 'USD');
      const json = money.toJSON();
      const roundTripped = JSON.parse(JSON.stringify(json));
      expect(typeof roundTripped.amountMinor).toBe('string');
      expect(roundTripped.amountMinor).toBe(amountStr);
    }
  });

  it('CUR-9: JSON serialization preserves the currency', () => {
    fc.assert(
      fc.property(currencies, smallAmount, (currency, amountMinor) => {
        const money = Money.of(amountMinor, currency);
        const json = money.toJSON();
        expect(json.currency).toBe(currency.toUpperCase());
      }),
      { numRuns: 50 },
    );
  });

  it('CUR-9: JSON.parse(JSON.stringify(money)) round-trips correctly', () => {
    fc.assert(
      fc.property(currencies, anyAmount, (currency, amountMinor) => {
        const money = Money.of(amountMinor, currency);
        const json = money.toJSON();
        const roundTripped = JSON.parse(JSON.stringify(json));
        expect(roundTripped.amountMinor).toBe(money.amountMinor.toString());
        expect(roundTripped.currency).toBe(money.currency);
      }),
      { numRuns: 50 },
    );
  });
});
