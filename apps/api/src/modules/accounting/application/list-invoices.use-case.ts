import { Inject, Injectable } from '@nestjs/common';

import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { ACCOUNTING_REPOSITORY, type AccountingRepository, type InvoiceFilter } from './ports/index.js';

/**
 * ListInvoicesUseCase — paginated invoice listing (AR ageing, ACC-8 status
 * filter). Read-only; RLS scopes every row to the org.
 */
@Injectable()
export class ListInvoicesUseCase {
  constructor(
    @Inject(ACCOUNTING_REPOSITORY)
    private readonly repo: AccountingRepository,
    private readonly txManager: TransactionManager,
  ) {}

  async execute(filter: InvoiceFilter = {}): Promise<ReturnType<AccountingRepository['listInvoices']>> {
    return this.txManager.run((tx) => this.repo.listInvoices(filter, tx));
  }
}
