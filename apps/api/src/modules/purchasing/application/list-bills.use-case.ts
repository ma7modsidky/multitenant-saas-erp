import { Inject, Injectable } from '@nestjs/common';

import { TransactionManager } from '../../../core/database/transaction-manager.js';

import { PURCHASING_REPOSITORY, type BillFilter, type PurchasingRepository } from './ports/index.js';

/**
 * ListBillsUseCase — paginated bill listing (PUR-7 status filter). Read-only;
 * RLS scopes every row to the org.
 */
@Injectable()
export class ListBillsUseCase {
  constructor(
    @Inject(PURCHASING_REPOSITORY)
    private readonly repo: PurchasingRepository,
    private readonly txManager: TransactionManager,
  ) {}

  async execute(filter: BillFilter = {}): Promise<ReturnType<PurchasingRepository['listBills']>> {
    return this.txManager.run((tx) => this.repo.listBills(filter, tx));
  }
}
