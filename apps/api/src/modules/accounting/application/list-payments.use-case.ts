import { Inject, Injectable } from '@nestjs/common';

import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';
import { ACCOUNTING_REPOSITORY, type AccountingRepository, type PaymentFilter } from './ports/index.js';

/**
 * ListPaymentsUseCase — paginated payment receipts (ACC-9). Every payment row
 * carries the invoice it was allocated to (number + customer snapshot) and the
 * allocation amount. Filters: method + received-at date range. Read-only; RLS
 * scopes every row to the org.
 */
@Injectable()
export class ListPaymentsUseCase {
  constructor(
    @Inject(ACCOUNTING_REPOSITORY)
    private readonly repo: AccountingRepository,
    private readonly txManager: TransactionManager,
  ) {}

  async execute(filter: PaymentFilter = {}): Promise<ReturnType<AccountingRepository['listPayments']>> {
    TenantContext.requireOrganizationId();
    return this.txManager.run((tx) => this.repo.listPayments(filter, tx));
  }
}
