import { describe, expect, it } from 'vitest';

import { posErrorKey } from '../errors';
import {
  formatMinorAmount,
  lineTotalMinor,
  prorateRefundAmount,
  scaleQuantity,
  subtractMinorAmounts,
  sumMinorAmounts,
  unscaleQuantity,
} from '../money';

describe('pos money helpers (hard rule #3 — integer math only)', () => {
  it('scales and unscales decimal quantities at 4 decimals', () => {
    expect(scaleQuantity('10')).toBe(100000n);
    expect(scaleQuantity('2.5')).toBe(25000n);
    expect(scaleQuantity('0.0001')).toBe(1n);
    expect(scaleQuantity('0')).toBe(0n);
    expect(unscaleQuantity(100000n)).toBe('10');
    expect(unscaleQuantity(25000n)).toBe('2.5');
    expect(unscaleQuantity(1n)).toBe('0.0001');
    expect(unscaleQuantity(0n)).toBe('0');
  });

  it('sums and subtracts minor units exactly', () => {
    expect(sumMinorAmounts(['1', '2', '3'])).toBe('6');
    expect(sumMinorAmounts([])).toBe('0');
    expect(subtractMinorAmounts('1000', '250')).toBe('750');
    expect(subtractMinorAmounts('100', '250')).toBe('-150');
  });

  it('computes line totals as unit price × quantity (exact scaling)', () => {
    // 1 × 2500 = 2500
    expect(lineTotalMinor('2500', '1')).toBe('2500');
    // 2.5 × 400 = 1000
    expect(lineTotalMinor('400', '2.5')).toBe('1000');
    // 0.0001 × 1000000 = 100
    expect(lineTotalMinor('1000000', '0.0001')).toBe('100');
    // 3 × 0 = 0
    expect(lineTotalMinor('0', '3')).toBe('0');
  });

  it('prorates a refund amount to the refunded quantity (rounds down, never exceeds)', () => {
    // Full refund of a 2500 line = 2500
    expect(prorateRefundAmount('2500', '1', '1')).toBe('2500');
    // Half of a 1000 line = 500
    expect(prorateRefundAmount('1000', '2', '1')).toBe('500');
    // 1 of 3 at 1000 = 333 (333.33 rounds DOWN)
    expect(prorateRefundAmount('1000', '3', '1')).toBe('333');
    // Prorating with fractional quantities: 0.5 of 2.5 at 1000 = 200
    expect(prorateRefundAmount('1000', '2.5', '0.5')).toBe('200');
  });

  it('formats minor units as a localized currency string', () => {
    expect(formatMinorAmount('2500', 'USD', { locale: 'en-US', exponent: 2 })).toBe('$25.00');
  });
});

describe('posErrorKey', () => {
  it('maps backend codes to namespace-relative i18n keys', () => {
    expect(posErrorKey('POS_NO_OPEN_SHIFT')).toBe('errors.noOpenShift');
    expect(posErrorKey('POS_REFUND_REQUIRES_OPEN_SHIFT')).toBe('errors.refundRequiresOpenShift');
    expect(posErrorKey('POS_REFUND_EXCEEDS_SALE')).toBe('errors.refundExceedsSale');
    expect(posErrorKey('POS_REGISTER_DUPLICATE_CODE')).toBe('errors.duplicateRegisterCode');
    expect(posErrorKey('POS_SALE_NOT_VOIDABLE')).toBe('errors.saleNotVoidable');
    expect(posErrorKey('INVENTORY_INSUFFICIENT_STOCK')).toBe('errors.insufficientStock');
    expect(posErrorKey('POS_SALE_NOT_FOUND')).toBe('errors.notFound');
  });

  it('falls back to a generic key for unknown codes', () => {
    expect(posErrorKey('SOMETHING_ELSE')).toBe('errors.unknown');
  });
});
