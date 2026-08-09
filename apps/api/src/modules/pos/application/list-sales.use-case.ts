import { Inject, Injectable } from '@nestjs/common';

import { TransactionManager } from '../../../core/database/transaction-manager.js';

import {
  type PageResult,
  type SaleListFilter,
  type SaleRow,
  POS_REPOSITORY,
  type PosRepository,
} from './ports/index.js';

/**
 * ListSalesUseCase — paginated sale history (reports / receipts).
 */
@Injectable()
export class ListSalesUseCase {
  constructor(
    @Inject(POS_REPOSITORY)
    private readonly repo: PosRepository,
    private readonly txManager: TransactionManager,
  ) {}

  async execute(filter: SaleListFilter = {}): Promise<PageResult<SaleRow>> {
    return this.txManager.run((tx) => this.repo.listSales(filter, tx));
  }
}
