// Regression test for the v1 outbox keyPath bug: v1 created EVERY store with
// keyPath 'key', but outbox records key on `id`, so every queued-sale write
// threw a DataError. v2 recreates the outbox store keyed on 'id'. This test
// plants a v1-shaped database and verifies the upgrade repairs it — the exact
// scenario the offline engine's own tests would otherwise never cover.
import 'fake-indexeddb/auto';

import { describe, expect, it } from 'vitest';

import { META_STORE, OUTBOX_STORE, getRecord, putRecord } from '../db';
import { queueOfflineSale } from '../outbox';

/** The pre-v2 (buggy) schema — outbox keyed on 'key' like the other stores. */
const BUGGY_V1_VERSION = 1;

const DB_NAME = 'modubiz-pos-offline';

async function plantBuggyV1Database(): Promise<void> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, BUGGY_V1_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      // Exactly what v1 shipped: every store with keyPath 'key'.
      const storeNames: readonly string[] = ['outbox', 'meta', 'cache'];
      for (const name of storeNames) {
        if (!database.objectStoreNames.contains(name)) database.createObjectStore(name, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('plant failed'));
  });
  // A meta record that must SURVIVE the upgrade (meta/cache keep keyPath 'key').
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(META_STORE, 'readwrite');
    tx.objectStore(META_STORE).put({ key: 'survivor', n: 7 });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('meta seed failed'));
  });
  db.close();
}

/** Open the current-schema DB and read a store's keyPath. */
async function storeKeyPath(store: string): Promise<IDBValidKey | string[] | null> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('reopen failed'));
  });
  const keyPath = db.transaction(store).objectStore(store).keyPath;
  db.close();
  return keyPath;
}

describe('POS offline IndexedDB — v1 → v2 upgrade', () => {
  it('recreates the outbox keyed on id, preserves meta, and queues sales', async () => {
    await plantBuggyV1Database();

    // Any engine call opens at v2, firing the upgrade that repairs the outbox.
    const queued = await queueOfflineSale({
      organizationId: 'org-mig',
      registerId: '11111111-1111-4111-8111-111111111111',
      registerName: 'Till 1',
      locale: 'en',
      currency: 'USD',
      clientDeviceId: 'device-1',
      idempotencyKey: '22222222-2222-4222-8222-222222222222',
      soldAt: '2026-08-10T10:00:00.000Z',
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
      ],
      payments: [
        {
          method: 'cash',
          amount: { amountMinor: '1000', currency: 'USD' },
          currency: 'USD',
        },
      ],
      customerContactId: null,
    });
    expect(queued.provisionalReceiptNumber).toBe('P-0001');

    // The outbox store now keys on `id` — the write above succeeded, which the
    // buggy schema made impossible. meta keeps its 'key' keyPath.
    expect(await storeKeyPath(OUTBOX_STORE)).toBe('id');
    expect(await storeKeyPath(META_STORE)).toBe('key');

    // meta data seeded under v1 survived the upgrade untouched.
    expect(await getRecord<{ key: string; n: number }>(META_STORE, 'survivor')).toEqual({ key: 'survivor', n: 7 });
  });

  it('writes to the repaired outbox are durable and keyed by idempotency_key', async () => {
    const idempotencyKey = '33333333-3333-4333-8333-333333333333';
    await putRecord(OUTBOX_STORE, {
      id: idempotencyKey,
      organizationId: 'org-mig',
      status: 'pending',
    });
    const stored = await getRecord<{ id: string }>(OUTBOX_STORE, idempotencyKey);
    expect(stored?.id).toBe(idempotencyKey);
  });
});
