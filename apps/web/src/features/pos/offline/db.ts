// IndexedDB layer for the POS offline engine (POS-25/31).
//
// No external dependency (TECH_STACK is locked): a thin promise wrapper over
// the browser API. Three object stores, all keyed by a namespace string:
//
//   outbox  (keyPath: 'id') — queued offline sales, id = idempotency_key
//   meta    (keyPath: 'key') — provisional receipt counters, synced mappings
//   cache   (keyPath: 'key') — org-scoped sellable catalog + registers (POS-31)
//
// Every cache key is namespaced by organizationId so tenant data never leaks
// across orgs (POS-31), and the lifecycle module can wipe caches on logout or
// org switch.

const DB_NAME = 'modubiz-pos-offline';
// v2: the outbox store is keyed on `id` (the idempotency_key) — v1 created
// every store with keyPath 'key', which made every outbox write fail. Since no
// release shipped with v1, the upgrade only ever repairs a local dev database.
const DB_VERSION = 2;

export const OUTBOX_STORE = 'outbox';
export const META_STORE = 'meta';
export const CACHE_STORE = 'cache';

/**
 * All object stores — used for creation and full wipes. Each entry maps the
 * store name to its keyPath: outbox records key on `id` (the idempotency_key),
 * meta and cache records key on `key`.
 */
export const STORE_KEY_PATHS: Record<string, string> = {
  [OUTBOX_STORE]: 'id',
  [META_STORE]: 'key',
  [CACHE_STORE]: 'key',
};

export const STORES: readonly string[] = Object.keys(STORE_KEY_PATHS);

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      // Don't cache the rejection — a later call (e.g. after a retry) may find
      // IndexedDB available.
      dbPromise = null;
      reject(new Error('IndexedDB is not available in this environment'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = request.result;
      const needsOutboxFix = event.oldVersion < 2;
      for (const [name, keyPath] of Object.entries(STORE_KEY_PATHS)) {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name, { keyPath });
          continue;
        }
        // v1 created the outbox with keyPath 'key' (bug); recreate it keyed on
        // 'id' so queued-sale writes key on the idempotency_key. meta/cache are
        // untouched. Deleting here is safe: only a local dev DB ever had v1.
        if (needsOutboxFix && name === OUTBOX_STORE) {
          db.deleteObjectStore(name);
          db.createObjectStore(name, { keyPath });
        }
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      // Transient open failures must not poison every later call.
      dbPromise = null;
      reject(request.error ?? new Error('Failed to open IndexedDB'));
    };
  });
  return dbPromise;
}

/**
 * Run one request against a store and resolve with its result. The browser
 * types `IDBRequest.result` as `any`, so the ONLY cast in this module is here
 * at the promise boundary — callers get a fully typed value.
 */
function transact<T>(store: string, mode: IDBTransactionMode, make: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(store, mode);
        const request = make(tx.objectStore(store));
        request.onsuccess = () => {
          // eslint-disable-next-line no-restricted-syntax -- the browser API types request.result as `any`; this generic boundary cast is the only way to hand out typed values.
          resolve(request.result as T);
        };
        request.onerror = () => reject(request.error ?? new Error(`IndexedDB ${store} ${mode} failed`));
      }),
  );
}

/** Read one record by key; resolves undefined when absent. */
export function getRecord<T>(store: string, key: string): Promise<T | undefined> {
  return transact<T | undefined>(store, 'readonly', (s) => s.get(key));
}

/** Read every record in a store. */
export function getAllRecords<T>(store: string): Promise<T[]> {
  return transact<T[]>(store, 'readonly', (s) => s.getAll());
}

/** Insert or replace one record. */
export function putRecord<T>(store: string, record: T): Promise<IDBValidKey> {
  return transact<IDBValidKey>(store, 'readwrite', (s) => s.put(record));
}

/** Delete one record by key. */
export function deleteRecord(store: string, key: string): Promise<undefined> {
  return transact<undefined>(store, 'readwrite', (s) => s.delete(key));
}

/** Wipe an entire store (logout — POS-31 clears cached tenant data). */
export function clearStore(store: string): Promise<undefined> {
  return transact<undefined>(store, 'readwrite', (s) => s.clear());
}

/** Wipe every store (full logout / storage reset). */
export async function clearAllStores(): Promise<void> {
  await Promise.all(STORES.map((store) => clearStore(store)));
}

/** True when IndexedDB can be opened (private-mode Safari etc. can deny it). */
export function isOfflineStorageAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}
