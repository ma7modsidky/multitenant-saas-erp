// Org-scoped offline cache (POS-31): only the data required to sell — the
// sellable catalog (products/variants/prices) and the registers — cached under
// a key namespaced by organizationId. Cleared on logout or org switch by the
// lifecycle helpers in outbox.ts.
import type { InventoryPage, InventoryProduct, PosRegister } from '@/lib/api/resources';

import { CACHE_STORE, getRecord, putRecord } from './db';

interface CacheRecord<T> {
  key: string;
  savedAt: string;
  value: T;
}

function catalogKey(organizationId: string): string {
  return `catalog:${organizationId}`;
}

function registersKey(organizationId: string): string {
  return `registers:${organizationId}`;
}

/** Write-through: keep the freshly fetched catalog for offline selling. */
export async function cacheSellableCatalog(
  organizationId: string,
  page: InventoryPage<InventoryProduct>,
): Promise<void> {
  await putRecord<CacheRecord<InventoryPage<InventoryProduct>>>(CACHE_STORE, {
    key: catalogKey(organizationId),
    savedAt: new Date().toISOString(),
    value: page,
  });
}

/** Read the cached catalog for an org; undefined when never cached. */
export async function readCachedCatalog(organizationId: string): Promise<InventoryPage<InventoryProduct> | undefined> {
  const record = await getRecord<CacheRecord<InventoryPage<InventoryProduct>>>(CACHE_STORE, catalogKey(organizationId));
  return record?.value;
}

/** Write-through: keep the fetched registers (incl. open-shift ids) for offline selling. */
export async function cacheRegisters(organizationId: string, items: PosRegister[]): Promise<void> {
  await putRecord<CacheRecord<PosRegister[]>>(CACHE_STORE, {
    key: registersKey(organizationId),
    savedAt: new Date().toISOString(),
    value: items,
  });
}

/** Read the cached registers for an org; undefined when never cached. */
export async function readCachedRegisters(organizationId: string): Promise<PosRegister[] | undefined> {
  const record = await getRecord<CacheRecord<PosRegister[]>>(CACHE_STORE, registersKey(organizationId));
  return record?.value;
}
