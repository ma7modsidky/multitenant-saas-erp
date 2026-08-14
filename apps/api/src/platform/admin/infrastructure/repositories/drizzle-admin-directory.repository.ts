import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { fromDbDate } from '../../../../core/database/db-date.js';
import { DRIZZLE_DB, type DrizzleDb } from '../../../../core/database/drizzle.provider.js';
import type { TxOrDb } from '../../../../core/database/repository.base.js';
import { type AdminDirectoryRepository, type AdminOrgRow } from '../../ports/index.js';

/**
 * DrizzleAdminDirectoryRepository — global reads over core_organizations /
 * core_users for the admin console.
 *
 * Both tables are GLOBAL (no RLS), so raw reads are safe. Per-organization
 * tenant state (subscriptions, members, entitlements) is fetched separately
 * by the use cases inside `TransactionManager.runWithOrg` (PLT-3).
 */
@Injectable()
export class DrizzleAdminDirectoryRepository implements AdminDirectoryRepository {
  constructor(
    @Inject(DRIZZLE_DB)
    private readonly db: DrizzleDb,
  ) {}

  private getDb(tx?: TxOrDb): PostgresJsDatabase {
    return (tx ?? this.db) as PostgresJsDatabase;
  }

  private rowToOrg(row: Record<string, unknown>): AdminOrgRow {
    return {
      id: row.id as string,
      name: row.name as string,
      slug: row.slug as string,
      status: row.status as string,
      createdAt: fromDbDate(row.created_at) as Date,
    };
  }

  async listOrgs(search: string | undefined, limit: number, offset: number, tx?: TxOrDb): Promise<AdminOrgRow[]> {
    const db = this.getDb(tx);
    const searchCond = search ? sql`AND (name ILIKE ${`%${search}%`} OR slug ILIKE ${`%${search}%`})` : sql``;
    const rows = await db.execute<Record<string, unknown>>(
      sql`
        SELECT id, name, slug, status, created_at
        FROM core_organizations
        WHERE 1 = 1 ${searchCond}
        ORDER BY created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `,
    );
    return rows.map((r) => this.rowToOrg(r));
  }

  async countOrgs(search: string | undefined, tx?: TxOrDb): Promise<number> {
    const db = this.getDb(tx);
    const searchCond = search ? sql`WHERE name ILIKE ${`%${search}%`} OR slug ILIKE ${`%${search}%`}` : sql``;
    const rows = await db.execute<{ count: string }>(
      sql`SELECT COUNT(*) AS count FROM core_organizations ${searchCond}`,
    );
    return Number(rows[0]?.count ?? 0);
  }

  async countUsers(tx?: TxOrDb): Promise<number> {
    const db = this.getDb(tx);
    const rows = await db.execute<{ count: string }>(sql`SELECT COUNT(*) AS count FROM core_users`);
    return Number(rows[0]?.count ?? 0);
  }

  async findOrgById(id: string, tx?: TxOrDb): Promise<AdminOrgRow | undefined> {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(
      sql`SELECT id, name, slug, status, created_at FROM core_organizations WHERE id = ${id} LIMIT 1`,
    );
    const row = rows[0];
    if (!row) return undefined;
    return this.rowToOrg(row);
  }
}
