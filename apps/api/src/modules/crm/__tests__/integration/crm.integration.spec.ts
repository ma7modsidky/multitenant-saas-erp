import { describe, expect, it } from 'vitest';

import { crmDescriptor } from '../../crm.descriptor.js';

// Integration tests for the crm module run against real Postgres with RLS
// active (TESTING.md §4). Add use-case-level tests here once implemented.
describe('crm module integration', () => {
  it('registers a valid module descriptor', () => {
    expect(crmDescriptor.key).toBe('crm');
    expect(crmDescriptor.tablePrefix).toBe('crm_');
  });
});
