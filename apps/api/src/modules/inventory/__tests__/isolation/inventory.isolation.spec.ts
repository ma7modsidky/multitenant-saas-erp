import { describe, expect, it } from 'vitest';

import { inventoryDescriptor } from '../../inventory.descriptor.js';

/**
 * Tenant-isolation tests for the inventory module (TESTING.md §6).
 *
 * Required cases once the module has data + endpoints:
 *  - cross-org read / update / delete / list ⇒ denied (RLS)
 *  - injected organizationId ignored
 *  - no tenant context ⇒ zero rows (fail closed)
 *  - entitlement denial (MODULE_NOT_ENTITLED)
 *  - permission denial
 */
describe('inventory isolation', () => {
  it('registers a valid module descriptor', () => {
    expect(inventoryDescriptor.key).toBe('inventory');
  });
});
