import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { fromDbDate } from '../../../../core/database/db-date.js';
import { DRIZZLE_DB, type DrizzleDb } from '../../../../core/database/drizzle.provider.js';
import type { TxOrDb } from '../../../../core/database/repository.base.js';
import { type SaasSettingsRepository } from '../../ports/index.js';

/**
 * DrizzleSaasSettingsRepository — reads/writes core_saas_settings (global,
 * admin-managed, allow-listed keys only — PLT-7).
 */
@Injectable()
export class DrizzleSaasSettingsRepository implements SaasSettingsRepository {
  constructor(
    @Inject(DRIZZLE_DB)
    private readonly db: DrizzleDb,
  ) {}

  private getDb(tx?: TxOrDb): PostgresJsDatabase {
    return (tx ?? this.db) as PostgresJsDatabase;
  }

  async getAll(tx?: TxOrDb): Promise<Array<{ key: string; value: unknown; updatedAt: Date }>> {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(
      sql`SELECT key, value, updated_at FROM core_saas_settings ORDER BY key`,
    );
    return rows.map((r) => ({
      key: r.key as string,
      value: r.value,
      updatedAt: fromDbDate(r.updated_at) as Date,
    }));
  }

  async set(key: string, value: unknown, updatedBy: string | null, tx?: TxOrDb): Promise<void> {
    const db = this.getDb(tx);
    await db.execute(
      sql`
        INSERT INTO core_saas_settings (key, value, updated_by, updated_at)
        VALUES (${key}, ${JSON.stringify(value)}::jsonb, ${updatedBy}, NOW())
        ON CONFLICT (key) DO UPDATE SET
          value       = EXCLUDED.value,
          updated_by  = EXCLUDED.updated_by,
          updated_at  = NOW()
      `,
    );
  }
}
