import { Inject, Injectable } from '@nestjs/common';

import { NotFoundError } from '../../../core/common/errors.js';
import { TransactionManager } from '../../../core/database/transaction-manager.js';

import { CONTACT_REPOSITORY, DEAL_REPOSITORY, type ContactRepository, type DealRepository } from './ports/index.js';

export interface DeleteContactInput {
  contactId: string;
}

/**
 * DeleteContactUseCase — CRM-11: deleting a contact soft-deletes it and
 * detaches it from open deals; it does not delete the deals. Closed (won/lost)
 * deals keep their historical attribution, and activities/notes remain as
 * historical records of the now-deleted contact.
 *
 * The audit entry is written via the API layer's @Audit interceptor (AUD-1)
 * with a pre-mutation snapshot; like merges, no domain event is declared for
 * deletions — the audit entry is the recovery path.
 */
@Injectable()
export class DeleteContactUseCase {
  constructor(
    @Inject(CONTACT_REPOSITORY)
    private readonly contactRepo: ContactRepository,
    @Inject(DEAL_REPOSITORY)
    private readonly dealRepo: DealRepository,
    private readonly txManager: TransactionManager,
  ) {}

  async execute(input: DeleteContactInput): Promise<void> {
    await this.txManager.run(async (tx) => {
      const contact = await this.contactRepo.findById(input.contactId, tx);
      if (!contact) {
        throw new NotFoundError('CONTACT_NOT_FOUND', { contactId: input.contactId });
      }

      // CRM-11: detach open deals first, then soft-delete.
      await this.dealRepo.detachContact(input.contactId, tx);
      await this.contactRepo.softDelete(input.contactId, tx);
    });
  }
}
