import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { fromDbDate, toDbDate } from '../../../../core/database/db-date.js';
import { DRIZZLE_DB, type DrizzleDb } from '../../../../core/database/drizzle.provider.js';
import type { TxOrDb } from '../../../../core/database/repository.base.js';
import { type ActivityRepository } from '../../application/ports/index.js';
import { type ActivityData } from '../../domain/index.js';

/**
 * DrizzleActivityRepository — Drizzle implementation of ActivityRepository.
 *
 * RLS scopes all queries to the current organization.
 */
@Injectable()
export class DrizzleActivityRepository implements ActivityRepository {
  private readonly table = sql.identifier('crm_activities');

  constructor(
    @Inject(DRIZZLE_DB)
    private readonly db: DrizzleDb,
  ) {}

  private getDb(tx?: TxOrDb): PostgresJsDatabase {
    return (tx ?? this.db) as PostgresJsDatabase;
  }

  async findById(id: string, tx?: TxOrDb): Promise<ActivityData | undefined> {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(
      sql`SELECT * FROM ${this.table} WHERE id = ${id} AND deleted_at IS NULL LIMIT 1`,
    );
    const row = rows[0];
    if (!row) return undefined;
    return this.rowToActivity(row);
  }

  async insert(data: ActivityData, tx?: TxOrDb): Promise<ActivityData> {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(
      sql`
        INSERT INTO ${this.table}
          (id, organization_id, type, subject, due_at, completed_at,
           related_type, related_id, assigned_to,
           created_at, updated_at, created_by, updated_by)
        VALUES
          (${data.id}, ${data.organizationId}, ${data.type}, ${data.subject},
           ${toDbDate(data.dueAt)}, ${toDbDate(data.completedAt)},
           ${data.relatedType}, ${data.relatedId}, ${data.assignedTo},
           ${toDbDate(data.createdAt)}, ${toDbDate(data.updatedAt)}, ${data.createdBy}, ${data.updatedBy})
        RETURNING *
      `,
    );
    const row = rows[0];
    if (!row) throw new Error('INSERT RETURNING returned no rows');
    return this.rowToActivity(row);
  }

  async update(id: string, data: Partial<ActivityData>, tx?: TxOrDb): Promise<ActivityData | undefined> {
    const db = this.getDb(tx);
    const setFragments: ReturnType<typeof sql>[] = [sql`updated_at = NOW()`];

    if (data.type !== undefined) setFragments.push(sql`type = ${data.type}`);
    if (data.subject !== undefined) setFragments.push(sql`subject = ${data.subject}`);
    if (data.dueAt !== undefined) setFragments.push(sql`due_at = ${toDbDate(data.dueAt)}`);
    if (data.completedAt !== undefined) setFragments.push(sql`completed_at = ${toDbDate(data.completedAt)}`);
    if (data.relatedType !== undefined) setFragments.push(sql`related_type = ${data.relatedType}`);
    if (data.relatedId !== undefined) setFragments.push(sql`related_id = ${data.relatedId}`);
    if (data.assignedTo !== undefined) setFragments.push(sql`assigned_to = ${data.assignedTo}`);
    if (data.updatedBy !== undefined) setFragments.push(sql`updated_by = ${data.updatedBy}`);

    const setClause = sql.join(setFragments, sql.raw(', '));
    const rows = await db.execute<Record<string, unknown>>(
      sql`UPDATE ${this.table} SET ${setClause} WHERE id = ${id} AND deleted_at IS NULL RETURNING *`,
    );
    const row = rows[0];
    if (!row) return undefined;
    return this.rowToActivity(row);
  }

  async reassignRelated(relatedType: string, fromId: string, toId: string, tx?: TxOrDb): Promise<number> {
    const db = this.getDb(tx);
    const result = await db.execute<Record<string, unknown>>(
      sql`UPDATE ${this.table} SET related_id = ${toId}, updated_at = NOW()
          WHERE related_type = ${relatedType} AND related_id = ${fromId} AND deleted_at IS NULL`,
    );
    return Number((result as unknown as { count?: number })?.count ?? 0);
  }

  private rowToActivity(row: Record<string, unknown>): ActivityData {
    return {
      id: row.id as string,
      organizationId: row.organization_id as string,
      type: row.type as ActivityData['type'],
      subject: row.subject as string,
      dueAt: fromDbDate(row.due_at),
      completedAt: fromDbDate(row.completed_at),
      relatedType: (row.related_type as string | null) ?? null,
      relatedId: (row.related_id as string | null) ?? null,
      assignedTo: (row.assigned_to as string | null) ?? null,
      createdAt: fromDbDate(row.created_at) as Date,
      updatedAt: fromDbDate(row.updated_at) as Date,
      createdBy: (row.created_by as string | null) ?? null,
      updatedBy: (row.updated_by as string | null) ?? null,
      deletedAt: fromDbDate(row.deleted_at),
    };
  }
}
