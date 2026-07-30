import { describe, expect, it, beforeEach } from 'vitest';

import type { EntitlementEntry } from '../entitlement-store.interface.js';
import { InMemoryEntitlementStore } from '../entitlement-store.js';
import { EntitlementService } from '../entitlement.service.js';

describe('InMemoryEntitlementStore', () => {
  let store: InMemoryEntitlementStore;

  beforeEach(() => {
    store = new InMemoryEntitlementStore();
  });

  describe('findByOrgAndModule', () => {
    it('returns undefined for a non-existent entitlement', async () => {
      const result = await store.findByOrgAndModule('org-1', 'inventory');
      expect(result).toBeUndefined();
    });

    it('returns the entitlement when it exists', async () => {
      const entry: EntitlementEntry = {
        moduleKey: 'inventory',
        organizationId: 'org-1',
        state: 'active',
        trialStartedAt: null,
        trialEndsAt: null,
        activatedAt: '2026-01-01T00:00:00Z',
        disabledAt: null,
        purgeAfter: null,
      };
      await store.upsert(entry);

      const result = await store.findByOrgAndModule('org-1', 'inventory');
      expect(result).toBeDefined();
      expect(result!.moduleKey).toBe('inventory');
      expect(result!.organizationId).toBe('org-1');
      expect(result!.state).toBe('active');
    });

    it('returns undefined for a different org with same module', async () => {
      const entry: EntitlementEntry = {
        moduleKey: 'inventory',
        organizationId: 'org-1',
        state: 'active',
        trialStartedAt: null,
        trialEndsAt: null,
        activatedAt: '2026-01-01T00:00:00Z',
        disabledAt: null,
        purgeAfter: null,
      };
      await store.upsert(entry);

      const result = await store.findByOrgAndModule('org-2', 'inventory');
      expect(result).toBeUndefined();
    });

    it('returns undefined for same org but different module', async () => {
      const entry: EntitlementEntry = {
        moduleKey: 'inventory',
        organizationId: 'org-1',
        state: 'active',
        trialStartedAt: null,
        trialEndsAt: null,
        activatedAt: '2026-01-01T00:00:00Z',
        disabledAt: null,
        purgeAfter: null,
      };
      await store.upsert(entry);

      const result = await store.findByOrgAndModule('org-1', 'pos');
      expect(result).toBeUndefined();
    });
  });

  describe('findByOrg', () => {
    it('returns empty array for org with no entitlements', async () => {
      const results = await store.findByOrg('org-1');
      expect(results).toEqual([]);
    });

    it('returns all entitlements for an organization', async () => {
      await store.upsert({
        moduleKey: 'crm',
        organizationId: 'org-1',
        state: 'active',
        trialStartedAt: null,
        trialEndsAt: null,
        activatedAt: null,
        disabledAt: null,
        purgeAfter: null,
      });
      await store.upsert({
        moduleKey: 'inventory',
        organizationId: 'org-1',
        state: 'active',
        trialStartedAt: null,
        trialEndsAt: null,
        activatedAt: null,
        disabledAt: null,
        purgeAfter: null,
      });

      const results = await store.findByOrg('org-1');
      expect(results).toHaveLength(2);
    });

    it('does not include entitlements from other orgs', async () => {
      await store.upsert({
        moduleKey: 'inventory',
        organizationId: 'org-1',
        state: 'active',
        trialStartedAt: null,
        trialEndsAt: null,
        activatedAt: null,
        disabledAt: null,
        purgeAfter: null,
      });
      await store.upsert({
        moduleKey: 'pos',
        organizationId: 'org-2',
        state: 'active',
        trialStartedAt: null,
        trialEndsAt: null,
        activatedAt: null,
        disabledAt: null,
        purgeAfter: null,
      });

      const results = await store.findByOrg('org-1');
      expect(results).toHaveLength(1);
      expect(results[0]!.moduleKey).toBe('inventory');
    });
  });

  describe('updateState', () => {
    it('updates the state of an existing entitlement', async () => {
      await store.upsert({
        moduleKey: 'inventory',
        organizationId: 'org-1',
        state: 'active',
        trialStartedAt: null,
        trialEndsAt: null,
        activatedAt: null,
        disabledAt: null,
        purgeAfter: null,
      });

      await store.updateState('org-1', 'inventory', 'disabled');
      const result = await store.findByOrgAndModule('org-1', 'inventory');
      expect(result!.state).toBe('disabled');
    });

    it('does nothing when entitlement does not exist', async () => {
      // Should not throw
      await store.updateState('org-1', 'inventory', 'disabled');
      const result = await store.findByOrgAndModule('org-1', 'inventory');
      expect(result).toBeUndefined();
    });
  });
});

describe('EntitlementService', () => {
  let store: InMemoryEntitlementStore;
  let service: EntitlementService;

  beforeEach(() => {
    store = new InMemoryEntitlementStore();
    service = new EntitlementService(store);
  });

  describe('isEntitled', () => {
    it('returns false when no entitlement record exists', async () => {
      const result = await service.isEntitled('org-1', 'inventory');
      expect(result).toBe(false);
    });

    it('BILL-4: returns true when state is active', async () => {
      await seedEntitlement(store, 'org-1', 'inventory', 'active');
      const result = await service.isEntitled('org-1', 'inventory');
      expect(result).toBe(true);
    });

    it('returns true when state is trialing', async () => {
      await seedEntitlement(store, 'org-1', 'inventory', 'trialing');
      const result = await service.isEntitled('org-1', 'inventory');
      expect(result).toBe(true);
    });

    it('BILL-6: returns true when state is past_due (dunning window)', async () => {
      await seedEntitlement(store, 'org-1', 'inventory', 'past_due');
      const result = await service.isEntitled('org-1', 'inventory');
      expect(result).toBe(true);
    });

    it('BILL-3: returns true when state is expired (grace period)', async () => {
      await seedEntitlement(store, 'org-1', 'inventory', 'expired');
      const result = await service.isEntitled('org-1', 'inventory');
      expect(result).toBe(true);
    });

    it('returns false when state is available (not yet enabled)', async () => {
      await seedEntitlement(store, 'org-1', 'inventory', 'available');
      const result = await service.isEntitled('org-1', 'inventory');
      expect(result).toBe(false);
    });

    it('returns false when state is suspended', async () => {
      await seedEntitlement(store, 'org-1', 'inventory', 'suspended');
      const result = await service.isEntitled('org-1', 'inventory');
      expect(result).toBe(false);
    });

    it('BILL-7: returns false when state is disabled', async () => {
      await seedEntitlement(store, 'org-1', 'inventory', 'disabled');
      const result = await service.isEntitled('org-1', 'inventory');
      expect(result).toBe(false);
    });

    it('is isolated per organization', async () => {
      await seedEntitlement(store, 'org-1', 'inventory', 'active');
      const org1Result = await service.isEntitled('org-1', 'inventory');
      const org2Result = await service.isEntitled('org-2', 'inventory');
      expect(org1Result).toBe(true);
      expect(org2Result).toBe(false);
    });
  });

  describe('hasFullAccess', () => {
    it('returns true for active state', async () => {
      await seedEntitlement(store, 'org-1', 'inventory', 'active');
      expect(await service.hasFullAccess('org-1', 'inventory')).toBe(true);
    });

    it('returns true for trialing state', async () => {
      await seedEntitlement(store, 'org-1', 'inventory', 'trialing');
      expect(await service.hasFullAccess('org-1', 'inventory')).toBe(true);
    });

    it('returns true for past_due state', async () => {
      await seedEntitlement(store, 'org-1', 'inventory', 'past_due');
      expect(await service.hasFullAccess('org-1', 'inventory')).toBe(true);
    });

    it('returns false for expired state (read-only grace period)', async () => {
      await seedEntitlement(store, 'org-1', 'inventory', 'expired');
      expect(await service.hasFullAccess('org-1', 'inventory')).toBe(false);
    });

    it('returns false for disabled state', async () => {
      await seedEntitlement(store, 'org-1', 'inventory', 'disabled');
      expect(await service.hasFullAccess('org-1', 'inventory')).toBe(false);
    });

    it('returns false when no entitlement exists', async () => {
      expect(await service.hasFullAccess('org-1', 'inventory')).toBe(false);
    });
  });

  describe('getEntitlement', () => {
    it('returns undefined for non-existent entitlement', async () => {
      const result = await service.getEntitlement('org-1', 'inventory');
      expect(result).toBeUndefined();
    });

    it('returns the full entitlement entry', async () => {
      await seedEntitlement(store, 'org-1', 'inventory', 'active');
      const result = await service.getEntitlement('org-1', 'inventory');
      expect(result).toBeDefined();
      expect(result!.moduleKey).toBe('inventory');
      expect(result!.organizationId).toBe('org-1');
      expect(result!.state).toBe('active');
    });
  });

  describe('getOrganizationEntitlements', () => {
    it('returns empty array for org with no entitlements', async () => {
      const results = await service.getOrganizationEntitlements('org-1');
      expect(results).toEqual([]);
    });

    it('returns all entitlements for an organization', async () => {
      await seedEntitlement(store, 'org-1', 'crm', 'active');
      await seedEntitlement(store, 'org-1', 'inventory', 'trialing');
      await seedEntitlement(store, 'org-1', 'pos', 'disabled');

      const results = await service.getOrganizationEntitlements('org-1');
      expect(results).toHaveLength(3);
    });

    it('excludes entitlements from other orgs', async () => {
      await seedEntitlement(store, 'org-1', 'inventory', 'active');
      await seedEntitlement(store, 'org-2', 'pos', 'active');

      const results = await service.getOrganizationEntitlements('org-1');
      expect(results).toHaveLength(1);
      expect(results[0]!.moduleKey).toBe('inventory');
    });
  });

  describe('hasState', () => {
    it('returns true when state matches', async () => {
      await seedEntitlement(store, 'org-1', 'inventory', 'active');
      expect(await service.hasState('org-1', 'inventory', 'active')).toBe(true);
    });

    it('returns false when state does not match', async () => {
      await seedEntitlement(store, 'org-1', 'inventory', 'active');
      expect(await service.hasState('org-1', 'inventory', 'disabled')).toBe(false);
    });

    it('returns false when no entitlement exists', async () => {
      expect(await service.hasState('org-1', 'inventory', 'active')).toBe(false);
    });
  });

  // ─── Helpers ─────────────────────────────────────────────────────────────

  async function seedEntitlement(
    s: InMemoryEntitlementStore,
    orgId: string,
    moduleKey: string,
    state: string,
  ): Promise<void> {
    await s.upsert({
      moduleKey,
      organizationId: orgId,
      state: state as EntitlementEntry['state'],
      trialStartedAt: null,
      trialEndsAt: null,
      activatedAt: state === 'active' ? '2026-01-01T00:00:00Z' : null,
      disabledAt: state === 'disabled' ? '2026-03-01T00:00:00Z' : null,
      purgeAfter: null,
    });
  }
});
