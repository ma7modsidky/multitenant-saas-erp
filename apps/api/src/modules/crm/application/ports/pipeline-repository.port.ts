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
   * Insert a pipeline together with all of its stages, in one statement
   * sequence (called inside the use case's transaction).
   */
  insert(data: PipelineData, tx?: TxOrDb): Promise<PipelineData>;
}

/** Injection token for the PipelineRepository. */
export const PIPELINE_REPOSITORY = Symbol('PIPELINE_REPOSITORY');
