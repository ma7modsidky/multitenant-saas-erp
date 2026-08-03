import type { TxOrDb } from '../../../../core/database/repository.base.js';
import { type ContactData } from '../../domain/index.js';

/**
 * ContactRepository — persistence interface for CRM contacts.
 *
 * RLS scopes every query to the current organization (fail-closed: no tenant
 * context ⇒ zero rows), so no method takes an organizationId.
 *
 * @see DATA_MODEL.md §2 — Tenancy via RLS
 * @see MODULE_GUIDE.md §4 Step 5 — use cases depend on ports, never Drizzle
 */
export interface ContactRepository {
  /** Find a non-deleted contact by id. */
  findById(id: string, tx?: TxOrDb): Promise<ContactData | undefined>;

  /**
   * CRM-2: find a non-deleted contact by email (citext — case-insensitive).
   * Used to reject duplicate emails per organization.
   */
  findByEmail(email: string, tx?: TxOrDb): Promise<ContactData | undefined>;

  /** Insert a contact. */
  insert(data: ContactData, tx?: TxOrDb): Promise<ContactData>;

  /** Update a contact's editable fields. */
  update(id: string, data: Partial<ContactData>, tx?: TxOrDb): Promise<ContactData | undefined>;

  /** CRM-11: soft-delete a contact. */
  softDelete(id: string, tx?: TxOrDb): Promise<void>;
}

/** Injection token for the ContactRepository. */
export const CONTACT_REPOSITORY = Symbol('CONTACT_REPOSITORY');
