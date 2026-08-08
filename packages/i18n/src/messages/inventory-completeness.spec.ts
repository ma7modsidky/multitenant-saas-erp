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

describe('Inventory message catalogs', () => {
  it('has the same inventory keys in en, ar, fr, and es', () => {
    const expected = keys(en.modules.inventory);
    expect(keys(ar.modules.inventory)).toEqual(expected);
    expect(keys(fr.modules.inventory)).toEqual(expected);
    expect(keys(es.modules.inventory)).toEqual(expected);
  });
});
