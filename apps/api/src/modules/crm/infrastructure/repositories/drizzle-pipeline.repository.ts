import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { fromDbDate, toDbDate } from '../../../../core/database/db-date.js';
import { DRIZZLE_DB, type DrizzleDb } from '../../../../core/database/drizzle.provider.js';
import type { TxOrDb } from '../../../../core/database/repository.base.js';
import { type PipelineRepository } from '../../application/ports/index.js';
import { type PipelineData, type PipelineStageData } from '../../domain/index.js';

/**
 * DrizzlePipelineRepository — Drizzle implementation of PipelineRepository.
 *
 * RLS scopes all queries to the current organization. Pipelines and their
 * stages are read and written together (CRM-4/5 invariants live in the domain).
 */
@Injectable()
export class DrizzlePipelineRepository implements PipelineRepository {
  private readonly pipelinesTable = sql.identifier('crm_pipelines');
  private readonly stagesTable = sql.identifier('crm_pipeline_stages');

  constructor(
    @Inject(DRIZZLE_DB)
    private readonly db: DrizzleDb,
  ) {}

  private getDb(tx?: TxOrDb): PostgresJsDatabase {
    return (tx ?? this.db) as PostgresJsDatabase;
  }

  async findById(id: string, tx?: TxOrDb): Promise<PipelineData | undefined> {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(
      sql`SELECT * FROM ${this.pipelinesTable} WHERE id = ${id} AND deleted_at IS NULL LIMIT 1`,
    );
    const row = rows[0];
    if (!row) return undefined;
    const stages = await this.loadStages(db, id);
    return this.rowToPipeline(row, stages);
  }

  async findDefault(tx?: TxOrDb): Promise<PipelineData | undefined> {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(
      sql`SELECT * FROM ${this.pipelinesTable}
          WHERE is_default = true AND deleted_at IS NULL
          ORDER BY created_at ASC LIMIT 1`,
    );
    const row = rows[0];
    if (!row) return undefined;
    const stages = await this.loadStages(db, row.id as string);
    return this.rowToPipeline(row, stages);
  }

  async listAll(tx?: TxOrDb): Promise<PipelineData[]> {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(
      sql`SELECT * FROM ${this.pipelinesTable}
          WHERE deleted_at IS NULL
          ORDER BY is_default DESC, created_at ASC`,
    );
    const pipelines: PipelineData[] = [];
    for (const row of rows) {
      const stages = await this.loadStages(db, row.id as string);
      pipelines.push(this.rowToPipeline(row, stages));
    }
    return pipelines;
  }

  async insert(data: PipelineData, tx?: TxOrDb): Promise<PipelineData> {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(
      sql`
        INSERT INTO ${this.pipelinesTable}
          (id, organization_id, name_i18n, is_default, owner_team_id, created_at, updated_at, created_by, updated_by)
        VALUES
          (${data.id}, ${data.organizationId}, ${JSON.stringify(data.nameI18n)}::jsonb,
           ${data.isDefault}, ${data.ownerTeamId ?? null}, ${toDbDate(data.createdAt)}, ${toDbDate(data.updatedAt)},
           ${data.createdBy}, ${data.updatedBy})
        RETURNING *
      `,
    );
    const row = rows[0];
    if (!row) throw new Error('INSERT RETURNING returned no rows');

    for (const stage of data.stages) {
      await db.execute(
        sql`
          INSERT INTO ${this.stagesTable}
            (id, organization_id, pipeline_id, name_i18n, position, probability,
             is_won, is_lost, created_at, updated_at, created_by, updated_by)
          VALUES
            (${stage.id}, ${stage.organizationId}, ${stage.pipelineId},
             ${JSON.stringify(stage.nameI18n)}::jsonb, ${stage.position}, ${stage.probability},
             ${stage.isWon}, ${stage.isLost}, ${toDbDate(stage.createdAt)},
             ${toDbDate(stage.updatedAt)}, ${stage.createdBy}, ${stage.updatedBy})
        `,
      );
    }

    const stages = await this.loadStages(db, data.id);
    return this.rowToPipeline(row, stages);
  }

  async update(
    id: string,
    data: Partial<Pick<PipelineData, 'nameI18n' | 'ownerTeamId' | 'updatedBy'>>,
    tx?: TxOrDb,
  ): Promise<PipelineData | undefined> {
    const db = this.getDb(tx);
    const setFragments: ReturnType<typeof sql>[] = [sql`updated_at = NOW()`];
    if (data.nameI18n !== undefined) setFragments.push(sql`name_i18n = ${JSON.stringify(data.nameI18n)}::jsonb`);
    if (data.ownerTeamId !== undefined) setFragments.push(sql`owner_team_id = ${data.ownerTeamId}`);
    if (data.updatedBy !== undefined) setFragments.push(sql`updated_by = ${data.updatedBy}`);
    const setClause = sql.join(setFragments, sql.raw(', '));
    const rows = await db.execute<Record<string, unknown>>(
      sql`UPDATE ${this.pipelinesTable} SET ${setClause}
          WHERE id = ${id} AND deleted_at IS NULL
          RETURNING *`,
    );
    const row = rows[0];
    if (!row) return undefined;
    const stages = await this.loadStages(db, id);
    return this.rowToPipeline(row, stages);
  }

  async setDefault(id: string, tx?: TxOrDb): Promise<void> {
    const db = this.getDb(tx);
    // The partial unique index on (organization_id) WHERE is_default enforces
    // CRM-3; clearing others first keeps the flip valid inside the caller's
    // transaction.
    await db.execute(sql`UPDATE ${this.pipelinesTable} SET is_default = false, updated_at = NOW()
                        WHERE is_default = true AND deleted_at IS NULL`);
    await db.execute(sql`UPDATE ${this.pipelinesTable} SET is_default = true, updated_at = NOW()
                        WHERE id = ${id} AND deleted_at IS NULL`);
  }

  async softDelete(id: string, tx?: TxOrDb): Promise<void> {
    const db = this.getDb(tx);
    await db.execute(
      sql`UPDATE ${this.pipelinesTable} SET deleted_at = NOW(), updated_at = NOW()
          WHERE id = ${id} AND deleted_at IS NULL`,
    );
  }

  async reorderStages(
    pipelineId: string,
    orderedStageIds: readonly string[],
    updatedBy: string | null,
    tx?: TxOrDb,
  ): Promise<PipelineData | undefined> {
    const db = this.getDb(tx);
    // One UPDATE per stage; the caller's transaction makes the rewrite
    // atomic (CRM-5) — a failure rolls every position back together.
    for (let position = 0; position < orderedStageIds.length; position++) {
      await db.execute(
        sql`UPDATE ${this.stagesTable}
            SET position = ${position}, updated_at = NOW(), updated_by = ${updatedBy}
            WHERE pipeline_id = ${pipelineId} AND id = ${orderedStageIds[position]} AND deleted_at IS NULL`,
      );
    }
    return this.findById(pipelineId, tx);
  }

  async countOpenDeals(pipelineId: string, tx?: TxOrDb): Promise<number> {
    const db = this.getDb(tx);
    const rows = await db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM crm_deals
          WHERE pipeline_id = ${pipelineId} AND status = 'open' AND deleted_at IS NULL`,
    );
    return Number(rows[0]?.n ?? 0);
  }

  private async loadStages(db: PostgresJsDatabase, pipelineId: string): Promise<PipelineStageData[]> {
    const rows = await db.execute<Record<string, unknown>>(
      sql`SELECT * FROM ${this.stagesTable}
          WHERE pipeline_id = ${pipelineId} AND deleted_at IS NULL
          ORDER BY position ASC`,
    );
    return rows.map((r) => this.rowToStage(r));
  }

  private rowToPipeline(row: Record<string, unknown>, stages: PipelineStageData[]): PipelineData {
    return {
      id: row.id as string,
      organizationId: row.organization_id as string,
      nameI18n: row.name_i18n as Record<string, string>,
      isDefault: row.is_default as boolean,
      ownerTeamId: (row.owner_team_id as string | null) ?? null,
      stages,
      createdAt: fromDbDate(row.created_at) as Date,
      updatedAt: fromDbDate(row.updated_at) as Date,
      createdBy: (row.created_by as string | null) ?? null,
      updatedBy: (row.updated_by as string | null) ?? null,
      deletedAt: fromDbDate(row.deleted_at),
    };
  }

  private rowToStage(row: Record<string, unknown>): PipelineStageData {
    return {
      id: row.id as string,
      organizationId: row.organization_id as string,
      pipelineId: row.pipeline_id as string,
      nameI18n: row.name_i18n as Record<string, string>,
      position: row.position as number,
      probability: row.probability as number,
      isWon: row.is_won as boolean,
      isLost: row.is_lost as boolean,
      createdAt: fromDbDate(row.created_at) as Date,
      updatedAt: fromDbDate(row.updated_at) as Date,
      createdBy: (row.created_by as string | null) ?? null,
      updatedBy: (row.updated_by as string | null) ?? null,
      deletedAt: fromDbDate(row.deleted_at),
    };
  }
}
