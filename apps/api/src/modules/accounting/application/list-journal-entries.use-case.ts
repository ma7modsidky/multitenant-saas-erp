import { Inject, Injectable } from '@nestjs/common';

import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { ACCOUNTING_REPOSITORY, type AccountingRepository, type JournalFilter } from './ports/index.js';

/**
 * ListJournalEntriesUseCase — paginated journal listing (ACC-3 order: newest
 * entry number first). Read-only; RLS scopes every row to the org.
 */
@Injectable()
export class ListJournalEntriesUseCase {
  constructor(
    @Inject(ACCOUNTING_REPOSITORY)
    private readonly repo: AccountingRepository,
    private readonly txManager: TransactionManager,
  ) {}

  async execute(filter: JournalFilter = {}): Promise<ReturnType<AccountingRepository['listJournalEntries']>> {
    return this.txManager.run((tx) => this.repo.listJournalEntries(filter, tx));
  }
}
