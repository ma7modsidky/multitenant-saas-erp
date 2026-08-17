import { Inject, Injectable } from '@nestjs/common';

import { NotFoundError } from '../../../core/common/errors.js';
import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { UnitOfWork } from '../../../core/database/unit-of-work.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';
import { MOVEMENT_TYPE, StockLevel, StockMovement, addQuantity, subtractQuantity } from '../domain/index.js';

import { buildMovementRecordedEvent } from './movement-recorded.event.js';
import { INVENTORY_REPOSITORY, type InventoryRepository } from './ports/index.js';

export interface TransferStockInput {
  variantId: string;
  fromWarehouseId: string;
  toWarehouseId: string;
  quantity: string;
  referenceType: string;
  referenceId: string;
}

/**
 * TransferStockUseCase — INV-9: moves stock between warehouses.
 *
 * Writes exactly two ledger rows in ONE transaction: a `transfer_out` on the
 * source (negative) and a `transfer_in` on the destination (positive). The
 * transfer is atomic — a failure never leaves a one-sided movement.
 */
@Injectable()
export class TransferStockUseCase {
  constructor(
    @Inject(INVENTORY_REPOSITORY)
    private readonly repo: InventoryRepository,
    private readonly txManager: TransactionManager,
    // Optional for tests that construct the use case directly; Nest injects
    // the global UnitOfWork at runtime (database.module.ts is @Global).
    private readonly unitOfWork?: UnitOfWork,
  ) {}

  async execute(input: TransferStockInput): Promise<{ transferOutId: string; transferInId: string }> {
    const organizationId = TenantContext.requireOrganizationId();
    const userId = TenantContext.getUserId() ?? null;
    const now = new Date();

    const committed = await this.txManager.run(async (tx) => {
      if (!(await this.repo.findVariantById(input.variantId, tx))) {
        throw new NotFoundError('VARIANT_NOT_FOUND', { variantId: input.variantId });
      }
      const from = await this.repo.findWarehouseById(input.fromWarehouseId, tx);
      if (!from) throw new NotFoundError('WAREHOUSE_NOT_FOUND', { warehouseId: input.fromWarehouseId });
      const to = await this.repo.findWarehouseById(input.toWarehouseId, tx);
      if (!to) throw new NotFoundError('WAREHOUSE_NOT_FOUND', { warehouseId: input.toWarehouseId });
      if (input.fromWarehouseId === input.toWarehouseId) {
        throw new NotFoundError('TRANSFER_SAME_WAREHOUSE', {
          warehouseId: input.fromWarehouseId,
        });
      }

      // INV-5: the source must have the stock available to move. The domain
      // gate throws INVENTORY_INSUFFICIENT_STOCK (422) — exact decimal
      // arithmetic (INV-15), never floats.
      const sourceLevel = await this.repo.getStockLevel(input.variantId, input.fromWarehouseId, tx);
      const stockLevel = StockLevel.of(
        input.variantId,
        input.fromWarehouseId,
        sourceLevel?.quantityOnHand ?? '0',
        sourceLevel?.quantityReserved ?? '0',
      );
      stockLevel.assertSufficient(input.quantity);

      const transferOut = StockMovement.create({
        id: crypto.randomUUID(),
        organizationId,
        variantId: input.variantId,
        warehouseId: input.fromWarehouseId,
        type: MOVEMENT_TYPE.TRANSFER_OUT,
        quantity: `-${input.quantity}`,
        unitCostAmountMinor: null,
        unitCostCurrency: null,
        referenceType: input.referenceType,
        referenceId: input.referenceId,
        reasonCode: null,
        idempotencyKey: null,
        occurredAt: now,
        createdBy: userId,
      });
      const transferIn = StockMovement.create({
        id: crypto.randomUUID(),
        organizationId,
        variantId: input.variantId,
        warehouseId: input.toWarehouseId,
        type: MOVEMENT_TYPE.TRANSFER_IN,
        quantity: input.quantity,
        unitCostAmountMinor: null,
        unitCostCurrency: null,
        referenceType: input.referenceType,
        referenceId: input.referenceId,
        reasonCode: null,
        idempotencyKey: null,
        occurredAt: now,
        createdBy: userId,
      });

      const out = await this.repo.insertMovement(transferOut.toJSON(), tx);
      const into = await this.repo.insertMovement(transferIn.toJSON(), tx);

      // Update both projections in the same transaction (INV-2).
      const outLevel = await this.repo.getStockLevel(input.variantId, input.fromWarehouseId, tx);
      await this.repo.upsertStockLevel(
        input.variantId,
        input.fromWarehouseId,
        subtractQuantity(outLevel?.quantityOnHand ?? '0', input.quantity),
        outLevel?.quantityReserved ?? '0',
        out.id,
        tx,
      );
      const inLevel = await this.repo.getStockLevel(input.variantId, input.toWarehouseId, tx);
      await this.repo.upsertStockLevel(
        input.variantId,
        input.toWarehouseId,
        addQuantity(inLevel?.quantityOnHand ?? '0', input.quantity),
        inLevel?.quantityReserved ?? '0',
        into.id,
        tx,
      );

      // Phase 7.0 (ACC-15): both ledger rows reach the GL.
      return {
        transferOutId: out.id,
        transferInId: into.id,
        events: [
          buildMovementRecordedEvent(out, organizationId, now),
          buildMovementRecordedEvent(into, organizationId, now),
        ],
      };
    });

    if (this.unitOfWork) {
      for (const event of committed.events) this.unitOfWork.addEvent(event);
      await this.unitOfWork.publishEvents();
    }
    return { transferOutId: committed.transferOutId, transferInId: committed.transferInId };
  }
}
