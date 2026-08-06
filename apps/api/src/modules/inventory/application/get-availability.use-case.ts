import type { AvailabilitySnapshot } from '@modubiz/contracts';
import { Inject, Injectable } from '@nestjs/common';

import { NotFoundError } from '../../../core/common/errors.js';
import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';
import { StockLevel, subtractQuantity } from '../domain/index.js';

import { INVENTORY_REPOSITORY, type InventoryRepository } from './ports/index.js';

/**
 * GetAvailabilityUseCase — INV-5: available = on-hand − reserved.
 *
 * Read-only snapshot for one warehouse; the base of the INVENTORY_STOCK_PORT
 * `getAvailability` call. Fails closed for an unknown warehouse and returns
 * zero-availability rows for variants with no stock yet.
 */
@Injectable()
export class GetAvailabilityUseCase {
  constructor(
    @Inject(INVENTORY_REPOSITORY)
    private readonly repo: InventoryRepository,
    private readonly txManager: TransactionManager,
  ) {}

  async execute(input: { variantIds: string[]; warehouseId: string }): Promise<AvailabilitySnapshot[]> {
    TenantContext.requireOrganizationId();

    return this.txManager.run(async (tx) => {
      const warehouse = await this.repo.findWarehouseById(input.warehouseId, tx);
      if (!warehouse) throw new NotFoundError('WAREHOUSE_NOT_FOUND', { warehouseId: input.warehouseId });

      const rows = await this.repo.getStockLevels(input.variantIds, input.warehouseId, tx);
      const byVariant = new Map(rows.map((row) => [row.variantId, row]));

      return input.variantIds.map((variantId) => {
        const row = byVariant.get(variantId);
        const level = StockLevel.of(
          variantId,
          input.warehouseId,
          row?.quantityOnHand ?? '0',
          row?.quantityReserved ?? '0',
        );
        return {
          variantId,
          warehouseId: input.warehouseId,
          quantityOnHand: level.quantityOnHand,
          quantityReserved: level.quantityReserved,
          quantityAvailable: level.available,
        };
      });
    });
  }
}
