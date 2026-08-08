import { describe, expect, it } from 'vitest';

import { inventoryErrorKey } from '../errors';
import { compareQuantity, formatMinorAmount, sumMinorAmounts, sumValuationByCurrency, valueAtCost } from '../money';

describe('inventory quantity helpers (INV-15 — exact decimal strings)', () => {
  it('compares plain integers', () => {
    expect(compareQuantity('10', '5')).toBe(1);
    expect(compareQuantity('5', '10')).toBe(-1);
    expect(compareQuantity('5', '5')).toBe(0);
  });

  it('compares fractional quantities with different decimal places', () => {
    expect(compareQuantity('2.5', '2.4999')).toBe(1);
    expect(compareQuantity('0.0001', '0')).toBe(1);
    expect(compareQuantity('0', '0')).toBe(0);
    expect(compareQuantity('0', '0.0000')).toBe(0);
  });

  it('compares negative quantities', () => {
    expect(compareQuantity('-2', '1')).toBe(-1);
    expect(compareQuantity('-2.5', '-2.4999')).toBe(-1);
    expect(compareQuantity('-1', '-1.0000')).toBe(0);
  });
});

describe('inventory money helpers (hard rule #3 — integer math only)', () => {
  it('sums minor units exactly without floats', () => {
    expect(sumMinorAmounts(['1', '2', '3'])).toBe('6');
    expect(sumMinorAmounts([])).toBe('0');
  });

  it('computes value at cost with exact 4-decimal scaling', () => {
    // 10.0000 × 500 minor = 5000
    expect(valueAtCost('10', '500')).toBe('5000');
    // 2.5 × 400 minor = 1000
    expect(valueAtCost('2.5', '400')).toBe('1000');
    // 0.0001 × 1000000 minor = 100
    expect(valueAtCost('0.0001', '1000000')).toBe('100');
  });

  it('preserves the sign of a signed quantity', () => {
    expect(valueAtCost('-2.5', '400')).toBe('-1000');
  });

  it('formats minor units as a localized currency string', () => {
    expect(formatMinorAmount('2500', 'USD', { locale: 'en-US', exponent: 2 })).toBe('$25.00');
  });
});

describe('sumValuationByCurrency (hard rule #3 — per-currency totals, no FX)', () => {
  it('sums on-hand × unit cost per currency and sorts by currency code', () => {
    expect(
      sumValuationByCurrency([
        { quantityOnHand: '10', unitCost: { amountMinor: '500', currency: 'USD' } },
        { quantityOnHand: '2.5', unitCost: { amountMinor: '400', currency: 'USD' } },
        { quantityOnHand: '3', unitCost: { amountMinor: '700', currency: 'EUR' } },
      ]),
    ).toEqual([
      ['EUR', '2100'],
      ['USD', '6000'],
    ]);
  });

  it('ignores rows without a unit cost (never-received variants)', () => {
    expect(sumValuationByCurrency([{ quantityOnHand: '10', unitCost: null }])).toEqual([]);
  });

  it('preserves decimal precision in the per-row value', () => {
    expect(
      sumValuationByCurrency([{ quantityOnHand: '0.0001', unitCost: { amountMinor: '1000000', currency: 'USD' } }]),
    ).toEqual([['USD', '100']]);
  });
});

describe('inventoryErrorKey', () => {
  it('maps backend codes to namespace-relative i18n keys', () => {
    expect(inventoryErrorKey('INVENTORY_VARIANT_DUPLICATE_SKU')).toBe('errors.duplicateSku');
    expect(inventoryErrorKey('INVENTORY_INSUFFICIENT_STOCK')).toBe('errors.insufficientStock');
    expect(inventoryErrorKey('INVENTORY_STOCK_COUNT_APPLIED_IMMUTABLE')).toBe('errors.countApplied');
  });

  it('falls back to a generic key for unknown codes', () => {
    expect(inventoryErrorKey('SOMETHING_ELSE')).toBe('errors.unknown');
  });
});
