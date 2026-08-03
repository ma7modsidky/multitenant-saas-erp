import type { TxOrDb } from '../../../../core/database/repository.base.js';

/**
 * Persisted shape of a CRM attachment (crm_attachments).
 */
export interface AttachmentData {
  id: string;
  organizationId: string;
  storageKey: string;
  filename: string;
  mimeType: string;
  sizeBytes: bigint;
  relatedType: string;
  relatedId: string;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
  updatedBy: string | null;
  deletedAt: Date | null;
}

/**
 * AttachmentRepository — persistence interface for CRM attachments.
 *
 * RLS scopes every query to the current organization.
 */
export interface AttachmentRepository {
  /** Insert an attachment. */
  insert(data: AttachmentData, tx?: TxOrDb): Promise<AttachmentData>;

  /**
   * CRM-12: move all attachments attached to `fromId` (as related_id) to `toId`.
   */
  reassignRelated(relatedType: string, fromId: string, toId: string, tx?: TxOrDb): Promise<number>;
}

/** Injection token for the AttachmentRepository. */
export const ATTACHMENT_REPOSITORY = Symbol('ATTACHMENT_REPOSITORY');
