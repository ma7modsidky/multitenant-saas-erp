import {
  type AvailabilitySnapshot,
  type InventoryStockPort,
  type MovementEventCollector,
  type ReservationRef,
  type ReserveStockInput,
  type RestockInput,
  type TransactionRef,
} from '@modubiz/contracts';
import { Inject, Injectable } from '@nestjs/common';

import { NotFoundError } from '../../../../core/common/errors.js';
import { TransactionManager } from '../../../../core/database/transaction-manager.js';
import { TenantContext } from '../../../../core/tenancy/tenant-context.js';
import {
  MOVEMENT_TYPE,
  RESERVATION_STATE,
  Reservation,
  StockLevel,
  StockMovement,
  type StockMovementData,
  addQuantity,
  subtractQuantity,
} from '../../domain/index.js';
import { INVENTORY_REPOSITORY, type InventoryRepository } from '../../application/ports/index.js';
import { buildMovementRecordedEvent } from '../../application/movement-recorded.event.js';

/**
 * InventoryStockPortImpl — the Level 3 transactional stock port (INV-5/7/8).
 *
 * Consumed by POS at checkout (POS-15): the caller mints a `TransactionRef`
 * inside ITS OWN `TransactionManager.run()` and passes it in; this
 * implementation resolves it back to the ambient tx and joins it — it NEVER
 * opens its own transaction. That is the whole point of the Level 3 port:
 * inventory deduction happens atomically with the sale.
 *
 * @see ARCHITECTURE.md §6 — Level 3: transactional command port
 */
@Injectable()
export class InventoryStockPortImpl implements InventoryStockPort {
  constructor(
    @Inject(INVENTORY_REPOSITORY)
    private readonly repo: InventoryRepository,
    private readonly txManager: TransactionManager,
  ) {}

  async getAvailability(input: { variantIds: string[]; warehouseId: string }): Promise<AvailabilitySnapshot[]> {
    TenantContext.requireOrganizationId();

    // Read-only snapshot — a fresh transaction is fine here (no ref required).
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

  async reserve(input: ReserveStockInput, txRef: TransactionRef): Promise<ReservationRef> {
    const tx = this.txManager.resolveRef(txRef);
    const organizationId = TenantContext.requireOrganizationId();
    const now = new Date();
    const holdForSeconds = input.holdForSeconds ?? 900;
    const expiresAt = new Date(now.getTime() + holdForSeconds * 1000);

    if (!(await this.repo.findVariantById(input.variantId, tx))) {
      throw new NotFoundError('VARIANT_NOT_FOUND', { variantId: input.variantId });
    }
    const warehouse = await this.repo.findWarehouseById(input.warehouseId, tx);
    if (!warehouse) throw new NotFoundError('WAREHOUSE_NOT_FOUND', { warehouseId: input.warehouseId });

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
  }

  async commitReservation(
    reservationId: string,
    txRef: TransactionRef,
    movementEvents?: MovementEventCollector,
  ): Promise<void> {
    const tx = this.txManager.resolveRef(txRef);
    const organizationId = TenantContext.requireOrganizationId();
    const userId = TenantContext.getUserId() ?? null;
    const now = new Date();

    const row = await this.repo.findReservationById(reservationId, tx);
    if (!row) throw new NotFoundError('RESERVATION_NOT_FOUND', { reservationId });

    const reservation = Reservation.fromPersistence(row);
    reservation.commit(now); // throws RESERVATION_ILLEGAL_TRANSITION / EXPIRED

    // Deduct on-hand; reserved drops by the same amount (INV-8).
    const level = await this.repo.getStockLevel(reservation.variantId, reservation.warehouseId, tx);
    const newOnHand = subtractQuantity(level?.quantityOnHand ?? '0', reservation.quantity);
    const newReserved = subtractQuantity(level?.quantityReserved ?? '0', reservation.quantity);

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

    this.emitMovementRecorded(movementEvents, persisted, organizationId, now);
  }

  async releaseReservation(reservationId: string, txRef: TransactionRef): Promise<void> {
    const tx = this.txManager.resolveRef(txRef);
    const now = new Date();

    const row = await this.repo.findReservationById(reservationId, tx);
    if (!row) throw new NotFoundError('RESERVATION_NOT_FOUND', { reservationId });

    const reservation = Reservation.fromPersistence(row);
    reservation.release(now); // throws RESERVATION_ILLEGAL_TRANSITION / EXPIRED

    // Releasing returns the held quantity to available: reserved drops,
    // on-hand is unchanged (INV-5, INV-8).
    const level = await this.repo.getStockLevel(reservation.variantId, reservation.warehouseId, tx);
    const newReserved = subtractQuantity(level?.quantityReserved ?? '0', reservation.quantity);

    await this.repo.upsertStockLevel(
      reservation.variantId,
      reservation.warehouseId,
      level?.quantityOnHand ?? '0',
      newReserved,
      level?.lastMovementId ?? null,
      tx,
    );
    await this.repo.updateReservationState(reservation.id, RESERVATION_STATE.RELEASED, now, tx);
  }

  async restock(input: RestockInput, txRef: TransactionRef, movementEvents?: MovementEventCollector): Promise<void> {
    const tx = this.txManager.resolveRef(txRef);
    const organizationId = TenantContext.requireOrganizationId();
    const userId = TenantContext.getUserId() ?? null;
    const now = new Date();

    if (!(await this.repo.findVariantById(input.variantId, tx))) {
      throw new NotFoundError('VARIANT_NOT_FOUND', { variantId: input.variantId });
    }
    const warehouse = await this.repo.findWarehouseById(input.warehouseId, tx);
    if (!warehouse) throw new NotFoundError('WAREHOUSE_NOT_FOUND', { warehouseId: input.warehouseId });

    // POS-22: restocked lines return goods (positive movement); damaged lines
    // write them off (negative). Either way a movement is recorded — stock is
    // never silently unchanged.
    const movement = StockMovement.create({
      id: crypto.randomUUID(),
      organizationId,
      variantId: input.variantId,
      warehouseId: input.warehouseId,
      type: input.restock ? MOVEMENT_TYPE.RETURN : MOVEMENT_TYPE.WRITE_OFF,
      quantity: input.restock ? input.quantity : `-${input.quantity}`,
      unitCostAmountMinor: null,
      unitCostCurrency: null,
      referenceType: input.referenceType,
      referenceId: input.referenceId,
      reasonCode: null,
      idempotencyKey: null,
      occurredAt: now,
      createdBy: userId,
    });
    const persisted = await this.repo.insertMovement(movement.toJSON(), tx);

    const level = await this.repo.getStockLevel(input.variantId, input.warehouseId, tx);
    const newOnHand = addQuantity(level?.quantityOnHand ?? '0', movement.quantity);
    await this.repo.upsertStockLevel(
      input.variantId,
      input.warehouseId,
      newOnHand,
      level?.quantityReserved ?? '0',
      persisted.id,
      tx,
    );

    this.emitMovementRecorded(movementEvents, persisted, organizationId, now);
  }

  /**
   * Emit `inventory.stock.movement_recorded.v1` on the caller's unit of work
   * (published after the caller's commit — OPS-3), keyed on the movement id so
   * the GL handler is idempotent (ACC-15).
   */
  private emitMovementRecorded(
    collector: MovementEventCollector | undefined,
    movement: StockMovementData,
    organizationId: string,
    occurredAt: Date,
  ): void {
    if (!collector) return;
    collector.addEvent(buildMovementRecordedEvent(movement, organizationId, occurredAt));
  }
}
