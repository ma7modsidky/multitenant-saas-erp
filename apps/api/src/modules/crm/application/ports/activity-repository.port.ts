import type { TxOrDb } from '../../../../core/database/repository.base.js';
import { type ActivityData } from '../../domain/index.js';

/**
 * ActivityRepository — persistence interface for CRM activities.
 *
 * RLS scopes every query to the current organization.
 *
 * @see DATA_MODEL.md §2 — Tenancy via RLS
 */
export interface ActivityRepository {
  /** Find a non-deleted activity by id. */
  findById(id: string, tx?: TxOrDb): Promise<ActivityData | undefined>;

  /** Insert an activity. */
  insert(data: ActivityData, tx?: TxOrDb): Promise<ActivityData>;

  /** Update an activity's editable fields. */
  update(id: string, data: Partial<ActivityData>, tx?: TxOrDb): Promise<ActivityData | undefined>;

  /**
   * CRM-12: move all activities attached to `fromId` (as related_id) to `toId`.
   * Returns the number of reassigned activities.
   */
  reassignRelated(relatedType: string, fromId: string, toId: string, tx?: TxOrDb): Promise<number>;
}

/** Injection token for the ActivityRepository. */
export const ACTIVITY_REPOSITORY = Symbol('ACTIVITY_REPOSITORY');
