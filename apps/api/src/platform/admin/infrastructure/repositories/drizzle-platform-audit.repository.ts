import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { fromDbDate } from '../../../../core/database/db-date.js';
import { DRIZZLE_DB, type DrizzleDb } from '../../../../core/database/drizzle.provider.js';
import type { TxOrDb } from '../../../../core/database/repository.base.js';
import { type PlatformAuditEntry, type PlatformAuditLogRow, type PlatformAuditRepository } from '../../ports/index.js';

/**
 * DrizzlePlatformAuditRepository — appends entries to core_platform_audit_log
 * (global, append-only). This is the separately audited code path TEN-5
 * requires for platform administration (PLT-4); there is intentionally no
 * update/delete path (AUD-2).
 */
@Injectable()
export class DrizzlePlatformAuditRepository implements PlatformAuditRepository {
  constructor(
    @Inject(DRIZZLE_DB)
    private readonly db: DrizzleDb,
  ) {}

  private getDb(tx?: TxOrDb): PostgresJsDatabase {
    return (tx ?? this.db) as PostgresJsDatabase;
  }

  async insert(entry: PlatformAuditEntry, tx?: TxOrDb): Promise<void> {
    const db = this.getDb(tx);
    await db.execute(
      sql`
        INSERT INTO core_platform_audit_log
          (actor_user_id, actor_email, action, entity_type, entity_id, before, after, metadata)
        VALUES
          (${entry.actorUserId}, ${entry.actorEmail}, ${entry.action}, ${entry.entityType}, ${entry.entityId},
           ${entry.before == null ? null : JSON.stringify(entry.before)}::jsonb,
           ${entry.after == null ? null : JSON.stringify(entry.after)}::jsonb,
           ${entry.metadata == null ? null : JSON.stringify(entry.metadata)}::jsonb)
      `,
    );
  }

  async listByOrg(organizationId: string, limit: number, tx?: TxOrDb): Promise<PlatformAuditLogRow[]> {
    const db = this.getDb(tx);
    const rows = await db.execute<{
      id: string;
      action: string;
      actor_user_id: string | null;
      actor_email: string | null;
      before: unknown;
      after: unknown;
      metadata: unknown;
      // postgres-js returns timestamptz as an ISO string in this pool.
      occurred_at: string | Date;
    }>(sql`
      SELECT id, action, actor_user_id, actor_email, before, after, metadata, occurred_at
      FROM core_platform_audit_log
      WHERE entity_type = 'organization' AND entity_id = ${organizationId}
      ORDER BY occurred_at DESC
      LIMIT ${limit}
    `);
    return rows.map((row) => ({
      id: row.id,
      action: row.action,
      actorUserId: row.actor_user_id ?? null,
      actorEmail: row.actor_email ?? null,
      before: (row.before ?? null) as Record<string, unknown> | null,
      after: (row.after ?? null) as Record<string, unknown> | null,
      metadata: (row.metadata ?? null) as Record<string, unknown> | null,
      // occurred_at is NOT NULL; the shared helper normalizes string or Date.
      occurredAt: fromDbDate(row.occurred_at) as Date,
    }));
  }
}
