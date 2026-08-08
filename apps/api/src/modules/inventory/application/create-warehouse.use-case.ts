import { Inject, Injectable } from '@nestjs/common';

import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';

import { INVENTORY_REPOSITORY, type InventoryRepository, type WarehouseRow } from './ports/index.js';

export interface CreateWarehouseInput {
  name: string;
  code: string;
  isDefault?: boolean;
}

/**
 * CreateWarehouseUseCase — creates an org warehouse (first non-default one).
 *
 * Warehouse codes are unique per org among non-deleted warehouses; a duplicate
 * surfaces as `INVENTORY_WAREHOUSE_DUPLICATE_CODE`. `isDefault` is only
 * honoured when the org has no default warehouse yet (the default is otherwise
 * created lazily by the first stock movement).
 */
@Injectable()
export class CreateWarehouseUseCase {
  constructor(
    @Inject(INVENTORY_REPOSITORY)
    private readonly repo: InventoryRepository,
    private readonly txManager: TransactionManager,
  ) {}

  async execute(input: CreateWarehouseInput): Promise<WarehouseRow> {
    TenantContext.requireOrganizationId();
    return this.txManager.run(async (tx) => {
      const warehouses = await this.repo.listWarehouses(tx);
      const wantsDefault = input.isDefault === true && !warehouses.some((w) => w.isDefault);
      return this.repo.insertWarehouse(
        {
          id: crypto.randomUUID(),
          name: input.name.trim(),
          code: input.code.trim().toUpperCase(),
          isDefault: wantsDefault,
        },
        tx,
      );
    });
  }
}
