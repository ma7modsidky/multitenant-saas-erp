// POS-27: an offline sale has no server record yet, so its receipt must print
// from the queued payload. Builds a PosSale-shaped object (ids are local) that
// ReceiptPrint renders identically to a server sale; the authoritative number
// replaces the provisional one after sync.
import type { PosSale } from '@/lib/api/resources';

import { lineTotalMinor, sumMinorAmounts } from '../money';

import type { QueuedSale } from './types';

/** Convert a queued offline sale into a printable local receipt. */
export function queuedSaleToLocalReceipt(queued: QueuedSale): PosSale {
  const lines: PosSale['lines'] = queued.lines.map((line, index) => {
    const lineTotal = lineTotalMinor(line.unitPrice.amountMinor, line.quantity);
    return {
      id: `${queued.id}-l${index}`,
      saleId: queued.id,
      variantId: line.variantId,
      skuSnapshot: line.sku,
      nameSnapshot: line.nameI18n,
      quantity: line.quantity,
      unitPriceAmountMinor: line.unitPrice.amountMinor,
      lineDiscountAmountMinor: '0',
      taxRateBp: line.taxRateBp ?? 0,
      taxAmountMinor: '0',
      lineTotalAmountMinor: lineTotal,
      currency: queued.currency,
    };
  });

  const total = sumMinorAmounts(lines.map((line) => line.lineTotalAmountMinor));

  const payments: PosSale['payments'] = queued.payments.map((payment, index) => ({
    id: `${queued.id}-p${index}`,
    saleId: queued.id,
    method: payment.method,
    amountMinor: payment.amount.amountMinor,
    currency: queued.currency,
    tenderedAmountMinor: payment.tenderedAmountMinor ?? null,
    changeAmountMinor: payment.changeAmountMinor ?? '0',
    reference: payment.reference ?? null,
    capturedAt: queued.soldAt,
    createdBy: null,
  }));

  return {
    id: queued.id,
    shiftId: '',
    registerId: queued.registerId,
    receiptNumber: queued.provisionalReceiptNumber,
    status: 'completed',
    subtotal: { amountMinor: total, currency: queued.currency },
    discount: { amountMinor: '0', currency: queued.currency },
    tax: { amountMinor: '0', currency: queued.currency },
    total: { amountMinor: total, currency: queued.currency },
    currency: queued.currency,
    locale: queued.locale,
    customerContactId: queued.customerContactId,
    soldAt: queued.soldAt,
    createdAt: queued.queuedAt,
    lines,
    payments,
  };
}
