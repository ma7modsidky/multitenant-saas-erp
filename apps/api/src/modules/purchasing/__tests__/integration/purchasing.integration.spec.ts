import { describe, expect, it } from 'vitest';

import { purchasingDescriptor } from '../../purchasing.descriptor.js';

// Integration tests for the purchasing module run against real Postgres with RLS
// active (TESTING.md §4). Add use-case-level tests here once implemented.
describe('purchasing module integration', () => {
  it('registers a valid module descriptor', () => {
    expect(purchasingDescriptor.key).toBe('purchasing');
    expect(purchasingDescriptor.tablePrefix).toBe('pur_');
  });
});
