import '@testing-library/jest-dom/vitest';

/**
 * jsdom + Node's experimental webstorage can yield a broken `localStorage`
 * (Node emits `--localstorage-file was provided without a valid path` and the
 * Storage object is non-functional). Install a deterministic in-memory shim
 * for tests that run in a browser-like environment.
 */
function installLocalStorageShim(): void {
  if (typeof window === 'undefined') return;

  try {
    const existing = window.localStorage;
    if (existing) {
      existing.clear();
      existing.setItem('__modubiz_probe__', '1');
      existing.removeItem('__modubiz_probe__');
      return; // the native implementation actually works
    }
  } catch {
    // broken or missing — install the shim
  }

  const store = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (key: string) => store.get(key) ?? null,
    key: (index: number) => [...store.keys()][index] ?? null,
    removeItem: (key: string) => {
      store.delete(key);
    },
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
  };

  try {
    Object.defineProperty(window, 'localStorage', { value: storage, configurable: true });
  } catch {
    // ignore
  }
  try {
    Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });
  } catch {
    // ignore
  }
}

installLocalStorageShim();
