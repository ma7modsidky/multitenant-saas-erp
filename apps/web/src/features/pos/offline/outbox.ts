// The durable outbox (POS-25) — offline sales queue here and flush through the
// sync endpoint in sold_at order (POS-28).
//
// Every sale carries the client-generated idempotency_key (POS-26), the
// device id (POS-26/28) and a provisional receipt number (POS-27) that the
// server replaces with the authoritative one on sync. Rejections (e.g.
// INVENTORY_INSUFFICIENT_STOCK oversold on sync) keep the sale in the outbox
// with its error code so the operator can retry — POS-29 records the attempt
// server-side in pos_sync_log either way.
import { ApiError } from '@/lib/api';
import { createPosOfflineSale } from '@/lib/api/resources';

import {
  CACHE_STORE,
  META_STORE,
  OUTBOX_STORE,
  clearAllStores,
  clearStore,
  deleteRecord,
  getAllRecords,
  getRecord,
  putRecord,
} from './db';
import type { FlushResult, QueuedSale, SyncSaleInput } from './types';

/** Receipt-sequence meta key, per (org, register) — POS-27 provisional scope. */
function receiptSeqKey(organizationId: string, registerId: string): string {
  return `receipt-seq:${organizationId}:${registerId}`;
}

/** POS-27: provisional receipts are client-scoped — `P-` prefix, server uses `R-`. */
export function formatProvisionalReceipt(sequence: number): string {
  return `P-${String(sequence).padStart(4, '0')}`;
}

/** Reserve the next provisional receipt number for a register (atomic-ish read-modify-write). */
async function nextProvisionalReceipt(organizationId: string, registerId: string): Promise<string> {
  const key = receiptSeqKey(organizationId, registerId);
  const current = await getRecord<{ key: string; n: number }>(META_STORE, key);
  const next = (current?.n ?? 0) + 1;
  await putRecord(META_STORE, { key, n: next });
  return formatProvisionalReceipt(next);
}

/** Enqueue a sale for sync (POS-25/26/27). Returns the queued record. */
export async function queueOfflineSale(
  input: SyncSaleInput & {
    organizationId: string;
    registerName: string | null;
    currency: string;
  },
): Promise<QueuedSale> {
  const provisionalReceiptNumber = await nextProvisionalReceipt(input.organizationId, input.registerId);
  const record: QueuedSale = {
    id: input.idempotencyKey,
    organizationId: input.organizationId,
    clientDeviceId: input.clientDeviceId,
    registerId: input.registerId,
    registerName: input.registerName,
    locale: input.locale,
    soldAt: input.soldAt,
    currency: input.currency,
    lines: input.lines,
    payments: input.payments,
    customerContactId: input.customerContactId ?? null,
    provisionalReceiptNumber,
    queuedAt: new Date().toISOString(),
    status: 'pending',
    errorCode: null,
    syncedAt: null,
    reconciledSaleId: null,
    reconciledReceiptNumber: null,
  };
  await putRecord(OUTBOX_STORE, record);
  return record;
}

/** All not-yet-synced sales for an org, in sold_at order (POS-28). */
export async function listPendingSales(organizationId: string): Promise<QueuedSale[]> {
  const all = await getAllRecords<QueuedSale>(OUTBOX_STORE);
  return all
    .filter((sale) => sale.organizationId === organizationId && sale.status !== 'synced')
    .sort((a, b) => (a.soldAt === b.soldAt ? a.id.localeCompare(b.id) : a.soldAt < b.soldAt ? -1 : 1));
}

/** Outbox counts for the badge (UI spec §9.2). */
export async function outboxCounts(organizationId: string): Promise<{ pending: number; failed: number }> {
  const all = await getAllRecords<QueuedSale>(OUTBOX_STORE);
  let pending = 0;
  let failed = 0;
  for (const sale of all) {
    if (sale.organizationId !== organizationId || sale.status === 'synced') continue;
    if (sale.status === 'failed') failed += 1;
    else pending += 1;
  }
  return { pending, failed };
}

/** Record a successful sync and the authoritative receipt (POS-27 reconciliation). */
export async function markOutboxSynced(
  id: string,
  reconciled: { saleId: string; receiptNumber: string },
): Promise<void> {
  const record = await getRecord<QueuedSale>(OUTBOX_STORE, id);
  if (!record) return;
  await putRecord(OUTBOX_STORE, {
    ...record,
    status: 'synced',
    errorCode: null,
    syncedAt: new Date().toISOString(),
    reconciledSaleId: reconciled.saleId,
    reconciledReceiptNumber: reconciled.receiptNumber,
  });
}

/** Keep a rejected sale in the outbox with its error code (POS-28/29). */
export async function markOutboxFailed(id: string, errorCode: string): Promise<void> {
  const record = await getRecord<QueuedSale>(OUTBOX_STORE, id);
  if (!record) return;
  await putRecord(OUTBOX_STORE, { ...record, status: 'failed', errorCode });
}

/** Drop a sale from the outbox (operator discarded it). */
export async function discardQueuedSale(id: string): Promise<void> {
  await deleteRecord(OUTBOX_STORE, id);
}

/**
 * Flush the outbox for one org: send pending sales in sold_at order through
 * /v1/pos/sales/sync (POS-26/28/29). A business rejection fails just that sale
 * and the pass continues; a network error stops the pass for a later retry.
 */
export async function flushOutbox(organizationId: string): Promise<FlushResult> {
  const pending = await listPendingSales(organizationId);
  const result: FlushResult = { synced: 0, failed: 0, networkStopped: false };

  for (const sale of pending) {
    try {
      const response = await createPosOfflineSale({
        clientDeviceId: sale.clientDeviceId,
        idempotencyKey: sale.id,
        registerId: sale.registerId,
        locale: sale.locale,
        soldAt: sale.soldAt,
        lines: sale.lines,
        payments: sale.payments,
        ...(sale.customerContactId ? { customerContactId: sale.customerContactId } : {}),
      });
      // Replays return the ORIGINAL sale (POS-26) — treat them as synced too.
      await markOutboxSynced(sale.id, { saleId: response.saleId, receiptNumber: response.receiptNumber });
      result.synced += 1;
    } catch (err) {
      if (err instanceof ApiError && err.code === 'NETWORK_ERROR') {
        // Back offline mid-flush — stop and retry later; don't mark anything.
        result.networkStopped = true;
        break;
      }
      const code = err instanceof ApiError ? err.code : 'SYNC_FAILED';
      await markOutboxFailed(sale.id, code);
      result.failed += 1;
    }
  }

  return result;
}

// ─── Lifecycle (POS-31) ─────────────────────────────────────────────────────

/**
 * Full wipe on logout — clears the outbox AND every cached tenant value, and
 * drops the service-worker page cache (org-specific server-rendered HTML must
 * not survive on a shared POS tablet). IndexedDB deletion failures are not
 * fatal — the auth state clears regardless.
 */
export async function wipePosOfflineData(): Promise<void> {
  await clearAllStores();
  await clearSwPageCache();
}

/** Delete the PWA page cache from the page context (CacheStorage is origin-wide). */
async function clearSwPageCache(): Promise<void> {
  if (typeof caches === 'undefined') return;
  try {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith('modubiz-pos-')).map((key) => caches.delete(key)));
  } catch {
    // Cache API unavailable (private mode / browser policy) — nothing to clear.
  }
}

/** Org switch — clear cached tenant data (catalog/registers) but KEEP the outbox. */
export function clearPosOfflineCaches(): Promise<void> {
  return clearStore(CACHE_STORE);
}
