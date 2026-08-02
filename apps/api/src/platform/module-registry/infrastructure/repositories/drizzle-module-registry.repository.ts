import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { DRIZZLE_DB, type DrizzleDb } from '../../../../core/database/drizzle.provider.js';
import type { TxOrDb } from '../../../../core/database/repository.base.js';
import { type ModuleRegistryRepository } from '../../ports/index.js';

@Injectable()
export class DrizzleModuleRegistryRepository implements ModuleRegistryRepository {
  constructor(
    @Inject(DRIZZLE_DB)
    private readonly db: DrizzleDb,
  ) {}

  private getDb(tx?: TxOrDb): PostgresJsDatabase {
    return (tx ?? this.db) as PostgresJsDatabase;
  }

  async getModule(
    key: string,
    tx?: TxOrDb,
  ): Promise<
    | {
        key: string;
        name: string;
        description: string | null;
        icon: string | null;
        dependsOn: string[];
        stripePriceKey: string | null;
        trialDays: number;
      }
    | undefined
  > {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(
      sql`SELECT key, name, description, icon, depends_on, stripe_price_key, trial_days
          FROM core_module_catalog WHERE key = ${key} LIMIT 1`,
    );
    const row = rows[0];
    if (!row) return undefined;
    return {
      key: row.key as string,
      name: row.name as string,
      description: row.description as string | null,
      icon: row.icon as string | null,
      dependsOn: row.depends_on as string[],
      stripePriceKey: row.stripe_price_key as string | null,
      trialDays: row.trial_days as number,
    };
  }

  async upsertModule(
    data: {
      key: string;
      version: string;
      name: string;
      description: string | null;
      icon: string | null;
      dependsOn: string[];
      tablePrefix: string;
      stripePriceKey: string | null;
      trialDays: number;
    },
    tx?: TxOrDb,
  ): Promise<void> {
    const db = this.getDb(tx);
    await db.execute(sql`
      INSERT INTO core_module_catalog (key, version, name, description, icon, depends_on, table_prefix, stripe_price_key, trial_days, created_at, updated_at)
      VALUES (${data.key}, ${data.version}, ${data.name}, ${data.description}, ${data.icon},
              ARRAY[${sql.join(
                data.dependsOn.map((d) => sql`${d}`),
                sql.raw(','),
              )}]::text[], ${data.tablePrefix}, ${data.stripePriceKey}, ${data.trialDays}, NOW(), NOW())
      ON CONFLICT (key) DO UPDATE SET
        version = EXCLUDED.version,
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        icon = EXCLUDED.icon,
        depends_on = EXCLUDED.depends_on,
        table_prefix = EXCLUDED.table_prefix,
        stripe_price_key = EXCLUDED.stripe_price_key,
        trial_days = EXCLUDED.trial_days,
        updated_at = NOW()
    `);
  }

  async listModules(tx?: TxOrDb): Promise<
    Array<{
      key: string;
      name: string;
      description: string | null;
      icon: string | null;
      dependsOn: string[];
      trialDays: number;
    }>
  > {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(
      sql`SELECT key, name, description, icon, depends_on, trial_days FROM core_module_catalog ORDER BY key`,
    );
    return rows.map((r) => ({
      key: r.key as string,
      name: r.name as string,
      description: r.description as string | null,
      icon: r.icon as string | null,
      dependsOn: r.depends_on as string[],
      trialDays: r.trial_days as number,
    }));
  }

  async pruneStaleModules(registeredKeys: string[]): Promise<{ removed: string[]; kept: string[] }> {
    const db = this.getDb();

    if (registeredKeys.length === 0) {
      // Nothing to keep — never emit `NOT IN ()`, which is invalid SQL. (The
      // boot registry always registers the core modules, so this is defensive.)
      return { removed: [], kept: [] };
    }

    // The catalog is mirrored from descriptors at boot, so any row whose key is
    // not among the registered descriptors is stale and must be removed. This
    // keeps the marketplace (which reads core_module_catalog) in sync when a
    // module is removed from registered-modules.ts.
    const stale = await db.execute<Record<string, unknown>>(
      sql`SELECT key FROM core_module_catalog WHERE key NOT IN (${sql.join(
        registeredKeys.map((k) => sql`${k}`),
        sql.raw(', '),
      )})`,
    );

    const removed: string[] = [];
    const kept: string[] = [];

    for (const row of stale) {
      const key = row.key as string;

      // A module still referenced by a dependent row cannot be pruned. The FK
      // constraints are NO ACTION and `core_module_entitlements` /
      // `core_role_permissions` are RLS-protected, so from the boot context (no
      // tenant bound) we cannot pre-check references — the FK violation itself
      // is the guard. Because these are global non-RLS tables, the app role can
      // DELETE directly (no TransactionManager tenant context needed).
      try {
        // Permissions MUST go first: core_permissions.module_key FKs to the
        // catalog, so the catalog row cannot be deleted while its permissions
        // exist. This delete throws 23503 only if a core_role_permissions row
        // still references a permission — in that case the whole key is kept.
        await db.execute(sql`DELETE FROM core_permissions WHERE module_key = ${key}`);
        await db.execute(sql`DELETE FROM core_module_catalog WHERE key = ${key}`);
        removed.push(key);
      } catch (err) {
        const code = (err as { code?: string } | undefined)?.code;
        if (code !== '23503') {
          throw err;
        }
        // A dependent row (entitlement or role permission) still references this
        // module — keep the catalog row so that reference stays valid. Note the
        // permissions may already be gone in the entitlement-only case; this is
        // benign because permissions are re-mirrored from the descriptor if the
        // module ever registers again, and a kept module is unregistered.
        kept.push(key);
      }
    }

    return { removed, kept };
  }

  async upsertPermission(key: string, moduleKey: string, description: string | null, tx?: TxOrDb): Promise<void> {
    const db = this.getDb(tx);
    await db.execute(sql`
      INSERT INTO core_permissions (key, module_key, description, created_at)
      VALUES (${key}, ${moduleKey}, ${description}, NOW())
      ON CONFLICT (key) DO UPDATE SET
        module_key = EXCLUDED.module_key,
        description = EXCLUDED.description
    `);
  }

  async listPermissions(tx?: TxOrDb): Promise<Array<{ key: string; moduleKey: string; description: string | null }>> {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(
      sql`SELECT key, module_key, description FROM core_permissions ORDER BY key`,
    );
    return rows.map((r) => ({
      key: r.key as string,
      moduleKey: r.module_key as string,
      description: r.description as string | null,
    }));
  }

  async getEntitlement(organizationId: string, moduleKey: string, tx?: TxOrDb): Promise<{ state: string } | undefined> {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(
      sql`SELECT state FROM core_module_entitlements WHERE organization_id = ${organizationId} AND module_key = ${moduleKey} LIMIT 1`,
    );
    const row = rows[0];
    if (!row) return undefined;
    return { state: row.state as string };
  }

  async listEntitlements(organizationId: string, tx?: TxOrDb): Promise<Array<{ moduleKey: string; state: string }>> {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(
      sql`SELECT module_key, state FROM core_module_entitlements WHERE organization_id = ${organizationId}`,
    );
    return rows.map((r) => ({ moduleKey: r.module_key as string, state: r.state as string }));
  }

  async getDependentModules(moduleKey: string, tx?: TxOrDb): Promise<string[]> {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(
      sql`SELECT key FROM core_module_catalog WHERE ${moduleKey} = ANY(depends_on)`,
    );
    return rows.map((r) => r.key as string);
  }

  async updateEntitlementState(
    organizationId: string,
    moduleKey: string,
    state: string,
    _updatedBy: string,
    tx?: TxOrDb,
  ): Promise<void> {
    const db = this.getDb(tx);
    await db.execute(sql`
      UPDATE core_module_entitlements SET state = ${state}, updated_at = NOW()
      WHERE organization_id = ${organizationId} AND module_key = ${moduleKey}
    `);
  }
}
