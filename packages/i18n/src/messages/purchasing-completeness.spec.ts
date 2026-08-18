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

describe('Purchasing message catalogs', () => {
  it('has the same purchasing keys in en, ar, fr, and es', () => {
    const expected = keys(en.modules.purchasing);
    expect(keys(ar.modules.purchasing)).toEqual(expected);
    expect(keys(fr.modules.purchasing)).toEqual(expected);
    expect(keys(es.modules.purchasing)).toEqual(expected);
  });

  it('has the same purchasing error keys in en, ar, fr, and es', () => {
    const expected = keys(en.errors.purchasing);
    expect(keys(ar.errors.purchasing)).toEqual(expected);
    expect(keys(fr.errors.purchasing)).toEqual(expected);
    expect(keys(es.errors.purchasing)).toEqual(expected);
  });
});
