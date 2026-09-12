import type { TxOrDb } from '../../../../core/database/repository.base.js';
import { type PipelineData } from '../../domain/index.js';

/**
 * PipelineRepository — persistence interface for CRM pipelines (+ stages).
 *
 * RLS scopes every query to the current organization.
 *
 * @see DATA_MODEL.md §2 — Tenancy via RLS
 */
export interface PipelineRepository {
  /** Find a pipeline (non-deleted) with its stages ordered by position. */
  findById(id: string, tx?: TxOrDb): Promise<PipelineData | undefined>;

  /**
   * CRM-3: find the organization's default pipeline with its stages.
   * Returns undefined when none exists — the caller triggers the lazy ensure.
   */
  findDefault(tx?: TxOrDb): Promise<PipelineData | undefined>;

  /**
   * CRM-17: list every non-deleted pipeline of the organization with its
   * stages, ordered by creation (the default first — the UI's initial pick).
   */
  listAll(tx?: TxOrDb): Promise<PipelineData[]>;

  /**
   * Insert a pipeline together with all of its stages, in one statement
   * sequence (called inside the use case's transaction).
   */
  insert(data: PipelineData, tx?: TxOrDb): Promise<PipelineData>;

  /**
   * CRM-17: update a pipeline's mutable header (name, owning team).
   * Stage edits go through the dedicated stage methods below so each
   * invariant (CRM-4/5) is validated on the domain entity first.
   */
  update(
    id: string,
    data: Partial<Pick<PipelineData, 'nameI18n' | 'ownerTeamId' | 'updatedBy'>>,
    tx?: TxOrDb,
  ): Promise<PipelineData | undefined>;

  /** CRM-3: flip the default flag. Exactly-one-default is a DB partial unique index. */
  setDefault(id: string, tx?: TxOrDb): Promise<void>;

  /**
   * CRM-17: soft-delete a pipeline (markDeleted already rejects the default).
   * The caller is responsible for handling deals that still reference it
   * (blocked when open deals exist — see DeletePipelineUseCase).
   */
  softDelete(id: string, tx?: TxOrDb): Promise<void>;

  /**
   * CRM-5: persist a full stage reorder (positions rewritten 0..n-1).
   * The domain entity has already validated the order; this writes it.
   */
  reorderStages(
    pipelineId: string,
    orderedStageIds: readonly string[],
    updatedBy: string | null,
    tx?: TxOrDb,
  ): Promise<PipelineData | undefined>;

  /** Count non-deleted OPEN deals referencing the pipeline (delete guard). */
  countOpenDeals(pipelineId: string, tx?: TxOrDb): Promise<number>;
}

/** Injection token for the PipelineRepository. */
export const PIPELINE_REPOSITORY = Symbol('PIPELINE_REPOSITORY');
