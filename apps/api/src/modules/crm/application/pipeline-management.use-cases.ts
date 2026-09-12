import { Inject, Injectable } from '@nestjs/common';

import type { TxOrDb } from '../../../core/database/repository.base.js';
import { NotFoundError } from '../../../core/common/errors.js';
import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';
import { CrmError, CRM_ERROR_CODE, Pipeline, type PipelineData, type PipelineStageData } from '../domain/index.js';

import { PIPELINE_REPOSITORY, type PipelineRepository } from './ports/index.js';

/**
 * Template used to instantiate a pipeline. Stage definitions are i18n maps —
 * at minimum an `en` entry (I18N-5); the org can translate names later.
 */
export interface PipelineTemplate {
  nameI18n: Record<string, string>;
  stages: Array<{
    nameI18n: Record<string, string>;
    probability: number;
    isWon?: boolean;
    isLost?: boolean;
  }>;
}

/**
 * B2B sales pipeline template (CRM-17) — the classic SMB sales flow the user
 * picked to ship alongside the always-available simple default.
 */
export const B2B_SALES_TEMPLATE: PipelineTemplate = {
  nameI18n: { en: 'B2B Sales' },
  stages: [
    { nameI18n: { en: 'New' }, probability: 10 },
    { nameI18n: { en: 'Contacted' }, probability: 20 },
    { nameI18n: { en: 'Proposal' }, probability: 50 },
    { nameI18n: { en: 'Negotiation' }, probability: 70 },
    { nameI18n: { en: 'Won' }, probability: 100, isWon: true },
    { nameI18n: { en: 'Lost' }, probability: 0, isLost: true },
  ],
};

/** All shipped templates (the management page lists these). */
export const PIPELINE_TEMPLATES: Record<string, PipelineTemplate> = {
  b2b_sales: B2B_SALES_TEMPLATE,
};

/**
 * ListPipelinesUseCase — CRM-17: every non-deleted pipeline of the org with
 * its stages. Visibility filtering (team-scoped pipelines) happens in the
 * controller through TEAM_READ_PORT — the repository returns the org's set,
 * RLS already tenant-scoped.
 */
@Injectable()
export class ListPipelinesUseCase {
  constructor(
    @Inject(PIPELINE_REPOSITORY)
    private readonly pipelineRepo: PipelineRepository,
    private readonly tx: TransactionManager,
  ) {}
  execute(): Promise<PipelineData[]> {
    return this.tx.run((db) => this.pipelineRepo.listAll(db));
  }
}

/**
 * CreatePipelineUseCase — CRM-4/5 validate the stage set through the domain
 * entity; CRM-3 allows at most one default (flipping is a separate action,
 * so a created pipeline is never default unless it is the org's first).
 */
@Injectable()
export class CreatePipelineUseCase {
  constructor(
    @Inject(PIPELINE_REPOSITORY)
    private readonly pipelineRepo: PipelineRepository,
    private readonly tx: TransactionManager,
  ) {}

  async execute(input: {
    nameI18n: Record<string, string>;
    ownerTeamId?: string | null;
    stages: Array<{ nameI18n: Record<string, string>; probability: number; isWon?: boolean; isLost?: boolean }>;
  }): Promise<PipelineData> {
    const organizationId = TenantContext.requireOrganizationId();
    const userId = TenantContext.getUserId() ?? null;
    const now = new Date();

    return this.tx.run(async (db) => {
      const existing = await this.pipelineRepo.listAll(db);
      const isDefault = existing.length === 0; // the org's first pipeline is the default
      const pipelineId = crypto.randomUUID();
      const stages: PipelineStageData[] = input.stages.map((stage, position) => ({
        id: crypto.randomUUID(),
        organizationId,
        pipelineId,
        nameI18n: stage.nameI18n,
        position,
        probability: stage.probability,
        isWon: Boolean(stage.isWon ?? false),
        isLost: Boolean(stage.isLost ?? false),
        createdAt: now,
        updatedAt: now,
        createdBy: userId,
        updatedBy: userId,
        deletedAt: null,
      }));
      // CRM-4 + CRM-5: the domain rejects invalid stage sets (no won/lost
      // stage, duplicated flags, non-contiguous positions).
      const pipeline = Pipeline.create({
        id: pipelineId,
        organizationId,
        nameI18n: input.nameI18n,
        isDefault,
        ownerTeamId: input.ownerTeamId ?? null,
        stages,
        createdAt: now,
        updatedAt: now,
        createdBy: userId,
        updatedBy: userId,
        deletedAt: null,
      });
      return this.pipelineRepo.insert(pipeline.toJSON(), db);
    });
  }
}

/**
 * UpdatePipelineUseCase — rename, reassign the owning team. Stage edits are a
 * separate use case so CRM-5 reordering is atomic and audited on its own.
 */
@Injectable()
export class UpdatePipelineUseCase {
  constructor(
    @Inject(PIPELINE_REPOSITORY)
    private readonly pipelineRepo: PipelineRepository,
    private readonly tx: TransactionManager,
  ) {}

  async execute(
    id: string,
    input: {
      nameI18n?: Record<string, string>;
      ownerTeamId?: string | null;
    },
  ): Promise<PipelineData> {
    const userId = TenantContext.getUserId() ?? null;
    return this.tx.run(async (db) => {
      const existing = await this.pipelineRepo.findById(id, db);
      if (!existing) throw new NotFoundError('PIPELINE_NOT_FOUND', { pipelineId: id });
      const updated = await this.pipelineRepo.update(
        id,
        {
          ...(input.nameI18n !== undefined ? { nameI18n: input.nameI18n } : {}),
          ...(input.ownerTeamId !== undefined ? { ownerTeamId: input.ownerTeamId } : {}),
          updatedBy: userId,
        },
        db,
      );
      if (!updated) throw new NotFoundError('PIPELINE_NOT_FOUND', { pipelineId: id });
      return updated;
    });
  }
}

/**
 * ReorderPipelineStagesUseCase — CRM-5: rewrite every position atomically.
 * The domain entity validates the new order (every stage exactly once) before
 * persistence; the whole set is updated inside the caller's transaction.
 */
@Injectable()
export class ReorderPipelineStagesUseCase {
  constructor(
    @Inject(PIPELINE_REPOSITORY)
    private readonly pipelineRepo: PipelineRepository,
    private readonly tx: TransactionManager,
  ) {}

  async execute(pipelineId: string, orderedStageIds: readonly string[]): Promise<PipelineData> {
    const userId = TenantContext.getUserId() ?? null;
    return this.tx.run(async (db) => {
      const existing = await this.pipelineRepo.findById(pipelineId, db);
      if (!existing) throw new NotFoundError('PIPELINE_NOT_FOUND', { pipelineId });
      // CRM-5: the domain entity validates the new order (every stage exactly
      // once) BEFORE anything is written — a rejected reorder leaves the
      // pipeline untouched.
      const pipeline = Pipeline.fromPersistence(existing);
      pipeline.reorderStages(orderedStageIds, userId ?? 'system');
      const updated = await this.pipelineRepo.reorderStages(pipelineId, orderedStageIds, userId, db);
      if (!updated) throw new NotFoundError('PIPELINE_NOT_FOUND', { pipelineId });
      return updated;
    });
  }
}

/**
 * SetDefaultPipelineUseCase — CRM-3: promote a pipeline to the org default.
 * Exactly one default is enforced by the repository flip inside one
 * transaction (plus the DB partial unique index as backstop).
 */
@Injectable()
export class SetDefaultPipelineUseCase {
  constructor(
    @Inject(PIPELINE_REPOSITORY)
    private readonly pipelineRepo: PipelineRepository,
    private readonly tx: TransactionManager,
  ) {}

  async execute(id: string): Promise<void> {
    await this.tx.run(async (db) => {
      const existing = await this.pipelineRepo.findById(id, db);
      if (!existing) throw new NotFoundError('PIPELINE_NOT_FOUND', { pipelineId: id });
      if (existing.isDefault) return; // idempotent
      await this.pipelineRepo.setDefault(id, db);
    });
  }
}

/**
 * DeletePipelineUseCase — CRM-3: the default cannot be deleted (domain
 * guard); a pipeline with open deals cannot be deleted either — move or close
 * them first (data is never silently orphaned).
 */
@Injectable()
export class DeletePipelineUseCase {
  constructor(
    @Inject(PIPELINE_REPOSITORY)
    private readonly pipelineRepo: PipelineRepository,
    private readonly tx: TransactionManager,
  ) {}

  async execute(id: string): Promise<void> {
    const userId = TenantContext.getUserId() ?? null;
    await this.tx.run(async (db) => {
      const existing = await this.pipelineRepo.findById(id, db);
      if (!existing) throw new NotFoundError('PIPELINE_NOT_FOUND', { pipelineId: id });
      // CRM-3 (domain guard throws CRM_PIPELINE_DEFAULT_DELETE).
      const pipeline = Pipeline.fromPersistence(existing);
      pipeline.markDeleted(userId ?? 'system');
      // Refuse to orphan open deals — a typed 422 business error the client
      // can map to a localized message (I18N-2).
      const openDeals = await this.pipelineRepo.countOpenDeals(id, db);
      if (openDeals > 0) {
        throw new CrmError(
          CRM_ERROR_CODE.PIPELINE_HAS_OPEN_DEALS,
          `The pipeline still has ${openDeals} open deal(s). Move or close them first.`,
          { openDeals },
        );
      }
      await this.pipelineRepo.softDelete(id, db);
    });
  }
}

// Re-exported for the module wiring; keeps CRM error codes authoritative.
export { CRM_ERROR_CODE };
