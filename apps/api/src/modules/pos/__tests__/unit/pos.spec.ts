import { describe, expect, it } from 'vitest';

import {
  PAYMENT_METHOD,
  POS_ERROR_CODE,
  Refund,
  SALE_STATUS,
  SHIFT_STATUS,
  Sale,
  Shift,
  decimalQuantityExceeds,
  multiplyMinorByQuantity,
  sumDecimalQuantities,
  taxInBp,
  PosError,
} from '../../domain/index.js';

/** Assert that `action` throws a PosError carrying `expectedCode`. */
function expectPosError(action: () => void, expectedCode: string): void {
  try {
    action();
    expect.fail('Expected PosError to be thrown');
  } catch (error) {
    expect(error).toBeInstanceOf(PosError);
    expect((error as PosError).code).toBe(expectedCode);
  }
}

const ORG = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const SHIFT = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const REGISTER = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const USER = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

function line(overrides: Partial<Parameters<typeof Sale.create>[0]['lines'][number]> = {}) {
  return {
    variantId: '11111111-1111-1111-1111-111111111111',
    sku: 'ESP-001',
    nameI18n: { en: 'Espresso' },
    quantity: '2',
    unitPriceAmountMinor: '500', // $5.00
    lineDiscountAmountMinor: '0',
    taxRateBp: 700, // 7%
    currency: 'USD',
    ...overrides,
  };
}

function cashPayment(
  amountMinor: string,
  overrides: Partial<Parameters<typeof Sale.create>[0]['payments'][number]> = {},
) {
  return {
    method: PAYMENT_METHOD.CASH,
    amountMinor,
    currency: 'USD',
    tenderedAmountMinor: amountMinor,
    ...overrides,
  };
}

function buildSale(overrides: Partial<Parameters<typeof Sale.create>[0]> = {}) {
  return Sale.create({
    id: 'sale-1',
    organizationId: ORG,
    shiftId: SHIFT,
    registerId: REGISTER,
    receiptNumber: 'R-0001',
    currency: 'USD',
    locale: 'en',
    lines: [line()],
    payments: [cashPayment('1070')], // 2 × $5 = $10.00 + 7% tax = $10.70
    soldAt: new Date('2026-08-05T09:00:00.000Z'),
    createdAt: new Date('2026-08-05T09:00:00.000Z'),
    createdBy: USER,
    ...overrides,
  });
}

// ─── Shift (POS-2, POS-4, POS-5, POS-6) ─────────────────────────────────────

describe('Shift', () => {
  function openShift() {
    return Shift.create({
      id: 'shift-1',
      organizationId: ORG,
      registerId: REGISTER,
      openedBy: USER,
      openedAt: new Date('2026-08-05T08:00:00.000Z'),
      openingFloatAmountMinor: '20000',
      closedBy: null,
      closedAt: null,
      countedCashAmountMinor: null,
      expectedCashAmountMinor: null,
      varianceAmountMinor: null,
      currency: 'USD',
      status: SHIFT_STATUS.OPEN,
      forcedClose: false,
      createdAt: new Date('2026-08-05T08:00:00.000Z'),
      updatedAt: new Date('2026-08-05T08:00:00.000Z'),
      createdBy: USER,
      updatedBy: USER,
    });
  }

  it('POS-4: opening records the float and the operator', () => {
    const shift = openShift();
    expect(shift.openingFloatAmountMinor).toBe('20000');
    expect(shift.openedBy).toBe(USER);
    expect(shift.status).toBe(SHIFT_STATUS.OPEN);
  });

  it('POS-5: close computes expected = float + cash sales − refunds and variance', () => {
    const shift = openShift();
    shift.close({
      countedCashAmountMinor: '49500',
      cashSalesAmountMinor: '35000',
      cashRefundsAmountMinor: '5000',
      forcedClose: false,
      closedBy: USER,
      now: new Date('2026-08-05T18:00:00.000Z'),
    });
    // expected = 20000 + 35000 − 5000 = 50000; variance = 49500 − 50000 = −500.
    expect(shift.expectedCashAmountMinor).toBe('50000');
    expect(shift.varianceAmountMinor).toBe('-500');
    expect(shift.status).toBe(SHIFT_STATUS.CLOSED);
  });

  it('POS-6: a closed shift is immutable — closing twice throws', () => {
    const shift = openShift();
    const input = {
      countedCashAmountMinor: '50000',
      cashSalesAmountMinor: '30000',
      cashRefundsAmountMinor: '0',
      forcedClose: false,
      closedBy: USER,
      now: new Date('2026-08-05T18:00:00.000Z'),
    };
    shift.close(input);
    expectPosError(() => shift.close(input), POS_ERROR_CODE.SHIFT_CLOSED_IMMUTABLE);
  });

  it('POS-3: selling without an open shift is rejected', () => {
    const shift = openShift();
    shift.close({
      countedCashAmountMinor: '50000',
      cashSalesAmountMinor: '30000',
      cashRefundsAmountMinor: '0',
      forcedClose: false,
      closedBy: USER,
      now: new Date('2026-08-05T18:00:00.000Z'),
    });
    expectPosError(() => shift.assertOpen(), POS_ERROR_CODE.NO_OPEN_SHIFT);
  });
});

// ─── Sale (POS-10, POS-11, POS-16, POS-17) ─────────────────────────────────

describe('Sale', () => {
  it('POS-17: tax is per line at the line rate; sale tax = Σ line taxes', () => {
    const sale = buildSale();
    // line subtotal = 2 × 500 = 1000; tax = 1000 × 7% = 70; total = 1070.
    expect(sale.subtotalAmountMinor).toBe('1000');
    expect(sale.taxAmountMinor).toBe('70');
    expect(sale.totalAmountMinor).toBe('1070');
    expect(sale.lines[0]!.taxAmountMinor).toBe('70');
  });

  it('POS-16: a line discount cannot exceed the line subtotal', () => {
    expectPosError(
      () => buildSale({ lines: [line({ unitPriceAmountMinor: '100', lineDiscountAmountMinor: '250' })] }),
      POS_ERROR_CODE.DISCOUNT_EXCEEDS_SUBTOTAL,
    );
  });

  it('POS-11: rejects a line in a different currency', () => {
    expectPosError(() => buildSale({ lines: [line({ currency: 'EUR' })] }), POS_ERROR_CODE.CURRENCY_MISMATCH);
  });

  it('POS-11: rejects a payment in a different currency', () => {
    expectPosError(
      () => buildSale({ payments: [cashPayment('1070', { currency: 'EUR' })] }),
      POS_ERROR_CODE.CURRENCY_MISMATCH,
    );
  });

  it('POS-10: completes only when payments equal the total', () => {
    expectPosError(() => buildSale({ payments: [cashPayment('1000')] }), POS_ERROR_CODE.PAYMENTS_DO_NOT_EQUAL_TOTAL);
  });

  it('POS-10: overpayment is cash tendered with change due, never inflated', () => {
    const sale = buildSale({ payments: [cashPayment('1070', { tenderedAmountMinor: '2000' })] });
    expect(sale.payments[0]!.amountMinor).toBe('1070');
    expect(sale.payments[0]!.changeAmountMinor).toBe('930');
  });

  it('POS-10: rejects a tender that does not cover the payment', () => {
    expectPosError(
      () => buildSale({ payments: [cashPayment('1070', { tenderedAmountMinor: '500' })] }),
      POS_ERROR_CODE.PAYMENTS_DO_NOT_EQUAL_TOTAL,
    );
  });

  it('POS-12: lines carry SKU and name snapshots for reproducible receipts', () => {
    const sale = buildSale();
    expect(sale.lines[0]!.skuSnapshot).toBe('ESP-001');
    expect(sale.lines[0]!.nameSnapshot).toEqual({ en: 'Espresso' });
  });

  it('POS-14: void is rejected when a payment was captured (only a refund is possible)', () => {
    expectPosError(() => buildSale().assertCanVoid(SHIFT), POS_ERROR_CODE.SALE_NOT_VOIDABLE);
  });

  it('POS-14: void is rejected outside the same open shift', () => {
    // A payment-less sale (edge case) still cannot be voided on another shift.
    const sale = buildSale({ payments: [cashPayment('1070', { method: PAYMENT_METHOD.OTHER })] });
    expectPosError(() => sale.assertCanVoid('some-other-shift'), POS_ERROR_CODE.SALE_NOT_VOIDABLE);
  });

  it('POS-13: only a completed sale can be voided', () => {
    const sale = buildSale();
    sale.markVoided(new Date());
    expectPosError(() => sale.assertCanVoid(SHIFT), POS_ERROR_CODE.SALE_IMMUTABLE);
  });

  it('POS-19: the sale carries the locale for identical receipt regeneration', () => {
    expect(buildSale({ locale: 'ar' }).locale).toBe('ar');
  });
});

// ─── Refund (POS-20, POS-22, POS-23) ───────────────────────────────────────

describe('Refund', () => {
  const base = {
    id: 'refund-1',
    organizationId: ORG,
    originalSaleId: 'sale-1',
    shiftId: SHIFT,
    registerId: REGISTER,
    reasonCode: 'customer_return',
    currency: 'USD',
    refundedAt: new Date('2026-08-05T11:00:00.000Z'),
    createdBy: USER,
  };

  it('POS-23: a refund requires a reason code', () => {
    expectPosError(
      () =>
        Refund.create({
          ...base,
          reasonCode: '',
          lines: [
            {
              saleLineId: 'line-1',
              variantId: 'var-1',
              quantity: '1',
              restock: true,
              amountMinor: '500',
              currency: 'USD',
            },
          ],
        }),
      POS_ERROR_CODE.REFUND_REQUIRES_REASON,
    );
  });

  it('POS-22: restock is decided per refund line', () => {
    const refund = Refund.create({
      ...base,
      lines: [
        { saleLineId: 'line-1', variantId: 'var-1', quantity: '1', restock: true, amountMinor: '500', currency: 'USD' },
        {
          saleLineId: 'line-2',
          variantId: 'var-2',
          quantity: '1',
          restock: false,
          amountMinor: '300',
          currency: 'USD',
        },
      ],
    });
    expect(refund.lines[0]!.restock).toBe(true);
    expect(refund.lines[1]!.restock).toBe(false);
  });

  it('the refund amount is the sum of its line amounts', () => {
    const refund = Refund.create({
      ...base,
      lines: [
        { saleLineId: 'line-1', variantId: 'var-1', quantity: '1', restock: true, amountMinor: '500', currency: 'USD' },
        {
          saleLineId: 'line-2',
          variantId: 'var-2',
          quantity: '1',
          restock: false,
          amountMinor: '300',
          currency: 'USD',
        },
      ],
    });
    expect(refund.amountMinor).toBe('800');
  });

  it('rejects a refund line in a different currency (POS-11 single currency)', () => {
    expectPosError(
      () =>
        Refund.create({
          ...base,
          lines: [
            {
              saleLineId: 'line-1',
              variantId: 'var-1',
              quantity: '1',
              restock: true,
              amountMinor: '500',
              currency: 'EUR',
            },
          ],
        }),
      POS_ERROR_CODE.CURRENCY_MISMATCH,
    );
  });
});

// ─── Money helpers (hard rule #3 — exact integer arithmetic) ───────────────

describe('POS money helpers', () => {
  it('multiplies minor units by a fractional quantity exactly (half-up)', () => {
    // $10.00 × 1.5 = $15.00
    expect(multiplyMinorByQuantity(1000n, '1.5').toString()).toBe('1500');
    // $10.00 × 0.3333 → 3.333 (half-up on the fractional cent)
    expect(multiplyMinorByQuantity(1000n, '0.3333').toString()).toBe('333');
  });

  it('computes tax in basis points exactly (half-up)', () => {
    expect(taxInBp(1000n, 700).toString()).toBe('70'); // 7%
    // 1 minor unit at 5% → 0.05 → rounds down to 0 minor units.
    expect(taxInBp(1n, 500).toString()).toBe('0');
    expect(taxInBp(100n, 0).toString()).toBe('0');
  });

  it('POS-21: sums decimal quantities across different scales exactly', () => {
    // 0.5 + 0.25 = 0.75 — raw parseDecimal amounts (5@1 + 25@2) would give 30.
    expect(sumDecimalQuantities('0.5', '0.25')).toBe('0.75');
    expect(sumDecimalQuantities('1', '2.5')).toBe('3.5');
    expect(sumDecimalQuantities('0.125', '0.125', '0.25')).toBe('0.500');
  });

  it('POS-21: compares decimal quantities with different scales exactly', () => {
    expect(decimalQuantityExceeds('0.75', '1')).toBe(false); // 0.75 ≤ 1.0
    expect(decimalQuantityExceeds('1.01', '1')).toBe(true);
    expect(decimalQuantityExceeds('0.999', '0.999')).toBe(false); // equal, not greater
  });
});

// ─── Sale status transitions (POS-13) ───────────────────────────────────────

describe('Sale status transitions', () => {
  it('a completed sale is created with status completed', () => {
    expect(buildSale().status).toBe(SALE_STATUS.COMPLETED);
  });

  it('markRefunded flips to fully/partially refunded (POS-21 bookkeeping)', () => {
    const sale = buildSale();
    sale.markRefunded({ fully: false, now: new Date() });
    expect(sale.status).toBe(SALE_STATUS.PARTIALLY_REFUNDED);
    sale.markRefunded({ fully: true, now: new Date() });
    expect(sale.status).toBe(SALE_STATUS.REFUNDED);
  });
});
