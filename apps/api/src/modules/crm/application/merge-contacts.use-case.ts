import { Inject, Injectable } from '@nestjs/common';

import { ConflictError, NotFoundError } from '../../../core/common/errors.js';
import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { UnitOfWork } from '../../../core/database/unit-of-work.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';
import { Contact } from '../domain/index.js';

import {
  ACTIVITY_REPOSITORY,
  ATTACHMENT_REPOSITORY,
  CONTACT_REPOSITORY,
  DEAL_REPOSITORY,
  NOTE_REPOSITORY,
  type ActivityRepository,
  type AttachmentRepository,
  type ContactRepository,
  type DealRepository,
  type NoteRepository,
} from './ports/index.js';

export interface MergeContactsInput {
  /** The contact being merged AWAY (all related records move to target). */
  sourceContactId: string;
  /** The surviving contact that keeps the records. */
  targetContactId: string;
}

/**
 * MergeContactsUseCase — CRM-12: merge two contacts.
 *
 * Moves every related record (activities, notes, deals, attachments) from the
 * source contact to the surviving target contact, soft-deletes the source, and
 * records an audit entry with both ids (the recovery path — merges are not
 * automatically reversible; the audit entry records the pair).
 *
 * The audit entry is written via the API layer's @Audit interceptor (AUD-1);
 * this use case stays pure and only mutates + collects events.
 */
@Injectable()
export class MergeContactsUseCase {
  constructor(
    @Inject(CONTACT_REPOSITORY)
    private readonly contactRepo: ContactRepository,
    @Inject(ACTIVITY_REPOSITORY)
    private readonly activityRepo: ActivityRepository,
    @Inject(NOTE_REPOSITORY)
    private readonly noteRepo: NoteRepository,
    @Inject(DEAL_REPOSITORY)
    private readonly dealRepo: DealRepository,
    @Inject(ATTACHMENT_REPOSITORY)
    private readonly attachmentRepo: AttachmentRepository,
    private readonly txManager: TransactionManager,
    private readonly unitOfWork: UnitOfWork,
  ) {}

  async execute(input: MergeContactsInput): Promise<{ target: Contact }> {
    if (input.sourceContactId === input.targetContactId) {
      throw new ConflictError('CRM_MERGE_SAME_CONTACT', 'Cannot merge a contact into itself.');
    }

    const result = await this.txManager.run(async (tx) => {
      const source = await this.contactRepo.findById(input.sourceContactId, tx);
      if (!source) {
        throw new NotFoundError('CONTACT_NOT_FOUND', { contactId: input.sourceContactId });
      }
      const target = await this.contactRepo.findById(input.targetContactId, tx);
      if (!target) {
        throw new NotFoundError('CONTACT_NOT_FOUND', { contactId: input.targetContactId });
      }

      // CRM-12: move all related records to the surviving contact.
      await this.activityRepo.reassignRelated('contact', source.id, target.id, tx);
      await this.noteRepo.reassignRelated('contact', source.id, target.id, tx);
      await this.attachmentRepo.reassignRelated('contact', source.id, target.id, tx);
      await this.dealRepo.reassignContact(source.id, target.id, tx);

      // CRM-11/12: soft-delete the source; open deals are NOT deleted.
      await this.contactRepo.softDelete(source.id, tx);

      return { target: Contact.fromPersistence(target) };
    });

    // No event is declared for merges — the audit entry (via @Audit) is the
    // recovery path. Nothing to publish after commit.
    return result;
  }
}
