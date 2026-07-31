import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { DRIZZLE_DB, type DrizzleDb } from '../../../../core/database/drizzle.provider.js';
import type { TxOrDb } from '../../../../core/database/repository.base.js';
import { type AuditLogRepository } from '../../ports/index.js';

@Injectable()
export class DrizzleAuditLogRepository implements AuditLogRepository {
  constructor(
    @Inject(DRIZZLE_DB)
    private readonly db: DrizzleDb,
  ) {}

  private getDb(tx?: TxOrDb): PostgresJsDatabase {
    return (tx ?? this.db) as PostgresJsDatabase;
  }

  async query(
    filters: {
      organizationId: string;
      actorUserId?: string;
      entityType?: string;
      entityId?: string;
      action?: string;
      fromDate?: string;
      toDate?: string;
      limit?: number;
      offset?: number;
    },
    tx?: TxOrDb,
  ): Promise<{
    entries: Array<{
      id: string;
      actorUserId: string | null;
      actorType: string;
      action: string;
      entityType: string;
      entityId: string;
      before: Record<string, unknown> | null;
      after: Record<string, unknown> | null;
      ip: string | null;
      correlationId: string | null;
      occurredAt: Date;
    }>;
    total: number;
  }> {
    const db = this.getDb(tx);
    const limit = filters.limit ?? 50;
    const offset = filters.offset ?? 0;

    // Build conditions using sql template fragments for proper parameterization
    const conditions = [sql`organization_id = ${filters.organizationId}`];
    if (filters.actorUserId) conditions.push(sql`actor_user_id = ${filters.actorUserId}`);
    if (filters.entityType) conditions.push(sql`entity_type = ${filters.entityType}`);
    if (filters.entityId) conditions.push(sql`entity_id = ${filters.entityId}`);
    if (filters.action) conditions.push(sql`action = ${filters.action}`);
    if (filters.fromDate) conditions.push(sql`occurred_at >= ${filters.fromDate}::timestamptz`);
    if (filters.toDate) conditions.push(sql`occurred_at <= ${filters.toDate}::timestamptz`);

    const whereClause = conditions.length > 0
      ? sql`WHERE ${sql.join(conditions, sql` AND `)}`
      : sql``;

    // Count query
    const countRows = await db.execute<Record<string, unknown>>(
      sql`SELECT COUNT(*) as total FROM core_audit_log ${whereClause}`,
    );
    const total = Number(countRows[0]?.total ?? 0);

    // Data query
    const dataRows = await db.execute<Record<string, unknown>>(
      sql`
        SELECT id, actor_user_id, actor_type, action, entity_type, entity_id, "before", "after", ip, correlation_id, occurred_at
        FROM core_audit_log ${whereClause}
        ORDER BY occurred_at DESC, id DESC
        LIMIT ${limit} OFFSET ${offset}
      `,
    );

    const entries = dataRows.map((row) => ({
      id: row.id as string,
      actorUserId: row.actor_user_id as string | null,
      actorType: row.actor_type as string,
      action: row.action as string,
      entityType: row.entity_type as string,
      entityId: row.entity_id as string,
      before: row.before as Record<string, unknown> | null,
      after: row.after as Record<string, unknown> | null,
      ip: row.ip as string | null,
      correlationId: row.correlation_id as string | null,
      occurredAt: row.occurred_at as Date,
    }));

    return { entries, total };
  }
}
