import { Inject, Injectable } from '@nestjs/common';

import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';
import { type StockCountData } from '../domain/index.js';

import { INVENTORY_REPOSITORY, type InventoryRepository } from './ports/index.js';

/** ListStockCountsUseCase — the stock count history view. */
@Injectable()
export class ListStockCountsUseCase {
  constructor(
    @Inject(INVENTORY_REPOSITORY)
    private readonly repo: InventoryRepository,
    private readonly txManager: TransactionManager,
  ) {}

  async execute(): Promise<StockCountData[]> {
    TenantContext.requireOrganizationId();
    return this.txManager.run((tx) => this.repo.listStockCounts(tx));
  }
}
