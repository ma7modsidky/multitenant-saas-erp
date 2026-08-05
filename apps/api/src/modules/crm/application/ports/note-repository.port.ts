import type { TxOrDb } from '../../../../core/database/repository.base.js';

/**
 * Persisted shape of a CRM note (crm_notes).
 */
export interface NoteData {
  id: string;
  organizationId: string;
  body: string;
  relatedType: string;
  relatedId: string;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
  updatedBy: string | null;
  deletedAt: Date | null;
  /** Resolved from core_users by the read method. */
  createdByName?: string | null;
}

/**
 * NoteRepository — persistence interface for CRM notes.
 *
 * RLS scopes every query to the current organization.
 */
export interface NoteRepository {
  /** Insert a note. */
  insert(data: NoteData, tx?: TxOrDb): Promise<NoteData>;

  /**
   * List notes attached to a related entity, newest first.
   */
  listByRelated(relatedType: string, relatedId: string, tx?: TxOrDb): Promise<NoteData[]>;

  /**
   * CRM-12: move all notes attached to `fromId` (as related_id) to `toId`.
   */
  reassignRelated(relatedType: string, fromId: string, toId: string, tx?: TxOrDb): Promise<number>;
}

/** Injection token for the NoteRepository. */
export const NOTE_REPOSITORY = Symbol('NOTE_REPOSITORY');
