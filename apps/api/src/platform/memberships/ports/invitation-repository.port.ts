import type { TxOrDb } from '../../../core/database/repository.base.js';
import { type InvitationData } from '../domain/index.js';

export interface InvitationRepository {
  /** Find invitation by its primary key. */
  findById(id: string, tx?: TxOrDb): Promise<InvitationData | undefined>;

  /** Find pending invitation by email in an organization. */
  findPendingByEmail(email: string, organizationId: string, tx?: TxOrDb): Promise<InvitationData | undefined>;

  /** Find all invitations for an organization. */
  findByOrgId(organizationId: string, tx?: TxOrDb): Promise<InvitationData[]>;

  /** Find invitation by its token hash (AUTH-9). */
  findByTokenHash(tokenHash: string, tx?: TxOrDb): Promise<InvitationData | undefined>;

  /** Insert a new invitation. */
  insert(data: InvitationData, tx?: TxOrDb): Promise<InvitationData>;

  /** Update an existing invitation. */
  update(id: string, data: Partial<InvitationData>, tx?: TxOrDb): Promise<InvitationData | undefined>;
}

export const INVITATION_REPOSITORY = Symbol('INVITATION_REPOSITORY');
