import { Inject, Injectable } from '@nestjs/common';

import { TransactionManager } from '../../../core/database/transaction-manager.js';

import { PURCHASING_REPOSITORY, type PurchasingRepository, type SupplierReturnFilter } from './ports/index.js';

/**
 * ListSupplierReturnsUseCase — paginated supplier-return listing (PUR-11).
 * Read-only; RLS scopes every row to the org.
 */
@Injectable()
export class ListSupplierReturnsUseCase {
  constructor(
    @Inject(PURCHASING_REPOSITORY)
    private readonly repo: PurchasingRepository,
    private readonly txManager: TransactionManager,
  ) {}

  async execute(filter: SupplierReturnFilter = {}): Promise<ReturnType<PurchasingRepository['listSupplierReturns']>> {
    return this.txManager.run((tx) => this.repo.listSupplierReturns(filter, tx));
  }
}
