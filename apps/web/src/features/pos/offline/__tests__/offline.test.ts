import { describe, expect, it } from 'vitest';

import { queuedSaleToLocalReceipt } from '../local-sale';
import { formatProvisionalReceipt } from '../outbox';
import type { QueuedSale } from '../types';

/** A two-line cash sale (espresso 1000×1 + tea 250×2 = 1500). */
const queuedSale: QueuedSale = {
  id: '11111111-1111-4111-8111-111111111111',
  organizationId: 'org-1',
  clientDeviceId: 'device-1',
  registerId: 'register-1',
  registerName: 'Till 1',
  locale: 'en',
  soldAt: '2026-08-10T10:00:00.000Z',
  currency: 'USD',
  lines: [
    {
      variantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      sku: 'ESP-001',
      nameI18n: { en: 'Espresso' },
      quantity: '1',
      unitPrice: { amountMinor: '1000', currency: 'USD' },
      taxRateBp: 0,
      currency: 'USD',
    },
    {
      variantId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      sku: 'TEA-001',
      nameI18n: { en: 'Tea' },
      quantity: '2',
      unitPrice: { amountMinor: '250', currency: 'USD' },
      taxRateBp: 0,
      currency: 'USD',
    },
  ],
  payments: [
    {
      method: 'cash',
      amount: { amountMinor: '1500', currency: 'USD' },
      currency: 'USD',
      tenderedAmountMinor: '2000',
      changeAmountMinor: '500',
    },
  ],
  customerContactId: null,
  provisionalReceiptNumber: 'P-0001',
  queuedAt: '2026-08-10T10:00:00.000Z',
  status: 'pending',
  errorCode: null,
  syncedAt: null,
  reconciledSaleId: null,
  reconciledReceiptNumber: null,
};

describe('POS offline engine — pure logic (POS-25/27)', () => {
  it('POS-27: provisional receipts are P-prefixed and zero-padded', () => {
    expect(formatProvisionalReceipt(1)).toBe('P-0001');
    expect(formatProvisionalReceipt(42)).toBe('P-0042');
    expect(formatProvisionalReceipt(1000)).toBe('P-1000');
  });

  it('POS-25/27: a queued sale prints a local receipt with exact totals', () => {
    const local = queuedSaleToLocalReceipt(queuedSale);
    expect(local.receiptNumber).toBe('P-0001');
    expect(local.status).toBe('completed');
    // Exact integer minor-unit math (hard rule #3): 1000 + (250 × 2) = 1500.
    expect(local.total.amountMinor).toBe('1500');
    expect(local.subtotal.amountMinor).toBe('1500');
    expect(local.discount.amountMinor).toBe('0');
    expect(local.tax.amountMinor).toBe('0');
    expect(local.lines).toHaveLength(2);
    expect(local.lines[0]?.lineTotalAmountMinor).toBe('1000');
    expect(local.lines[1]?.lineTotalAmountMinor).toBe('500');
    // The cash payment carries its tendered/change for the receipt footer.
    expect(local.payments).toHaveLength(1);
    expect(local.payments[0]?.tenderedAmountMinor).toBe('2000');
    expect(local.payments[0]?.changeAmountMinor).toBe('500');
  });
});
