import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { fromDbDate, toDbDate } from '../../../../core/database/db-date.js';
import { DRIZZLE_DB, type DrizzleDb } from '../../../../core/database/drizzle.provider.js';
import type { TxOrDb } from '../../../../core/database/repository.base.js';
import { type DealRepository } from '../../application/ports/index.js';
import { type DealData, type DealStageHistoryData } from '../../domain/index.js';

/**
 * DrizzleDealRepository — Drizzle implementation of DealRepository.
 *
 * RLS scopes all queries to the current organization. Stage history is
 * append-only (CRM-6) — appendHistory only ever INSERTs.
 */
@Injectable()
export class DrizzleDealRepository implements DealRepository {
  private readonly dealsTable = sql.identifier('crm_deals');
  private readonly historyTable = sql.identifier('crm_deal_stage_history');

  constructor(
    @Inject(DRIZZLE_DB)
    private readonly db: DrizzleDb,
  ) {}

  private getDb(tx?: TxOrDb): PostgresJsDatabase {
    return (tx ?? this.db) as PostgresJsDatabase;
  }

  async findById(id: string, tx?: TxOrDb): Promise<DealData | undefined> {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(
      sql`SELECT * FROM ${this.dealsTable} WHERE id = ${id} AND deleted_at IS NULL LIMIT 1`,
    );
    const row = rows[0];
    if (!row) return undefined;
    const history = await this.loadHistory(db, id);
    return this.rowToDeal(row, history);
  }

  async insert(data: DealData, tx?: TxOrDb): Promise<DealData> {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(
      sql`
        INSERT INTO ${this.dealsTable}
          (id, organization_id, title, pipeline_id, stage_id, contact_id, company_id,
           value_amount_minor, value_currency, exchange_rate, base_amount_minor,
           expected_close_date, status, closed_at, lost_reason_code, owner_user_id,
           created_at, updated_at, created_by, updated_by)
        VALUES
          (${data.id}, ${data.organizationId}, ${data.title}, ${data.pipelineId}, ${data.stageId},
           ${data.contactId}, ${data.companyId},
           ${data.valueAmountMinor}, ${data.valueCurrency}, ${data.exchangeRate}, ${data.baseAmountMinor},
           ${toDbDate(data.expectedCloseDate)}, ${data.status}, ${toDbDate(data.closedAt)},
           ${data.lostReasonCode}, ${data.ownerUserId},
           ${toDbDate(data.createdAt)}, ${toDbDate(data.updatedAt)}, ${data.createdBy}, ${data.updatedBy})
        RETURNING *
      `,
    );
    const row = rows[0];
    if (!row) throw new Error('INSERT RETURNING returned no rows');
    return this.rowToDeal(row, []);
  }

  async update(id: string, data: Partial<DealData>, tx?: TxOrDb): Promise<DealData | undefined> {
    const db = this.getDb(tx);
    const setFragments: ReturnType<typeof sql>[] = [sql`updated_at = NOW()`];

    if (data.title !== undefined) setFragments.push(sql`title = ${data.title}`);
    if (data.stageId !== undefined) setFragments.push(sql`stage_id = ${data.stageId}`);
    if (data.contactId !== undefined) setFragments.push(sql`contact_id = ${data.contactId}`);
    if (data.companyId !== undefined) setFragments.push(sql`company_id = ${data.companyId}`);
    if (data.valueAmountMinor !== undefined) setFragments.push(sql`value_amount_minor = ${data.valueAmountMinor}`);
    if (data.valueCurrency !== undefined) setFragments.push(sql`value_currency = ${data.valueCurrency}`);
    if (data.exchangeRate !== undefined) setFragments.push(sql`exchange_rate = ${data.exchangeRate}`);
    if (data.baseAmountMinor !== undefined) setFragments.push(sql`base_amount_minor = ${data.baseAmountMinor}`);
    if (data.status !== undefined) setFragments.push(sql`status = ${data.status}`);
    if (data.closedAt !== undefined) setFragments.push(sql`closed_at = ${toDbDate(data.closedAt)}`);
    if (data.lostReasonCode !== undefined) setFragments.push(sql`lost_reason_code = ${data.lostReasonCode}`);
    if (data.expectedCloseDate !== undefined) {
      setFragments.push(sql`expected_close_date = ${toDbDate(data.expectedCloseDate)}`);
    }
    if (data.ownerUserId !== undefined) setFragments.push(sql`owner_user_id = ${data.ownerUserId}`);
    if (data.updatedBy !== undefined) setFragments.push(sql`updated_by = ${data.updatedBy}`);

    const setClause = sql.join(setFragments, sql.raw(', '));
    const rows = await db.execute<Record<string, unknown>>(
      sql`UPDATE ${this.dealsTable} SET ${setClause} WHERE id = ${id} AND deleted_at IS NULL RETURNING *`,
    );
    const row = rows[0];
    if (!row) return undefined;
    const history = await this.loadHistory(db, id);
    return this.rowToDeal(row, history);
  }

  async appendHistory(entry: DealStageHistoryData, tx?: TxOrDb): Promise<void> {
    const db = this.getDb(tx);
    await db.execute(
      sql`
        INSERT INTO ${this.historyTable}
          (id, organization_id, deal_id, from_stage_id, to_stage_id,
           moved_at, moved_by, duration_seconds, created_at)
        VALUES
          (${entry.id}, ${entry.organizationId}, ${entry.dealId}, ${entry.fromStageId},
           ${entry.toStageId}, ${toDbDate(entry.movedAt)}, ${entry.movedBy},
           ${entry.durationSeconds}, ${toDbDate(entry.createdAt)})
      `,
    );
  }

  async reassignContact(fromContactId: string, toContactId: string, tx?: TxOrDb): Promise<number> {
    const db = this.getDb(tx);
    const result = await db.execute<Record<string, unknown>>(
      sql`UPDATE ${this.dealsTable} SET contact_id = ${toContactId}, updated_at = NOW()
          WHERE contact_id = ${fromContactId} AND deleted_at IS NULL`,
    );
    return Number((result as unknown as { count?: number })?.count ?? 0);
  }

  private async loadHistory(db: PostgresJsDatabase, dealId: string): Promise<DealStageHistoryData[]> {
    const rows = await db.execute<Record<string, unknown>>(
      sql`SELECT * FROM ${this.historyTable} WHERE deal_id = ${dealId} ORDER BY moved_at ASC`,
    );
    return rows.map((r) => this.rowToHistory(r));
  }

  private rowToDeal(row: Record<string, unknown>, history: DealStageHistoryData[]): DealData {
    return {
      id: row.id as string,
      organizationId: row.organization_id as string,
      title: row.title as string,
      pipelineId: row.pipeline_id as string,
      stageId: row.stage_id as string,
      contactId: (row.contact_id as string | null) ?? null,
      companyId: (row.company_id as string | null) ?? null,
      valueAmountMinor: BigInt(row.value_amount_minor as string),
      valueCurrency: row.value_currency as string,
      exchangeRate: row.exchange_rate === null ? null : Number(row.exchange_rate),
      baseAmountMinor: row.base_amount_minor === null ? null : BigInt(row.base_amount_minor as string),
      expectedCloseDate: fromDbDate(row.expected_close_date),
      status: row.status as DealData['status'],
      closedAt: fromDbDate(row.closed_at),
      lostReasonCode: (row.lost_reason_code as string | null) ?? null,
      ownerUserId: (row.owner_user_id as string | null) ?? null,
      stageHistory: history,
      createdAt: fromDbDate(row.created_at) as Date,
      updatedAt: fromDbDate(row.updated_at) as Date,
      createdBy: (row.created_by as string | null) ?? null,
      updatedBy: (row.updated_by as string | null) ?? null,
      deletedAt: fromDbDate(row.deleted_at),
    };
  }

  private rowToHistory(row: Record<string, unknown>): DealStageHistoryData {
    return {
      id: row.id as string,
      organizationId: row.organization_id as string,
      dealId: row.deal_id as string,
      fromStageId: (row.from_stage_id as string | null) ?? null,
      toStageId: row.to_stage_id as string,
      movedAt: fromDbDate(row.moved_at) as Date,
      movedBy: row.moved_by as string,
      durationSeconds: Number(row.duration_seconds),
      createdAt: fromDbDate(row.created_at) as Date,
    };
  }
}
