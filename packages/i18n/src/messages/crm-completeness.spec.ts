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

describe('CRM message catalogs', () => {
  it('has the same CRM keys in en, ar, fr, and es', () => {
    const expected = keys(en.modules.crm);
    expect(keys(ar.modules.crm)).toEqual(expected);
    expect(keys(fr.modules.crm)).toEqual(expected);
    expect(keys(es.modules.crm)).toEqual(expected);
  });
});
