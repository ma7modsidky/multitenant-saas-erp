import { Inject, Injectable } from '@nestjs/common';

import { TransactionManager } from '../../../core/database/transaction-manager.js';

import { PURCHASING_REPOSITORY, type GrnFilter, type PurchasingRepository } from './ports/index.js';

/**
 * ListGrnsUseCase — paginated GRN listing (PUR-4/PUR-5). Read-only; RLS scopes
 * every row to the org.
 */
@Injectable()
export class ListGrnsUseCase {
  constructor(
    @Inject(PURCHASING_REPOSITORY)
    private readonly repo: PurchasingRepository,
    private readonly txManager: TransactionManager,
  ) {}

  async execute(filter: GrnFilter = {}): Promise<ReturnType<PurchasingRepository['listGrns']>> {
    return this.txManager.run((tx) => this.repo.listGrns(filter, tx));
  }
}
