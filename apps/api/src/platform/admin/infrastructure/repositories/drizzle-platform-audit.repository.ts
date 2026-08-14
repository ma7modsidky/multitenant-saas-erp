import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { DRIZZLE_DB, type DrizzleDb } from '../../../../core/database/drizzle.provider.js';
import type { TxOrDb } from '../../../../core/database/repository.base.js';
import { type PlatformAuditEntry, type PlatformAuditRepository } from '../../ports/index.js';

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
}
