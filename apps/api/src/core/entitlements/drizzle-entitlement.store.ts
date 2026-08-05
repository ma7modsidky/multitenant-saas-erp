import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import { fromDbDate } from '../database/db-date.js';
import { DRIZZLE_DB, type DrizzleDb } from '../database/drizzle.provider.js';

import {
  ALL_ENTITLEMENT_STATES,
  type EntitlementEntry,
  type EntitlementState,
  type IEntitlementStore,
} from './entitlement-store.interface.js';

/**
 * Row shape returned by core_module_entitlements queries.
 */
type EntitlementRow = {
  id: string;
  organization_id: string;
  module_key: string;
  state: string;
  trial_started_at: string | Date | null;
  trial_ends_at: string | Date | null;
  activated_at: string | Date | null;
  disabled_at: string | Date | null;
  purge_after: string | Date | null;
};

/** Parse a stored state string, failing closed to `available` on unknown values. */
function parseState(value: string): EntitlementState {
  for (const state of ALL_ENTITLEMENT_STATES) {
    if (state === value) return state;
  }
  return 'available';
}

/**
 * Normalize a raw timestamptz value (string | Date | null) to the ISO-string
 * shape of EntitlementEntry. postgres-js returns timestamptz columns as
 * strings (identity parser, see db-date.ts), so `fromDbDate` handles both.
 */
function isoOrNull(value: unknown): string | null {
  const date = fromDbDate(value);
  return date ? date.toISOString() : null;
}

/**
 * DrizzleEntitlementStore — entitlement persistence backed by
 * core_module_entitlements (BILL-4: the runtime authority for module access).
 *
 * This replaces the Phase 1.6 InMemoryEntitlementStore stub so that the
 * EntitlementGuard reflects trial/enable/disable writes made through the
 * billing platform immediately (no restart, no stale in-memory copy).
 *
 * ## Why this store binds the tenant itself (and why that is safe)
 *
 * The EntitlementGuard runs BEFORE the TenantInterceptor — NestJS executes
 * guards before interceptors — so TenantContext is not yet populated and
 * `TransactionManager.run()` (which requires it) cannot be used here. Each
 * method therefore opens its own transaction and binds
 * `app.current_organization_id` to the organization id taken from the
 * *verified access-token claims* (`request.user.organizationId`), which is the
 * same session-derived value the tenant middleware would bind — never client
 * input. RLS remains the real defence: the org bound is the only org any
 * query can see, and an unbound/unknown org returns zero rows (fail closed).
 *
 * @see BILL-4 — core_module_entitlements is the runtime authority
 * @see DATA_MODEL.md §2 — Per-request binding / RLS pattern
 * @see ARCHITECTURE.md §5 — Request lifecycle (EntitlementGuard runs pre-interceptor)
 */
@Injectable()
export class DrizzleEntitlementStore implements IEntitlementStore {
  constructor(
    @Inject(DRIZZLE_DB)
    private readonly db: DrizzleDb,
  ) {}

  private rowToEntry(row: EntitlementRow): EntitlementEntry {
    return {
      moduleKey: row.module_key,
      organizationId: row.organization_id,
      state: parseState(row.state),
      trialStartedAt: isoOrNull(row.trial_started_at),
      trialEndsAt: isoOrNull(row.trial_ends_at),
      activatedAt: isoOrNull(row.activated_at),
      disabledAt: isoOrNull(row.disabled_at),
      purgeAfter: isoOrNull(row.purge_after),
    };
  }

  async findByOrgAndModule(organizationId: string, moduleKey: string): Promise<EntitlementEntry | undefined> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.current_organization_id', ${organizationId}, true)`);
      const rows = await tx.execute<EntitlementRow>(sql`
        SELECT id, organization_id, module_key, state, trial_started_at, trial_ends_at,
               activated_at, disabled_at, purge_after
        FROM core_module_entitlements
        WHERE organization_id = ${organizationId} AND module_key = ${moduleKey}
        LIMIT 1
      `);
      const row = rows[0];
      if (!row) return undefined;
      return this.rowToEntry(row);
    });
  }

  async findByOrg(organizationId: string): Promise<EntitlementEntry[]> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.current_organization_id', ${organizationId}, true)`);
      const rows = await tx.execute<EntitlementRow>(sql`
        SELECT id, organization_id, module_key, state, trial_started_at, trial_ends_at,
               activated_at, disabled_at, purge_after
        FROM core_module_entitlements
        WHERE organization_id = ${organizationId}
      `);
      return rows.map((row) => this.rowToEntry(row));
    });
  }

  async upsert(entry: EntitlementEntry): Promise<void> {
    const { organizationId, moduleKey } = entry;
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.current_organization_id', ${organizationId}, true)`);
      const existing = await tx.execute<{ id: string }>(sql`
        SELECT id FROM core_module_entitlements
        WHERE organization_id = ${organizationId} AND module_key = ${moduleKey}
        LIMIT 1
      `);
      if (existing[0]) {
        await tx.execute(sql`
          UPDATE core_module_entitlements SET
            state = ${entry.state},
            trial_started_at = ${entry.trialStartedAt},
            trial_ends_at = ${entry.trialEndsAt},
            activated_at = ${entry.activatedAt},
            disabled_at = ${entry.disabledAt},
            purge_after = ${entry.purgeAfter},
            updated_at = NOW()
          WHERE id = ${existing[0].id}
        `);
      } else {
        await tx.execute(sql`
          INSERT INTO core_module_entitlements
            (id, organization_id, module_key, state, trial_started_at, trial_ends_at,
             activated_at, disabled_at, purge_after, created_at, updated_at)
          VALUES
            (gen_random_uuid(), ${organizationId}, ${moduleKey}, ${entry.state},
             ${entry.trialStartedAt}, ${entry.trialEndsAt}, ${entry.activatedAt},
             ${entry.disabledAt}, ${entry.purgeAfter}, NOW(), NOW())
        `);
      }
    });
  }

  async updateState(organizationId: string, moduleKey: string, state: EntitlementState): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.current_organization_id', ${organizationId}, true)`);
      await tx.execute(sql`
        UPDATE core_module_entitlements
        SET state = ${state}, updated_at = NOW()
        WHERE organization_id = ${organizationId} AND module_key = ${moduleKey}
      `);
    });
  }
}
