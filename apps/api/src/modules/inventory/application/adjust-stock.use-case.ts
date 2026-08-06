import { Inject, Injectable } from '@nestjs/common';

import { NotFoundError } from '../../../core/common/errors.js';
import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { UnitOfWork } from '../../../core/database/unit-of-work.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';
import { MOVEMENT_TYPE, StockMovement, addQuantity, isNegativeQuantity } from '../domain/index.js';

import { INVENTORY_REPOSITORY, type InventoryRepository } from './ports/index.js';

export interface AdjustStockInput {
  variantId: string;
  warehouseId?: string;
  /** Signed adjustment quantity (negative = reduce stock). */
  quantity: string;
  /** INV-4: adjustments always require a reason code. */
  reasonCode: string;
  referenceType: string;
  referenceId: string;
}

/**
 * AdjustStockUseCase — a manual correction to on-hand stock.
 *
 * Business rules:
 * - INV-4: an adjustment without a reason code is rejected
 *   (`ADJUSTMENT_REQUIRES_REASON`, enforced by the domain).
 * - INV-6: stock may go negative only through a documented path; a manual
 *   adjustment that would drive on-hand below zero requires the adjust
 *   permission (checked by the controller) and raises an oversold alert.
 */
@Injectable()
export class AdjustStockUseCase {
  constructor(
    @Inject(INVENTORY_REPOSITORY)
    private readonly repo: InventoryRepository,
    private readonly txManager: TransactionManager,
    private readonly unitOfWork: UnitOfWork,
  ) {}

  async execute(input: AdjustStockInput): Promise<{ movementId: string }> {
    const organizationId = TenantContext.requireOrganizationId();
    const userId = TenantContext.getUserId() ?? null;
    const now = new Date();

    const committed = await this.txManager.run(async (tx) => {
      if (!(await this.repo.findVariantById(input.variantId, tx))) {
        throw new NotFoundError('VARIANT_NOT_FOUND', { variantId: input.variantId });
      }

      const warehouse = input.warehouseId
        ? await this.repo.findWarehouseById(input.warehouseId, tx)
        : await this.repo.ensureDefaultWarehouse(tx);
      if (!warehouse) throw new NotFoundError('WAREHOUSE_NOT_FOUND', { warehouseId: input.warehouseId });

      // Domain invariant: the adjustment requires a reason code (INV-4).
      const movement = StockMovement.create({
        id: crypto.randomUUID(),
        organizationId,
        variantId: input.variantId,
        warehouseId: warehouse.id,
        type: MOVEMENT_TYPE.ADJUSTMENT,
        quantity: input.quantity,
        unitCostAmountMinor: null,
        unitCostCurrency: null,
        referenceType: input.referenceType,
        referenceId: input.referenceId,
        reasonCode: input.reasonCode,
        idempotencyKey: null,
        occurredAt: now,
        createdBy: userId,
      });

      const level = await this.repo.getStockLevel(input.variantId, warehouse.id, tx);
      const oldOnHand = level?.quantityOnHand ?? '0';
      const newOnHand = addQuantity(oldOnHand, input.quantity);

      // INV-6: a negative on-hand projection from a manual adjustment is an
      // oversold condition — recorded as an alert, never silently.
      const oversold = isNegativeQuantity(newOnHand);

      const persisted = await this.repo.insertMovement(movement.toJSON(), tx);
      await this.repo.upsertStockLevel(
        input.variantId,
        warehouse.id,
        newOnHand,
        level?.quantityReserved ?? '0',
        persisted.id,
        tx,
      );
      if (oversold) {
        await this.repo.upsertLowStockAlert(input.variantId, warehouse.id, now, tx);
      }

      return { movementId: persisted.id };
    });

    return committed;
  }
}
