import { Injectable } from '@nestjs/common';

import { type EntitlementEntry, type EntitlementState, type IEntitlementStore } from './entitlement-store.interface.js';

/**
 * InMemoryEntitlementStore — Phase 1.6 in-memory stub.
 *
 * Replaced with DrizzleEntitlementStore in Phase 2+ once the
 * core_module_entitlements table migration exists.
 *
 * This store is seeded by tests and the initialisation hook.
 * It is NOT persistent — data is lost on restart.
 */
@Injectable()
export class InMemoryEntitlementStore implements IEntitlementStore {
  private readonly store = new Map<string, EntitlementEntry>();

  private key(organizationId: string, moduleKey: string): string {
    return `${organizationId}:${moduleKey}`;
  }

  async findByOrgAndModule(organizationId: string, moduleKey: string): Promise<EntitlementEntry | undefined> {
    return this.store.get(this.key(organizationId, moduleKey));
  }

  async findByOrg(organizationId: string): Promise<EntitlementEntry[]> {
    const prefix = `${organizationId}:`;
    const results: EntitlementEntry[] = [];

    for (const [k, v] of this.store) {
      if (k.startsWith(prefix)) {
        results.push(v);
      }
    }

    return results;
  }

  async upsert(entry: EntitlementEntry): Promise<void> {
    this.store.set(this.key(entry.organizationId, entry.moduleKey), { ...entry });
  }

  async updateState(organizationId: string, moduleKey: string, state: EntitlementState): Promise<void> {
    const existing = this.store.get(this.key(organizationId, moduleKey));
    if (existing) {
      this.store.set(this.key(organizationId, moduleKey), {
        ...existing,
        state,
      });
    }
  }
}
