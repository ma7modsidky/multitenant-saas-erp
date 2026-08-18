import { Inject, Injectable } from '@nestjs/common';

import { TransactionManager } from '../../../core/database/transaction-manager.js';

import { PURCHASING_REPOSITORY, type PurchasingRepository } from './ports/index.js';

export interface ListSuppliersFilter {
  q?: string;
  page?: number;
  pageSize?: number;
}

/**
 * ListSuppliersUseCase — paginated supplier directory (PUR-1) with the derived
 * vendor balance per supplier (PUR-2 — always the signed ledger sum, never a
 * stored number).
 */
@Injectable()
export class ListSuppliersUseCase {
  constructor(
    @Inject(PURCHASING_REPOSITORY)
    private readonly repo: PurchasingRepository,
    private readonly txManager: TransactionManager,
  ) {}

  async execute(filter: ListSuppliersFilter = {}): Promise<ReturnType<PurchasingRepository['listSuppliers']>> {
    return this.txManager.run((tx) => this.repo.listSuppliers(filter, tx));
  }
}
