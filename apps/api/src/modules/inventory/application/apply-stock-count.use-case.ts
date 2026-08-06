import { Inject, Injectable } from '@nestjs/common';

import { NotFoundError } from '../../../core/common/errors.js';
import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { UnitOfWork } from '../../../core/database/unit-of-work.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';
import { MOVEMENT_TYPE, StockCount, StockMovement, addQuantity } from '../domain/index.js';

import { INVENTORY_REPOSITORY, type InventoryRepository } from './ports/index.js';

/**
 * ApplyStockCountUseCase — INV-14: applies a draft count.
 *
 * The count becomes immutable (`applied`) and every line with a variance
 * generates a `count_correction` movement; the projection follows the ledger.
 * The variance sign follows the domain: expected − counted is the correction
 * (a count of 8 against an expected 10 writes a −2 correction).
 */
@Injectable()
export class ApplyStockCountUseCase {
  constructor(
    @Inject(INVENTORY_REPOSITORY)
    private readonly repo: InventoryRepository,
    private readonly txManager: TransactionManager,
    private readonly unitOfWork: UnitOfWork,
  ) {}

  async execute(stockCountId: string): Promise<{ correctionsApplied: number }> {
    const organizationId = TenantContext.requireOrganizationId();
    const userId = TenantContext.getUserId() ?? null;
    const now = new Date();

    const committed = await this.txManager.run(async (tx) => {
      const row = await this.repo.listStockCounts(tx).then((counts) => counts.find((c) => c.id === stockCountId));
      if (!row) throw new NotFoundError('STOCK_COUNT_NOT_FOUND', { stockCountId });

      const count = StockCount.fromPersistence(row);
      const corrections = count.corrections();
      count.apply(userId ?? 'system', now);

      await this.repo.applyStockCount(count.toJSON(), corrections, tx);

      // Corrections update the projection (INV-2): the ledger is the truth.
      for (const correction of corrections) {
        const level = await this.repo.getStockLevel(correction.variantId, row.warehouseId, tx);
        const newOnHand = addQuantity(level?.quantityOnHand ?? '0', correction.quantity);

        const movement = StockMovement.create({
          id: crypto.randomUUID(),
          organizationId,
          variantId: correction.variantId,
          warehouseId: row.warehouseId,
          type: MOVEMENT_TYPE.COUNT_CORRECTION,
          quantity: correction.quantity,
          unitCostAmountMinor: null,
          unitCostCurrency: null,
          referenceType: 'stock_count',
          referenceId: stockCountId,
          reasonCode: null,
          idempotencyKey: null,
          occurredAt: now,
          createdBy: userId,
        });
        const persisted = await this.repo.insertMovement(movement.toJSON(), tx);
        await this.repo.upsertStockLevel(
          correction.variantId,
          row.warehouseId,
          newOnHand,
          level?.quantityReserved ?? '0',
          persisted.id,
          tx,
        );
      }

      return { correctionsApplied: corrections.length };
    });

    return committed;
  }
}
