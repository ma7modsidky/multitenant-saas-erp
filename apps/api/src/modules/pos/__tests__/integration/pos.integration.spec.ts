import { describe, expect, it } from 'vitest';

import { posDescriptor } from '../../pos.descriptor.js';

// Integration tests for the pos module run against real Postgres with RLS
// active (TESTING.md §4). Add use-case-level tests here once implemented.
describe('pos module integration', () => {
  it('registers a valid module descriptor', () => {
    expect(posDescriptor.key).toBe('pos');
    expect(posDescriptor.tablePrefix).toBe('pos_');
  });
});
