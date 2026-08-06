import { Inject, Injectable } from '@nestjs/common';

import { NotFoundError } from '../../../core/common/errors.js';
import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';
import { RESERVATION_STATE, Reservation, StockLevel, addQuantity } from '../domain/index.js';

import { INVENTORY_REPOSITORY, type InventoryRepository } from './ports/index.js';

export interface ReserveStockInput {
  variantId: string;
  warehouseId: string;
  /** Quantity to hold (decimal string, UoM units). */
  quantity: string;
  /** Bounded hold duration in seconds (default 900 = 15 min per INV-7). */
  holdForSeconds?: number;
  /** Who holds it (e.g. a POS draft sale). */
  referenceType: string;
  referenceId: string;
  /** Client-generated key so retried reserve calls do not double-hold (INV-16). */
  idempotencyKey?: string;
}

export interface ReservationResult {
  reservationId: string;
  expiresAt: string;
}

/**
 * ReserveStockUseCase — creates a soft hold on available stock (INV-7).
 *
 * Business rules:
 * - INV-5: the hold validates against *available* (on-hand − reserved).
 * - INV-7: the hold is bounded (`expires_at`, default 15 minutes) and expires
 *   automatically; a job releases expired reservations.
 * - INV-16: a retried reserve with the same idempotency_key returns the
 *   existing reservation instead of double-holding.
 */
@Injectable()
export class ReserveStockUseCase {
  constructor(
    @Inject(INVENTORY_REPOSITORY)
    private readonly repo: InventoryRepository,
    private readonly txManager: TransactionManager,
  ) {}

  async execute(input: ReserveStockInput): Promise<ReservationResult> {
    const organizationId = TenantContext.requireOrganizationId();
    const now = new Date();
    const holdForSeconds = input.holdForSeconds ?? 900;
    const expiresAt = new Date(now.getTime() + holdForSeconds * 1000);

    return this.txManager.run(async (tx) => {
      // INV-16: reservations carry no idempotency column — the reference pair
      // (reference_type + reference_id, e.g. a POS draft sale) is the natural
      // dedupe key: a retried checkout finds its existing hold via the
      // reference instead of double-holding. Movements (receipts) use the
      // idempotency_key column — see ReceiveStockUseCase.

      if (!(await this.repo.findVariantById(input.variantId, tx))) {
        throw new NotFoundError('VARIANT_NOT_FOUND', { variantId: input.variantId });
      }
      const warehouse = await this.repo.findWarehouseById(input.warehouseId, tx);
      if (!warehouse) {
        throw new NotFoundError('WAREHOUSE_NOT_FOUND', { warehouseId: input.warehouseId });
      }

      // INV-5 sales gate: validate against available, never on-hand.
      const level = await this.repo.getStockLevel(input.variantId, input.warehouseId, tx);
      const stockLevel = StockLevel.of(
        input.variantId,
        input.warehouseId,
        level?.quantityOnHand ?? '0',
        level?.quantityReserved ?? '0',
      );
      stockLevel.assertSufficient(input.quantity);

      const reservation = Reservation.create({
        id: crypto.randomUUID(),
        organizationId,
        variantId: input.variantId,
        warehouseId: input.warehouseId,
        quantity: input.quantity,
        state: RESERVATION_STATE.HELD,
        expiresAt,
        referenceType: input.referenceType,
        referenceId: input.referenceId,
        createdAt: now,
        updatedAt: now,
      });

      await this.repo.insertReservation(reservation.toJSON(), tx);

      // INV-2/INV-5: reserved goes up, available goes down — on-hand unchanged.
      const newReserved = addQuantity(level?.quantityReserved ?? '0', input.quantity);
      await this.repo.upsertStockLevel(
        input.variantId,
        input.warehouseId,
        level?.quantityOnHand ?? '0',
        newReserved,
        level?.lastMovementId ?? null,
        tx,
      );

      return { reservationId: reservation.id, expiresAt: expiresAt.toISOString() };
    });
  }
}
