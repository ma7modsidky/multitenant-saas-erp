import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { DRIZZLE_DB, type DrizzleDb } from '../../../../core/database/drizzle.provider.js';
import type { TxOrDb } from '../../../../core/database/repository.base.js';
import { type ModulePricingRepository, type ModulePricingRow } from '../../ports/index.js';

/**
 * DrizzleModulePricingRepository — reads/writes core_module_pricing joined to
 * core_module_catalog. Both tables are GLOBAL (no RLS): the catalog is
 * boot-mirrored reference data and pricing is admin-managed (PLT-6).
 */
@Injectable()
export class DrizzleModulePricingRepository implements ModulePricingRepository {
  constructor(
    @Inject(DRIZZLE_DB)
    private readonly db: DrizzleDb,
  ) {}

  private getDb(tx?: TxOrDb): PostgresJsDatabase {
    return (tx ?? this.db) as PostgresJsDatabase;
  }

  async listWithCatalog(tx?: TxOrDb): Promise<ModulePricingRow[]> {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(
      sql`
        SELECT c.key, c.name, c.description, c.icon, c.depends_on,
               COALESCE(p.price_monthly_minor, 0) AS price_monthly_minor,
               COALESCE(p.price_yearly_minor, 0) AS price_yearly_minor,
               COALESCE(p.currency, 'USD')        AS currency
        FROM core_module_catalog c
        LEFT JOIN core_module_pricing p ON p.module_key = c.key
        ORDER BY c.key
      `,
    );
    return rows.map((r) => ({
      moduleKey: r.key as string,
      name: r.name as string,
      description: (r.description as string | null) ?? null,
      icon: (r.icon as string | null) ?? null,
      dependsOn: (r.depends_on as string[]) ?? [],
      priceMonthlyMinor: String((r.price_monthly_minor as number | null) ?? 0),
      priceYearlyMinor: String((r.price_yearly_minor as number | null) ?? 0),
      currency: (r.currency as string) ?? 'USD',
    }));
  }

  async upsert(
    data: {
      moduleKey: string;
      priceMonthlyMinor: string;
      priceYearlyMinor: string;
      currency: string;
      updatedBy: string | null;
    },
    tx?: TxOrDb,
  ): Promise<void> {
    const db = this.getDb(tx);
    await db.execute(
      sql`
        INSERT INTO core_module_pricing
          (module_key, price_monthly_minor, price_yearly_minor, currency, updated_by, updated_at)
        VALUES
          (${data.moduleKey}, ${data.priceMonthlyMinor}, ${data.priceYearlyMinor}, ${data.currency}, ${data.updatedBy}, NOW())
        ON CONFLICT (module_key) DO UPDATE SET
          price_monthly_minor = EXCLUDED.price_monthly_minor,
          price_yearly_minor  = EXCLUDED.price_yearly_minor,
          currency            = EXCLUDED.currency,
          updated_by          = EXCLUDED.updated_by,
          updated_at          = NOW()
      `,
    );
  }
}
