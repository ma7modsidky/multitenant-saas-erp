import { Inject, Injectable } from '@nestjs/common';

import { NotFoundError } from '../../../core/common/errors.js';
import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { UnitOfWork } from '../../../core/database/unit-of-work.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';
import {
  MOVEMENT_TYPE,
  RESERVATION_STATE,
  Reservation,
  StockMovement,
  addQuantity,
  subtractQuantity,
} from '../domain/index.js';

import { INVENTORY_REPOSITORY, type InventoryRepository } from './ports/index.js';

/**
 * CommitReservationUseCase — `held → committed` (INV-8).
 *
 * The reservation is a soft hold: committing deducts the quantity from on-hand
 * (a `sale` movement) and clears the hold, so available = on-hand − reserved
 * stays consistent. Only a reservation in `held` state may commit.
 */
@Injectable()
export class CommitReservationUseCase {
  constructor(
    @Inject(INVENTORY_REPOSITORY)
    private readonly repo: InventoryRepository,
    private readonly txManager: TransactionManager,
    private readonly unitOfWork: UnitOfWork,
  ) {}

  async execute(reservationId: string): Promise<{ movementId: string }> {
    const organizationId = TenantContext.requireOrganizationId();
    const userId = TenantContext.getUserId() ?? null;
    const now = new Date();

    const committed = await this.txManager.run(async (tx) => {
      const row = await this.repo.findReservationById(reservationId, tx);
      if (!row) throw new NotFoundError('RESERVATION_NOT_FOUND', { reservationId });

      const reservation = Reservation.fromPersistence(row);
      reservation.commit(now); // throws RESERVATION_ILLEGAL_TRANSITION / EXPIRED

      // Deduct on-hand; reserved drops by the same amount.
      const level = await this.repo.getStockLevel(reservation.variantId, reservation.warehouseId, tx);
      const oldOnHand = level?.quantityOnHand ?? '0';
      const oldReserved = level?.quantityReserved ?? '0';
      const newOnHand = subtractQuantity(oldOnHand, reservation.quantity);
      const newReserved = subtractQuantity(oldReserved, reservation.quantity);

      const movement = StockMovement.create({
        id: crypto.randomUUID(),
        organizationId,
        variantId: reservation.variantId,
        warehouseId: reservation.warehouseId,
        type: MOVEMENT_TYPE.SALE,
        quantity: `-${reservation.quantity}`,
        unitCostAmountMinor: null,
        unitCostCurrency: null,
        referenceType: reservation.referenceType,
        referenceId: reservation.referenceId,
        reasonCode: null,
        idempotencyKey: null,
        occurredAt: now,
        createdBy: userId,
      });
      const persisted = await this.repo.insertMovement(movement.toJSON(), tx);

      await this.repo.upsertStockLevel(
        reservation.variantId,
        reservation.warehouseId,
        newOnHand,
        newReserved,
        persisted.id,
        tx,
      );
      await this.repo.updateReservationState(reservation.id, RESERVATION_STATE.COMMITTED, now, tx);

      return { movementId: persisted.id };
    });

    return committed;
  }
}
