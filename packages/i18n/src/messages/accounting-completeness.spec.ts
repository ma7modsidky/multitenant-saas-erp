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

describe('Accounting message catalogs', () => {
  it('has the same accounting keys in en, ar, fr, and es', () => {
    const expected = keys(en.modules.accounting);
    expect(keys(ar.modules.accounting)).toEqual(expected);
    expect(keys(fr.modules.accounting)).toEqual(expected);
    expect(keys(es.modules.accounting)).toEqual(expected);
  });
});
