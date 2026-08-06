import { Inject, Injectable } from '@nestjs/common';

import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';

import { INVENTORY_REPOSITORY, type InventoryRepository, type StockLevelRow } from './ports/index.js';

/** ListStockLevelsUseCase — the stock ledger view (on-hand / reserved / reorder). */
@Injectable()
export class ListStockLevelsUseCase {
  constructor(
    @Inject(INVENTORY_REPOSITORY)
    private readonly repo: InventoryRepository,
    private readonly txManager: TransactionManager,
  ) {}

  async execute(): Promise<StockLevelRow[]> {
    TenantContext.requireOrganizationId();
    return this.txManager.run((tx) => this.repo.listStockLevels(tx));
  }
}
