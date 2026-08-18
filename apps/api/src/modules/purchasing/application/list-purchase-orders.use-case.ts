import { Inject, Injectable } from '@nestjs/common';

import { TransactionManager } from '../../../core/database/transaction-manager.js';

import { PURCHASING_REPOSITORY, type PurchasingRepository, type PurchaseOrderFilter } from './ports/index.js';

/**
 * ListPurchaseOrdersUseCase — paginated PO listing (PUR-3 status filter).
 * Read-only; RLS scopes every row to the org.
 */
@Injectable()
export class ListPurchaseOrdersUseCase {
  constructor(
    @Inject(PURCHASING_REPOSITORY)
    private readonly repo: PurchasingRepository,
    private readonly txManager: TransactionManager,
  ) {}

  async execute(filter: PurchaseOrderFilter = {}): Promise<ReturnType<PurchasingRepository['listPurchaseOrders']>> {
    return this.txManager.run((tx) => this.repo.listPurchaseOrders(filter, tx));
  }
}
