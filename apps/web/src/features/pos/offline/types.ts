// Types for the POS offline engine (POS-25..31).
import type { PosCheckoutLine, PosCheckoutPayment, PosRegister, PosSyncSaleInput } from '@/lib/api/resources';

/** A queued offline sale — the durable outbox record (POS-25/26). */
export interface QueuedSale {
  /** The client-generated idempotency_key (POS-26) — also the outbox key. */
  id: string;
  organizationId: string;
  clientDeviceId: string;
  registerId: string;
  /** Register display name snapshot — receipts print before sync. */
  registerName: string | null;
  locale: string;
  /** ISO timestamp captured at sale time (POS-28: sync in sold_at order). */
  soldAt: string;
  currency: string;
  lines: PosCheckoutLine[];
  payments: PosCheckoutPayment[];
  customerContactId: string | null;
  /** POS-27: provisional, client-scoped until the server assigns the real one. */
  provisionalReceiptNumber: string;
  queuedAt: string;
  status: 'pending' | 'failed' | 'synced';
  errorCode: string | null;
  /** POS-27: reconciled with the authoritative server receipt after sync. */
  syncedAt: string | null;
  reconciledSaleId: string | null;
  reconciledReceiptNumber: string | null;
}

/** Result of one flush pass (POS-28/29). */
export interface FlushResult {
  /** Sales accepted (or replayed as duplicates) by the server. */
  synced: number;
  /** Sales the server rejected with a business error (kept in the outbox). */
  failed: number;
  /** True when a network error stopped the pass — retry when back online. */
  networkStopped: boolean;
}

/** A sale ready to flush — the /v1/pos/sales/sync request body. */
export type SyncSaleInput = PosSyncSaleInput;

/** Org-scoped cached register — the fields selling needs (POS-31). */
export type CachedRegister = Pick<PosRegister, 'id' | 'name' | 'code' | 'warehouseId' | 'openShiftId'>;

/** Org-scoped cached catalog entry (POS-31: name, SKU, price only). */
export interface CachedCatalogItem {
  variantId: string;
  productId: string;
  sku: string;
  nameI18n: Record<string, string>;
  unitPriceAmountMinor: string;
  /** ACC-11: the product's tax rate in basis points (0 = default). */
  taxRateBp: number;
  currency: string;
}
