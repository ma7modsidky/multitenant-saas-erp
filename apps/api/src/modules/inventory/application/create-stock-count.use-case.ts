import { Inject, Injectable } from '@nestjs/common';

import { NotFoundError } from '../../../core/common/errors.js';
import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';
import { STOCK_COUNT_STATUS, StockCount, type StockCountData, type StockCountLineData } from '../domain/index.js';

import { INVENTORY_REPOSITORY, type InventoryRepository } from './ports/index.js';

export interface CreateStockCountInput {
  warehouseId: string;
  notes?: string | null;
  /** Physical count lines. `expectedQuantity` is resolved from the projection. */
  lines: Array<{ variantId: string; countedQuantity: string }>;
}

/**
 * CreateStockCountUseCase — starts a physical count (INV-14).
 *
 * Creates a `draft` count with one line per variant: `expected_quantity`
 * comes from the current on-hand projection (INV-2), `counted_quantity` from
 * the user's physical tally, and the DB generates `variance`.
 */
@Injectable()
export class CreateStockCountUseCase {
  constructor(
    @Inject(INVENTORY_REPOSITORY)
    private readonly repo: InventoryRepository,
    private readonly txManager: TransactionManager,
  ) {}

  async execute(input: CreateStockCountInput): Promise<StockCountData> {
    const organizationId = TenantContext.requireOrganizationId();
    const userId = TenantContext.getUserId() ?? null;
    const now = new Date();

    return this.txManager.run(async (tx) => {
      const warehouse = await this.repo.findWarehouseById(input.warehouseId, tx);
      if (!warehouse) throw new NotFoundError('WAREHOUSE_NOT_FOUND', { warehouseId: input.warehouseId });

      // INV-14: expected = current projection; variance is generated in the DB.
      const lines: StockCountLineData[] = [];
      for (const line of input.lines) {
        const level = await this.repo.getStockLevel(line.variantId, input.warehouseId, tx);
        lines.push({
          id: crypto.randomUUID(),
          variantId: line.variantId,
          expectedQuantity: level?.quantityOnHand ?? '0',
          countedQuantity: line.countedQuantity,
          variance: '0', // recomputed by the DB generated column
        });
      }

      const count = StockCount.create({
        id: crypto.randomUUID(),
        organizationId,
        warehouseId: input.warehouseId,
        status: STOCK_COUNT_STATUS.DRAFT,
        countedAt: null,
        countedBy: null,
        notes: input.notes ?? null,
        lines,
        createdAt: now,
        updatedAt: now,
      });

      const persisted = await this.repo.insertStockCount(count.toJSON(), tx);
      // The DB computes real variance; re-read so the response is accurate.
      return (await this.repo.findStockCountById(persisted.id, tx)) ?? persisted;
    });
  }
}
