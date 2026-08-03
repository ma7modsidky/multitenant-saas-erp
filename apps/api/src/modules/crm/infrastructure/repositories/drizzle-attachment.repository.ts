import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { fromDbDate, toDbDate } from '../../../../core/database/db-date.js';
import { DRIZZLE_DB, type DrizzleDb } from '../../../../core/database/drizzle.provider.js';
import type { TxOrDb } from '../../../../core/database/repository.base.js';
import { type AttachmentData, type AttachmentRepository } from '../../application/ports/index.js';

/**
 * DrizzleAttachmentRepository — Drizzle implementation of AttachmentRepository.
 *
 * RLS scopes all queries to the current organization.
 */
@Injectable()
export class DrizzleAttachmentRepository implements AttachmentRepository {
  private readonly table = sql.identifier('crm_attachments');

  constructor(
    @Inject(DRIZZLE_DB)
    private readonly db: DrizzleDb,
  ) {}

  private getDb(tx?: TxOrDb): PostgresJsDatabase {
    return (tx ?? this.db) as PostgresJsDatabase;
  }

  async insert(data: AttachmentData, tx?: TxOrDb): Promise<AttachmentData> {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(
      sql`
        INSERT INTO ${this.table}
          (id, organization_id, storage_key, filename, mime_type, size_bytes,
           related_type, related_id, created_at, updated_at, created_by, updated_by)
        VALUES
          (${data.id}, ${data.organizationId}, ${data.storageKey}, ${data.filename},
           ${data.mimeType}, ${data.sizeBytes}, ${data.relatedType}, ${data.relatedId},
           ${toDbDate(data.createdAt)}, ${toDbDate(data.updatedAt)}, ${data.createdBy}, ${data.updatedBy})
        RETURNING *
      `,
    );
    const row = rows[0];
    if (!row) throw new Error('INSERT RETURNING returned no rows');
    return {
      id: row.id as string,
      organizationId: row.organization_id as string,
      storageKey: row.storage_key as string,
      filename: row.filename as string,
      mimeType: row.mime_type as string,
      sizeBytes: BigInt(row.size_bytes as string),
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
