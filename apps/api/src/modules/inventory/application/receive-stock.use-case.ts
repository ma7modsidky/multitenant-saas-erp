import { INVENTORY_EVENTS, type InventoryStockLevelChangedV1 } from '@modubiz/contracts';
import { Inject, Injectable } from '@nestjs/common';

import { NotFoundError } from '../../../core/common/errors.js';
import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { UnitOfWork } from '../../../core/database/unit-of-work.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';
import {
  MOVEMENT_TYPE,
  StockLevel,
  StockMovement,
  type StockMovementData,
  addQuantity,
  compareQuantity,
  movingAverageCost,
} from '../domain/index.js';

import { buildMovementRecordedEvent } from './movement-recorded.event.js';
import { INVENTORY_REPOSITORY, type InventoryRepository } from './ports/index.js';

export interface ReceiveStockInput {
  variantId: string;
  /** Warehouse id; when omitted the org's default warehouse is used. */
  warehouseId?: string;
  /** Quantity received (decimal string, UoM units). */
  quantity: string;
  /** Unit cost of this receipt (minor units). Used for moving-average (INV-12). */
  unitCostAmountMinor: string;
  unitCostCurrency: string;
  /** Reference to what caused the movement (INV-3). */
  referenceType: string;
  referenceId: string;
  idempotencyKey?: string;
}

/**
 * ReceiveStockUseCase — records stock in via a `receipt` movement.
 *
 * Business rules:
 * - INV-1: the movement is the only source of truth; the projection follows.
 * - INV-3: every movement has a non-zero signed quantity + reference.
 * - INV-12: moving-average cost is recalculated on each receipt, never
 *   retroactively: newCost = (oldOnHand*oldCost + qty*unitCost) / (oldOnHand+qty).
 * - INV-16: a retried receipt with the same idempotency_key does not double-count.
 */
@Injectable()
export class ReceiveStockUseCase {
  constructor(
    @Inject(INVENTORY_REPOSITORY)
    private readonly repo: InventoryRepository,
    private readonly txManager: TransactionManager,
    private readonly unitOfWork: UnitOfWork,
  ) {}

  async execute(input: ReceiveStockInput): Promise<{ movementId: string }> {
    const organizationId = TenantContext.requireOrganizationId();
    const userId = TenantContext.getUserId() ?? null;
    const now = new Date();

    const committed = await this.txManager.run(async (tx) => {
      // INV-16: a retried receipt must not double-count.
      if (input.idempotencyKey) {
        const existing = await this.repo.findMovementByIdempotencyKey(input.idempotencyKey, tx);
        if (existing) {
          return { movementId: existing.id, events: [] as Array<Parameters<UnitOfWork['addEvent']>[0]> };
        }
      }

      const variant = await this.repo.findVariantById(input.variantId, tx);
      if (!variant) throw new NotFoundError('VARIANT_NOT_FOUND', { variantId: input.variantId });

      const warehouse = input.warehouseId
        ? await this.repo.findWarehouseById(input.warehouseId, tx)
        : await this.repo.ensureDefaultWarehouse(tx);
      if (!warehouse) throw new NotFoundError('WAREHOUSE_NOT_FOUND', { warehouseId: input.warehouseId });

      const movement = StockMovement.create({
        id: crypto.randomUUID(),
        organizationId,
        variantId: input.variantId,
        warehouseId: warehouse.id,
        type: MOVEMENT_TYPE.RECEIPT,
        quantity: input.quantity,
        unitCostAmountMinor: input.unitCostAmountMinor,
        unitCostCurrency: input.unitCostCurrency,
        referenceType: input.referenceType,
        referenceId: input.referenceId,
        reasonCode: null,
        idempotencyKey: input.idempotencyKey ?? null,
        occurredAt: now,
        createdBy: userId,
      });

      const persisted = await this.repo.insertMovement(movement.toJSON(), tx);

      // INV-2: recompute the projection from the ledger and store it.
      const level = await this.repo.getStockLevel(input.variantId, warehouse.id, tx);
      const oldOnHand = level?.quantityOnHand ?? '0';
      const newOnHand = addQuantity(oldOnHand, input.quantity);
      await this.repo.upsertStockLevel(
        input.variantId,
        warehouse.id,
        newOnHand,
        level?.quantityReserved ?? '0',
        persisted.id,
        tx,
      );

      // INV-12: moving-average cost, exact integer arithmetic (hard rule #3).
      if (compareQuantity(input.unitCostAmountMinor, '0') >= 0) {
        const newAvg = movingAverageCost(oldOnHand, variant.costAmountMinor, input.quantity, input.unitCostAmountMinor);
        await this.repo.updateVariantCost(input.variantId, newAvg, input.unitCostCurrency, tx);
      }

      const stockLevel = StockLevel.of(input.variantId, warehouse.id, newOnHand, level?.quantityReserved ?? '0');
      const events = this.stockEvents(stockLevel, persisted, newOnHand, now, organizationId);

      return { movementId: persisted.id, events };
    });

    for (const event of committed.events) this.unitOfWork.addEvent(event);
    await this.unitOfWork.publishEvents();
    return { movementId: committed.movementId };
  }

  /** Stock-level events shared by every movement use case. */
  private stockEvents(
    stockLevel: StockLevel,
    movement: StockMovementData,
    quantityOnHand: string,
    occurredAt: Date,
    organizationId: string,
  ): Array<Parameters<UnitOfWork['addEvent']>[0]> {
    const changed: InventoryStockLevelChangedV1 = {
      organizationId,
      variantId: stockLevel.variantId,
      warehouseId: stockLevel.warehouseId,
      movementId: movement.id,
      movementType: movement.type,
      quantity: movement.quantity,
      quantityOnHand,
      quantityReserved: stockLevel.quantityReserved,
      occurredAt: occurredAt.toISOString(),
    };

    return [
      { name: INVENTORY_EVENTS.STOCK_LEVEL_CHANGED_V1, payload: changed, aggregateId: stockLevel.variantId },
      // Phase 7.0 (ACC-15): the full-movement event the GL posts from.
      buildMovementRecordedEvent(movement, organizationId, occurredAt),
    ];
  }
}
