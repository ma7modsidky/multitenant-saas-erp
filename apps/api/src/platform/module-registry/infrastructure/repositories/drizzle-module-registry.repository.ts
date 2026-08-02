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
