import { describe, expect, it } from 'vitest';

import {
  ACCOUNTING_ERROR_CODE,
  TAX_BASIS,
  TAX_TYPE,
  TaxRate,
  buildDefaultSmeChart,
  calculateLineTax,
  calculateTaxes,
} from '../../domain/index.js';

function expectAccountingError(action: () => void, expectedCode: string): void {
  try {
    action();
    expect.fail('Expected AccountingDomainError to be thrown');
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    expect((error as { code?: string }).code).toBe(expectedCode);
  }
}

const orgId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const rateId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const vat15: Parameters<typeof calculateLineTax>[1] = {
  rateBp: 1500,
  type: TAX_TYPE.STANDARD,
  taxBasis: TAX_BASIS.EXCLUSIVE,
};

// ─── Tax engine (ACC-11) ─────────────────────────────────────────────────────

describe('calculateLineTax (ACC-11)', () => {
  it('ACC-11: exclusive tax = round(line × bp / 10000) exactly', () => {
    // 100000 × 15% = 15000 exactly.
    const result = calculateLineTax('100000', vat15);
    expect(result.taxAmountMinor).toBe('15000');
    expect(result.lineGrandTotalMinor).toBe('115000');
  });

  it('ACC-11: exclusive tax rounds half-up at the line level', () => {
    // 3333 × 15% = 499.95 → 500 (half-up on the cent).
    const result = calculateLineTax('3333', vat15);
    expect(result.taxAmountMinor).toBe('500');
  });

  it('ACC-11: inclusive tax = round(line × bp / (10000 + bp)) — embedded', () => {
    // 115000 inclusive at 15% → tax 15000, grand = line (price already includes tax).
    const inclusive = { ...vat15, taxBasis: TAX_BASIS.INCLUSIVE };
    const result = calculateLineTax('115000', inclusive);
    expect(result.taxAmountMinor).toBe('15000');
    expect(result.lineGrandTotalMinor).toBe('115000');
  });

  it('ACC-11: inclusive tax rounds half-up at the line level', () => {
    // 100000 × 15% / 1.15 = 13043.478… → 13043.
    const inclusive = { ...vat15, taxBasis: TAX_BASIS.INCLUSIVE };
    const result = calculateLineTax('100000', inclusive);
    expect(result.taxAmountMinor).toBe('13043');
    expect(result.lineGrandTotalMinor).toBe('100000');
  });

  it('ACC-11: zero/exempt rates always compute tax 0 regardless of basis', () => {
    for (const type of [TAX_TYPE.ZERO, TAX_TYPE.EXEMPT] as const) {
      const result = calculateLineTax('99999', { ...vat15, rateBp: 0, type });
      expect(result.taxAmountMinor).toBe('0');
      expect(result.lineGrandTotalMinor).toBe('99999');
    }
  });

  it('ACC-11: a 0-bp standard rate also computes tax 0', () => {
    const result = calculateLineTax('12345', { ...vat15, rateBp: 0 });
    expect(result.taxAmountMinor).toBe('0');
  });

  it('ACC-11: rejects a negative or fractional rate', () => {
    expectAccountingError(
      () => calculateLineTax('100', { ...vat15, rateBp: -1 }),
      ACCOUNTING_ERROR_CODE.TAX_RATE_INVALID,
    );
    expectAccountingError(
      () => calculateLineTax('100', { ...vat15, rateBp: 15.5 }),
      ACCOUNTING_ERROR_CODE.TAX_RATE_INVALID,
    );
  });

  it('ACC-11: rejects a malformed (non-minor) line total', () => {
    expectAccountingError(() => calculateLineTax('-50', vat15), ACCOUNTING_ERROR_CODE.LINE_INVALID);
    expectAccountingError(() => calculateLineTax('10.5', vat15), ACCOUNTING_ERROR_CODE.LINE_INVALID);
  });
});

describe('calculateTaxes (ACC-11)', () => {
  it('ACC-11: document tax is the SUM of line taxes (line-level rounding is authoritative)', () => {
    const result = calculateTaxes(['3333', '3333', '3334'], vat15);
    // 500 + 500 + 500 = 1500 — NOT 15% of the document subtotal (10000 → 1500, coincidentally
    // equal here, so use an asymmetric split to prove the sum of rounded lines):
    expect(result.taxAmountMinor).toBe('1500');
    expect(result.grandTotalMinor).toBe('11500');
    expect(result.lines).toHaveLength(3);
  });

  it('ACC-11: document tax is the sum even when document-level rounding would differ', () => {
    // 3 × 3333 @ 1%: each line rounds to 33 (33.33 → 33) → 99, whereas a
    // document-level computation on 9999 would round to 100. Line-sum wins.
    const result = calculateTaxes(['3333', '3333', '3333'], {
      rateBp: 100,
      type: TAX_TYPE.STANDARD,
      taxBasis: TAX_BASIS.EXCLUSIVE,
    });
    const lineTaxes = result.lines.map((l) => l.taxAmountMinor);
    expect(lineTaxes).toEqual(['33', '33', '33']);
    expect(result.taxAmountMinor).toBe('99');
    expect(result.grandTotalMinor).toBe('10098');
  });

  it('ACC-11: mixed zero/exempt lines contribute no tax to the total', () => {
    const result = calculateTaxes(['10000', '20000'], {
      rateBp: 0,
      type: TAX_TYPE.EXEMPT,
      taxBasis: TAX_BASIS.EXCLUSIVE,
    });
    expect(result.taxAmountMinor).toBe('0');
    expect(result.grandTotalMinor).toBe('30000');
  });
});

// ─── TaxRate entity extensions (ACC-11) ─────────────────────────────────────

describe('TaxRate create/update (ACC-11)', () => {
  it('ACC-11: defaults to exclusive basis, no COA mapping, not default', () => {
    const rate = TaxRate.create({
      id: rateId,
      organizationId: orgId,
      code: 'VAT-STD',
      nameI18n: { en: 'VAT 15%' },
      rateBp: 1500,
    });
    expect(rate.taxBasis).toBe(TAX_BASIS.EXCLUSIVE);
    expect(rate.coaAccountId).toBeNull();
    expect(rate.isDefault).toBe(false);
  });

  it('ACC-11: stores an inclusive basis, COA mapping, and default flag', () => {
    const rate = TaxRate.create({
      id: rateId,
      organizationId: orgId,
      code: 'VAT-IN',
      nameI18n: { en: 'VAT inclusive' },
      rateBp: 1500,
      taxBasis: TAX_BASIS.INCLUSIVE,
      coaAccountId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
      isDefault: true,
    });
    expect(rate.taxBasis).toBe(TAX_BASIS.INCLUSIVE);
    expect(rate.coaAccountId).toBe('cccccccc-cccc-cccc-cccc-cccccccccccc');
    expect(rate.isDefault).toBe(true);
  });

  it('ACC-11: updates a subset of fields (basis, mapping, default) and keeps the code', () => {
    const rate = TaxRate.create({
      id: rateId,
      organizationId: orgId,
      code: 'VAT-STD',
      nameI18n: { en: 'VAT 15%' },
      rateBp: 1500,
    });
    rate.update(
      { taxBasis: TAX_BASIS.INCLUSIVE, isDefault: true, coaAccountId: 'cccccccc-cccc-cccc-cccc-cccccccccccc' },
      new Date(),
    );
    const json = rate.toJSON();
    expect(json.code).toBe('VAT-STD');
    expect(json.taxBasis).toBe(TAX_BASIS.INCLUSIVE);
    expect(json.isDefault).toBe(true);
    expect(json.coaAccountId).toBe('cccccccc-cccc-cccc-cccc-cccccccccccc');
  });

  it('ACC-11: update rejects an invalid rate bp', () => {
    const rate = TaxRate.create({
      id: rateId,
      organizationId: orgId,
      code: 'VAT-STD',
      nameI18n: { en: 'VAT 15%' },
      rateBp: 1500,
    });
    expectAccountingError(() => rate.update({ rateBp: -5 }, new Date()), ACCOUNTING_ERROR_CODE.TAX_RATE_INVALID);
  });
});

// ─── COA seed (ACC-5 + ACC-11) ───────────────────────────────────────────────

describe('Default SME chart includes the VAT accounts (ACC-5/ACC-11)', () => {
  it('ACC-11: the seed chart contains Output VAT (2100) and Input VAT (2200)', () => {
    const chart = buildDefaultSmeChart({ organizationId: orgId, nameResolver: (key) => ({ en: key }) });
    const codes = new Set(chart.map((a) => a.code));
    expect(codes.has('2100')).toBe(true);
    expect(codes.has('2200')).toBe(true);
    const inputVat = chart.find((a) => a.code === '2200')!;
    expect(inputVat.type).toBe('asset');
    expect(inputVat.isSystem).toBe(true);
  });
});
