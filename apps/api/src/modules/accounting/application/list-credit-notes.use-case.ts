import { Inject, Injectable } from '@nestjs/common';

import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';

import { ACCOUNTING_REPOSITORY, type AccountingRepository, type CreditNoteFilter } from './ports/index.js';

/**
 * ListCreditNotesUseCase — paginated credit notes (ACC-10 trail). Every row
 * carries the reversed invoice's number + customer snapshot. Filters: free-text
 * search (note number / invoice number / customer name). Read-only; RLS scopes
 * every row to the org. Credit notes are immutable once issued — there is no
 * edit or delete path here.
 */
@Injectable()
export class ListCreditNotesUseCase {
  constructor(
    @Inject(ACCOUNTING_REPOSITORY)
    private readonly repo: AccountingRepository,
    private readonly txManager: TransactionManager,
  ) {}

  async execute(filter: CreditNoteFilter = {}): Promise<ReturnType<AccountingRepository['listCreditNotes']>> {
    TenantContext.requireOrganizationId();
    return this.txManager.run((tx) => this.repo.listCreditNotes(filter, tx));
  }
}
