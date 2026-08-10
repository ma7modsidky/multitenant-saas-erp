// Real IndexedDB-backed outbox tests (POS-25..29, POS-31) — the engine runs
// against fake-indexeddb (a faithful browser-IDB polyfill), so store keyPaths,
// ordering, flush semantics, and lifecycle wipes are all exercised for real.
// This is the suite that would have caught the v1 outbox keyPath bug.
import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/lib/api';
import { createPosOfflineSale } from '@/lib/api/resources';
import type { PosCheckoutLine, PosCheckoutPayment } from '@/lib/api/resources';

import { clearAllStores } from '../db';
import {
  discardQueuedSale,
  flushOutbox,
  formatProvisionalReceipt,
  listPendingSales,
  markOutboxFailed,
  outboxCounts,
  queueOfflineSale,
} from '../outbox';
import type { QueuedSale } from '../types';

// The test file only ever touches `createPosOfflineSale` from resources — the
// mock factory replaces the module wholesale, so no other export is needed.
vi.mock('@/lib/api/resources', () => ({
  createPosOfflineSale: vi.fn(),
}));

const mockSync = vi.mocked(createPosOfflineSale);

const ORG_A = 'org-a';
const ORG_B = 'org-b';
const REGISTER_1 = '11111111-1111-4111-8111-111111111111';
const REGISTER_2 = '22222222-2222-4222-8222-222222222222';

const LINE: PosCheckoutLine = {
  variantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  sku: 'ESP-001',
  nameI18n: { en: 'Espresso' },
  quantity: '1',
  unitPrice: { amountMinor: '1000', currency: 'USD' },
  taxRateBp: 0,
  currency: 'USD',
};

const CASH_PAYMENT: PosCheckoutPayment = {
  method: 'cash',
  amount: { amountMinor: '1000', currency: 'USD' },
  currency: 'USD',
  tenderedAmountMinor: '1000',
  changeAmountMinor: '0',
};

/** A minimal sale body — every required sync field + queue-only extras. */
type SaleInput = Parameters<typeof queueOfflineSale>[0];
function saleInput(overrides: Partial<SaleInput> = {}): SaleInput {
  return {
    organizationId: ORG_A,
    registerId: REGISTER_1,
    registerName: 'Till 1',
    locale: 'en',
    currency: 'USD',
    clientDeviceId: 'device-1',
    idempotencyKey: `00000000-0000-4000-8000-${Math.random().toString(16).slice(2, 14)}`,
    soldAt: '2026-08-10T10:00:00.000Z',
    lines: [LINE],
    payments: [CASH_PAYMENT],
    customerContactId: null,
    ...overrides,
  };
}

beforeEach(() => {
  mockSync.mockReset();
});

afterEach(async () => {
  await clearAllStores();
});

describe('POS offline outbox — IndexedDB layer', () => {
  it('POS-25/27: queues a sale as a durable record with a provisional receipt', async () => {
    const queued: QueuedSale = await queueOfflineSale(saleInput());

    expect(queued.id).toBeTypeOf('string');
    expect(queued.status).toBe('pending');
    expect(queued.provisionalReceiptNumber).toBe('P-0001');
    expect(queued.errorCode).toBeNull();
    expect(queued.reconciledSaleId).toBeNull();

    const pending = await listPendingSales(ORG_A);
    expect(pending).toHaveLength(1);
    expect(pending[0]?.registerName).toBe('Till 1');
  });

  it('POS-27: provisional receipts are sequential per (org, register)', async () => {
    await queueOfflineSale(saleInput({ registerId: REGISTER_1 }));
    await queueOfflineSale(saleInput({ registerId: REGISTER_1 }));
    // A second register restarts the sequence; org B is scoped away entirely.
    await queueOfflineSale(saleInput({ registerId: REGISTER_2 }));
    await queueOfflineSale(saleInput({ organizationId: ORG_B, registerId: REGISTER_1 }));

    const orgARegister1 = (await listPendingSales(ORG_A))
      .filter((sale) => sale.registerId === REGISTER_1)
      .map((sale) => sale.provisionalReceiptNumber)
      .sort();
    expect(orgARegister1).toEqual(['P-0001', 'P-0002']);
    expect(formatProvisionalReceipt(42)).toBe('P-0042');

    const orgB = await listPendingSales(ORG_B);
    expect(orgB.map((sale) => sale.provisionalReceiptNumber)).toEqual(['P-0001']);
  });

  it('POS-28: pending sales list in sold_at order, oldest first', async () => {
    await queueOfflineSale(saleInput({ soldAt: '2026-08-10T12:00:00.000Z' }));
    await queueOfflineSale(saleInput({ soldAt: '2026-08-10T09:00:00.000Z' }));
    await queueOfflineSale(saleInput({ soldAt: '2026-08-10T10:30:00.000Z' }));

    const pending = await listPendingSales(ORG_A);
    expect(pending.map((sale) => sale.soldAt)).toEqual([
      '2026-08-10T09:00:00.000Z',
      '2026-08-10T10:30:00.000Z',
      '2026-08-10T12:00:00.000Z',
    ]);
  });

  it('POS-31: org B sales never appear in org A pending/counts', async () => {
    await queueOfflineSale(saleInput());
    await queueOfflineSale(saleInput({ organizationId: ORG_B }));

    const countsA = await outboxCounts(ORG_A);
    expect(countsA).toEqual({ pending: 1, failed: 0 });
    expect(await listPendingSales(ORG_A)).toHaveLength(1);
    expect(await listPendingSales(ORG_B)).toHaveLength(1);
  });
});

describe('POS offline outbox — flush', () => {
  it('POS-26/27: a successful flush syncs in order and reconciles the receipt', async () => {
    await queueOfflineSale(saleInput({ soldAt: '2026-08-10T09:00:00.000Z' }));
    await queueOfflineSale(saleInput({ soldAt: '2026-08-10T10:00:00.000Z' }));

    mockSync.mockResolvedValue({ saleId: 'sale-1', receiptNumber: 'R-0001', replay: false });
    mockSync.mockResolvedValueOnce({ saleId: 'sale-2', receiptNumber: 'R-0002', replay: false });

    const result = await flushOutbox(ORG_A);

    expect(result).toEqual({ synced: 2, failed: 0, networkStopped: false });
    // Sent in sold_at order.
    expect(mockSync.mock.calls.map((call) => call[0]?.soldAt)).toEqual([
      '2026-08-10T09:00:00.000Z',
      '2026-08-10T10:00:00.000Z',
    ]);
    expect(await listPendingSales(ORG_A)).toHaveLength(0);
    expect(await outboxCounts(ORG_A)).toEqual({ pending: 0, failed: 0 });
  });

  it('POS-26: a replay (duplicate key) is treated as synced with the original receipt', async () => {
    await queueOfflineSale(saleInput());

    mockSync.mockResolvedValue({ saleId: 'original-sale', receiptNumber: 'R-0007', replay: true });

    const result = await flushOutbox(ORG_A);
    expect(result.synced).toBe(1);
    expect(await outboxCounts(ORG_A)).toEqual({ pending: 0, failed: 0 });
  });

  it('POS-28/29: a business rejection fails only that sale and the pass continues', async () => {
    await queueOfflineSale(saleInput({ soldAt: '2026-08-10T09:00:00.000Z' }));
    await queueOfflineSale(saleInput({ soldAt: '2026-08-10T10:00:00.000Z' }));

    mockSync.mockRejectedValueOnce(new ApiError(422, { code: 'INVENTORY_INSUFFICIENT_STOCK' }));
    mockSync.mockResolvedValueOnce({ saleId: 'sale-2', receiptNumber: 'R-0002', replay: false });

    const result = await flushOutbox(ORG_A);

    expect(result).toEqual({ synced: 1, failed: 1, networkStopped: false });
    const pending = await listPendingSales(ORG_A);
    expect(pending).toHaveLength(1);
    expect(pending[0]?.status).toBe('failed');
    expect(pending[0]?.errorCode).toBe('INVENTORY_INSUFFICIENT_STOCK');
    expect(await outboxCounts(ORG_A)).toEqual({ pending: 0, failed: 1 });
  });

  it('POS-28: a network error stops the pass without marking anything', async () => {
    await queueOfflineSale(saleInput({ soldAt: '2026-08-10T09:00:00.000Z' }));
    await queueOfflineSale(saleInput({ soldAt: '2026-08-10T10:00:00.000Z' }));

    mockSync.mockRejectedValueOnce(new ApiError(0, { code: 'NETWORK_ERROR' }));
    mockSync.mockResolvedValueOnce({ saleId: 'should-not-happen', receiptNumber: 'R-0000', replay: false });

    const result = await flushOutbox(ORG_A);

    expect(result).toEqual({ synced: 0, failed: 0, networkStopped: true });
    // The second sale was never attempted; both stay pending for a later retry.
    expect(mockSync).toHaveBeenCalledTimes(1);
    expect(await outboxCounts(ORG_A)).toEqual({ pending: 2, failed: 0 });
  });

  it('POS-27: a manually failed sale can be retried and reconciled', async () => {
    const queued = await queueOfflineSale(saleInput());
    await markOutboxFailed(queued.id, 'SYNC_FAILED');

    mockSync.mockResolvedValue({ saleId: 'sale-9', receiptNumber: 'R-0009', replay: false });

    const result = await flushOutbox(ORG_A);
    expect(result).toEqual({ synced: 1, failed: 0, networkStopped: false });
    expect(await listPendingSales(ORG_A)).toHaveLength(0);
  });

  it('POS-29: a rejected sale can be discarded by the operator', async () => {
    const queued = await queueOfflineSale(saleInput());
    await markOutboxFailed(queued.id, 'INVENTORY_INSUFFICIENT_STOCK');
    await discardQueuedSale(queued.id);

    expect(await outboxCounts(ORG_A)).toEqual({ pending: 0, failed: 0 });
  });

  it('POS-31: wiping clears the outbox (logout)', async () => {
    await queueOfflineSale(saleInput());
    await clearAllStores();
    expect(await outboxCounts(ORG_A)).toEqual({ pending: 0, failed: 0 });
  });
});
