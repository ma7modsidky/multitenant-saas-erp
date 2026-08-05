import { describe, expect, it } from 'vitest';

import { convertMinorAmount, formatMinorAmount } from '../money';

describe('CRM frontend money helpers (CUR-5/CRM-8 deal preview)', () => {
  it('converts minor units with the 6-decimal scaled rate (matches Money.convertTo)', () => {
    // 100.00 EUR × 0.916667 → 91.6667 → truncated to 91.66 (USD minor units).
    expect(convertMinorAmount('10000', '0.916667')).toBe('9166');
  });

  it('keeps the amount unchanged at a 1:1 rate', () => {
    expect(convertMinorAmount('500', '1')).toBe('500');
  });

  it('truncates rather than rounds the converted amount', () => {
    // 1 × 0.333333 → 0.333333 → 0 (bigint division truncates toward zero).
    expect(convertMinorAmount('1', '0.333333')).toBe('0');
  });

  it('handles a zero amount without division by zero', () => {
    expect(convertMinorAmount('0', '0.916667')).toBe('0');
  });

  it('formats minor units as a localized currency (exponent-aware)', () => {
    expect(formatMinorAmount('10000', 'USD', { locale: 'en-US' })).toBe('$100.00');
    expect(formatMinorAmount('100', 'JPY', { locale: 'en-US', exponent: 0 })).toBe('¥100');
    expect(formatMinorAmount('12345', 'USD', { locale: 'en-US' })).toBe('$123.45');
  });
});
