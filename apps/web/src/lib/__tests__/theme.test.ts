// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { applyTheme, getStoredTheme, resolveTheme, storeTheme, THEME_STORAGE_KEY } from '../theme';

describe('theme persistence', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.classList.remove('dark');
  });

  // Captured at module load — the setup shim guarantees it works; restored
  // after any test that replaces it.
  const originalLocalStorage = window.localStorage;

  afterEach(() => {
    // Reset the mock installed by mockPrefersDark (jsdom has no matchMedia).
    Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true, value: undefined });
    Object.defineProperty(window, 'localStorage', { configurable: true, value: originalLocalStorage });
  });

  /** jsdom has no matchMedia — install one that reports the given preference. */
  function mockPrefersDark(dark: boolean): void {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: (query: string) => ({ matches: dark, media: query }),
    });
  }

  it('defaults to light when nothing is stored', () => {
    expect(getStoredTheme()).toBe('light');
  });

  it('reads a stored selection back', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    expect(getStoredTheme()).toBe('dark');
  });

  it('falls back to light for a corrupt value', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'neon');
    expect(getStoredTheme()).toBe('light');
  });

  it('persists a selection through storeTheme', () => {
    storeTheme('dark');
    expect(getStoredTheme()).toBe('dark');
    storeTheme('system');
    expect(getStoredTheme()).toBe('system');
  });

  it('is a no-op when localStorage is unavailable', () => {
    Object.defineProperty(window, 'localStorage', { value: undefined, configurable: true });
    expect(getStoredTheme()).toBe('light');
    expect(() => storeTheme('dark')).not.toThrow();
    expect(getStoredTheme()).toBe('light');
  });

  it('resolves explicit selections without touching matchMedia', () => {
    expect(resolveTheme('dark')).toBe('dark');
    expect(resolveTheme('light')).toBe('light');
  });

  it("resolves 'system' to the OS preference", () => {
    mockPrefersDark(true);
    expect(resolveTheme('system')).toBe('dark');
    mockPrefersDark(false);
    expect(resolveTheme('system')).toBe('light');
  });

  it("resolves 'system' to light when matchMedia is unavailable", () => {
    expect(resolveTheme('system')).toBe('light');
  });

  it('toggles the dark class on <html> for explicit selections', () => {
    applyTheme('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    applyTheme('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it("applies the dark class for 'system' only when the OS prefers dark", () => {
    mockPrefersDark(true);
    applyTheme('system');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    mockPrefersDark(false);
    applyTheme('system');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });
});
