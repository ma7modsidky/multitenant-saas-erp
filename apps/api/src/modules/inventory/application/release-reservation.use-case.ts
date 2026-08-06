import { Inject, Injectable } from '@nestjs/common';

import { NotFoundError } from '../../../core/common/errors.js';
import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';
import { RESERVATION_STATE, Reservation, subtractQuantity } from '../domain/index.js';

import { INVENTORY_REPOSITORY, type InventoryRepository } from './ports/index.js';

/**
 * ReleaseReservationUseCase — `held → released` (INV-8).
 *
 * The quantity returns to available: reserved drops, on-hand is unchanged.
 * Only a reservation in `held` state may be released.
 */
@Injectable()
export class ReleaseReservationUseCase {
  constructor(
    @Inject(INVENTORY_REPOSITORY)
    private readonly repo: InventoryRepository,
    private readonly txManager: TransactionManager,
  ) {}

  async execute(reservationId: string): Promise<{ released: true }> {
    const now = new Date();

    return this.txManager.run(async (tx) => {
      const row = await this.repo.findReservationById(reservationId, tx);
      if (!row) throw new NotFoundError('RESERVATION_NOT_FOUND', { reservationId });

      const reservation = Reservation.fromPersistence(row);
      reservation.release(now); // throws RESERVATION_ILLEGAL_TRANSITION / EXPIRED

      // Releasing returns the held quantity to available: reserved drops,
      // on-hand is unchanged (INV-5, INV-8).
      const level = await this.repo.getStockLevel(reservation.variantId, reservation.warehouseId, tx);
      const oldReserved = level?.quantityReserved ?? '0';
      const newReserved = subtractQuantity(oldReserved, reservation.quantity);

      await this.repo.upsertStockLevel(
        reservation.variantId,
        reservation.warehouseId,
        level?.quantityOnHand ?? '0',
        newReserved,
        level?.lastMovementId ?? null,
        tx,
      );
      await this.repo.updateReservationState(reservation.id, RESERVATION_STATE.RELEASED, now, tx);

      return { released: true as const };
    });
  }
}
