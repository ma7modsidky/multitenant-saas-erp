import { describe, expect, it } from 'vitest';

import { crmDescriptor } from '../../crm.descriptor.js';

/**
 * Tenant-isolation tests for the crm module (TESTING.md §6).
 *
 * Required cases once the module has data + endpoints:
 *  - cross-org read / update / delete / list ⇒ denied (RLS)
 *  - injected organizationId ignored
 *  - no tenant context ⇒ zero rows (fail closed)
 *  - entitlement denial (MODULE_NOT_ENTITLED)
 *  - permission denial
 */
describe('crm isolation', () => {
  it('registers a valid module descriptor', () => {
    expect(crmDescriptor.key).toBe('crm');
  });
});
