// Theme persistence for the topbar toggle (light / dark / system).
//
// The selection is stored in localStorage so it survives full page reloads.
// The root layout (app/layout.tsx) applies the stored value before first
// paint via an inline script — keep that script in sync with this module so
// a dark-mode user never sees a flash of light mode on reload.

export type Theme = 'light' | 'dark' | 'system';

export const THEME_STORAGE_KEY = 'modubiz.theme';

function isTheme(value: unknown): value is Theme {
  return value === 'light' || value === 'dark' || value === 'system';
}

function canUseLocalStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function prefersDarkScheme(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  );
}

/** Read the persisted selection; falls back to 'light' when absent or corrupt. */
export function getStoredTheme(): Theme {
  if (!canUseLocalStorage()) return 'light';
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isTheme(raw) ? raw : 'light';
  } catch {
    return 'light';
  }
}

/** Persist the selection. Best-effort — blocked storage simply won't survive reloads. */
export function storeTheme(theme: Theme): void {
  if (!canUseLocalStorage()) return;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // ignore
  }
}

/** Resolve a selection to the concrete scheme ('system' follows the OS). */
export function resolveTheme(theme: Theme): 'light' | 'dark' {
  return theme === 'dark' || (theme === 'system' && prefersDarkScheme()) ? 'dark' : 'light';
}

/** Apply a selection to <html class="dark">. Idempotent — safe to call repeatedly. */
export function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined') return;
  document.documentElement.classList.toggle('dark', resolveTheme(theme) === 'dark');
}
