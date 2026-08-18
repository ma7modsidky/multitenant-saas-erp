import { Inject, Injectable } from '@nestjs/common';

import { TransactionManager } from '../../../core/database/transaction-manager.js';

import { PURCHASING_REPOSITORY, type PaymentFilter, type PurchasingRepository } from './ports/index.js';

/**
 * ListPaymentsUseCase — paginated cash-disbursement listing (PUR-7). Read-only;
 * RLS scopes every row to the org.
 */
@Injectable()
export class ListPaymentsUseCase {
  constructor(
    @Inject(PURCHASING_REPOSITORY)
    private readonly repo: PurchasingRepository,
    private readonly txManager: TransactionManager,
  ) {}

  async execute(filter: PaymentFilter = {}): Promise<ReturnType<PurchasingRepository['listPayments']>> {
    return this.txManager.run((tx) => this.repo.listPayments(filter, tx));
  }
}
