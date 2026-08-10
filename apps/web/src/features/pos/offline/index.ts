// POS offline engine (POS-25..31) — durable outbox, connection state, cache.
export { PosOfflineBadge } from './badge';
export { OfflinePosProvider, useOfflinePos } from './context';
export {
  clearPosOfflineCaches,
  discardQueuedSale,
  flushOutbox,
  formatProvisionalReceipt,
  listPendingSales,
  markOutboxFailed,
  markOutboxSynced,
  outboxCounts,
  queueOfflineSale,
  wipePosOfflineData,
} from './outbox';
export type { FlushResult, QueuedSale, SyncSaleInput } from './types';
