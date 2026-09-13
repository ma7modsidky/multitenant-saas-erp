import { describe, expect, it } from 'vitest';

import ar from './ar/index.js';
import en from './en/index.js';
import es from './es/index.js';
import fr from './fr/index.js';

function keys(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) return [prefix];
  return Object.entries(value)
    .flatMap(([key, child]) => keys(child, prefix ? `${prefix}.${key}` : key))
    .sort();
}

describe('Landing message catalogs', () => {
  it('has the same landing keys in en, ar, fr, and es', () => {
    const expected = keys(en.landing);
    expect(expected.length).toBeGreaterThan(50);
    expect(keys(ar.landing)).toEqual(expected);
    expect(keys(fr.landing)).toEqual(expected);
    expect(keys(es.landing)).toEqual(expected);
  });
});
