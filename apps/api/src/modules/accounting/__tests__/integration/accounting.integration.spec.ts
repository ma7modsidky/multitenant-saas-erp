import { describe, expect, it } from 'vitest';

import { accountingDescriptor } from '../../accounting.descriptor.js';

// Integration tests for the accounting module run against real Postgres with RLS
// active (TESTING.md §4). Add use-case-level tests here once implemented.
describe('accounting module integration', () => {
  it('registers a valid module descriptor', () => {
    expect(accountingDescriptor.key).toBe('accounting');
    expect(accountingDescriptor.tablePrefix).toBe('acc_');
  });
});
