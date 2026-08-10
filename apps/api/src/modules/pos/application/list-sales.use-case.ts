import { Inject, Injectable } from '@nestjs/common';

import { TransactionManager } from '../../../core/database/transaction-manager.js';

import { POS_REPOSITORY, type PosRepository, type SaleListFilter, type SalesListPage } from './ports/index.js';

/**
 * ListSalesUseCase — paginated sale history (reports / receipts). The page
 * carries the exact Σ of the matching set so the reports page can show
 * filtered totals (server-side, minor units).
 */
@Injectable()
export class ListSalesUseCase {
  constructor(
    @Inject(POS_REPOSITORY)
    private readonly repo: PosRepository,
    private readonly txManager: TransactionManager,
  ) {}

  async execute(filter: SaleListFilter = {}): Promise<SalesListPage> {
    return this.txManager.run((tx) => this.repo.listSales(filter, tx));
  }
}
