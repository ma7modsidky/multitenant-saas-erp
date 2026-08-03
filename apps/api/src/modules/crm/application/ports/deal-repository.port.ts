import type { TxOrDb } from '../../../../core/database/repository.base.js';
import { type DealData, type DealStageHistoryData } from '../../domain/index.js';

/**
 * DealRepository — persistence interface for CRM deals + stage history.
 *
 * RLS scopes every query to the current organization. The stage history is an
 * append-only ledger (CRM-6) — the repository never updates or deletes rows.
 *
 * @see DATA_MODEL.md §2 — Tenancy via RLS
 */
export interface DealRepository {
  /** Find a deal (non-deleted) with its full stage history (ordered by moved_at). */
  findById(id: string, tx?: TxOrDb): Promise<DealData | undefined>;

  /** Insert a deal. */
  insert(data: DealData, tx?: TxOrDb): Promise<DealData>;

  /** Update a deal's fields (stage, status, value, closed_at, ...). */
  update(id: string, data: Partial<DealData>, tx?: TxOrDb): Promise<DealData | undefined>;

  /** CRM-6: append a stage-history entry. Append-only. */
  appendHistory(entry: DealStageHistoryData, tx?: TxOrDb): Promise<void>;

  /**
   * CRM-12: move all deals owned by `fromContactId` to `toContactId`.
   * Returns the number of reassigned deals.
   */
  reassignContact(fromContactId: string, toContactId: string, tx?: TxOrDb): Promise<number>;
}

/** Injection token for the DealRepository. */
export const DEAL_REPOSITORY = Symbol('DEAL_REPOSITORY');
