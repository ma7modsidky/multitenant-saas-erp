import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { fromDbDate, toDbDate } from '../../../../core/database/db-date.js';
import { DRIZZLE_DB, type DrizzleDb } from '../../../../core/database/drizzle.provider.js';
import type { TxOrDb } from '../../../../core/database/repository.base.js';
import { type NoteData, type NoteRepository } from '../../application/ports/index.js';

/**
 * DrizzleNoteRepository — Drizzle implementation of NoteRepository.
 *
 * RLS scopes all queries to the current organization.
 */
@Injectable()
export class DrizzleNoteRepository implements NoteRepository {
  private readonly table = sql.identifier('crm_notes');

  constructor(
    @Inject(DRIZZLE_DB)
    private readonly db: DrizzleDb,
  ) {}

  private getDb(tx?: TxOrDb): PostgresJsDatabase {
    return (tx ?? this.db) as PostgresJsDatabase;
  }

  async insert(data: NoteData, tx?: TxOrDb): Promise<NoteData> {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(
      sql`
        INSERT INTO ${this.table}
          (id, organization_id, body, related_type, related_id,
           created_at, updated_at, created_by, updated_by)
        VALUES
          (${data.id}, ${data.organizationId}, ${data.body}, ${data.relatedType}, ${data.relatedId},
           ${toDbDate(data.createdAt)}, ${toDbDate(data.updatedAt)}, ${data.createdBy}, ${data.updatedBy})
        RETURNING *
      `,
    );
    const row = rows[0];
    if (!row) throw new Error('INSERT RETURNING returned no rows');
    return {
      id: row.id as string,
      organizationId: row.organization_id as string,
      body: row.body as string,
      relatedType: row.related_type as string,
      relatedId: row.related_id as string,
      createdAt: fromDbDate(row.created_at) as Date,
      updatedAt: fromDbDate(row.updated_at) as Date,
      createdBy: (row.created_by as string | null) ?? null,
      updatedBy: (row.updated_by as string | null) ?? null,
      deletedAt: fromDbDate(row.deleted_at),
    };
  }

  async reassignRelated(relatedType: string, fromId: string, toId: string, tx?: TxOrDb): Promise<number> {
    const db = this.getDb(tx);
    const result = await db.execute<Record<string, unknown>>(
      sql`UPDATE ${this.table} SET related_id = ${toId}, updated_at = NOW()
          WHERE related_type = ${relatedType} AND related_id = ${fromId} AND deleted_at IS NULL`,
    );
    return Number((result as unknown as { count?: number })?.count ?? 0);
  }
}
