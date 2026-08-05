import { describe, expect, it } from 'vitest';

import { inventoryDescriptor } from '../../inventory.descriptor.js';

// Integration tests for the inventory module run against real Postgres with RLS
// active (TESTING.md §4). Add use-case-level tests here once implemented.
describe('inventory module integration', () => {
  it('registers a valid module descriptor', () => {
    expect(inventoryDescriptor.key).toBe('inventory');
    expect(inventoryDescriptor.tablePrefix).toBe('inv_');
  });
});
