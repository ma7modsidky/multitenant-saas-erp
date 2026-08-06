import { Inject, Injectable } from '@nestjs/common';

import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';

import { INVENTORY_REPOSITORY, type InventoryRepository, type WarehouseRow } from './ports/index.js';

/** ListWarehousesUseCase — the warehouses table view. */
@Injectable()
export class ListWarehousesUseCase {
  constructor(
    @Inject(INVENTORY_REPOSITORY)
    private readonly repo: InventoryRepository,
    private readonly txManager: TransactionManager,
  ) {}

  async execute(): Promise<WarehouseRow[]> {
    TenantContext.requireOrganizationId();
    return this.txManager.run((tx) => this.repo.listWarehouses(tx));
  }
}
