// Per-device identity for the offline engine.
//
// POS-26/28 require a stable `clientDeviceId` per physical device so offline
// sales sync "in sold_at order per device" and retries are idempotent. A UUID
// persisted in localStorage is stable for the lifetime of the browser profile
// and costs nothing to refresh — the server treats it as an opaque string.

const DEVICE_ID_KEY = 'modubiz_pos_device_id';

/** The stable device id for this browser, creating it on first use. */
export function getClientDeviceId(): string {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    // Server render / no storage — a fresh id per call is the best we can do;
    // offline queueing is a client-only concern and never runs here.
    return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : 'server';
  }
  const existing = window.localStorage.getItem(DEVICE_ID_KEY);
  if (existing) return existing;
  const created = crypto.randomUUID();
  try {
    window.localStorage.setItem(DEVICE_ID_KEY, created);
  } catch {
    // Storage denied (private mode) — a fresh id per sale still satisfies
    // idempotency; only the "per device" ordering scope is weakened.
  }
  return created;
}
