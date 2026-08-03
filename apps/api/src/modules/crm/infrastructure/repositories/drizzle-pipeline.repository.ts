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

  async insert(data: PipelineData, tx?: TxOrDb): Promise<PipelineData> {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(
      sql`
        INSERT INTO ${this.pipelinesTable}
          (id, organization_id, name_i18n, is_default, created_at, updated_at, created_by, updated_by)
        VALUES
          (${data.id}, ${data.organizationId}, ${JSON.stringify(data.nameI18n)}::jsonb,
           ${data.isDefault}, ${toDbDate(data.createdAt)}, ${toDbDate(data.updatedAt)},
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
