import {
  type AdjustCostMovementInput,
  type InventoryMovementPort,
  type IssueMovementInput,
  type MovementEventCollector,
  type ReceiveMovementInput,
  type ReturnToSupplierMovementInput,
  type TransactionRef,
} from '@modubiz/contracts';
import { Inject, Injectable } from '@nestjs/common';

import { NotFoundError } from '../../../../core/common/errors.js';
import { TransactionManager } from '../../../../core/database/transaction-manager.js';
import { TenantContext } from '../../../../core/tenancy/tenant-context.js';
import {
  INVENTORY_ERROR_CODE,
  InventoryError,
  MOVEMENT_TYPE,
  StockLevel,
  StockMovement,
  type StockMovementData,
  addQuantity,
  adjustMovingAverageCost,
  compareQuantity,
  movingAverageCost,
  subtractQuantity,
} from '../../domain/index.js';
import { INVENTORY_REPOSITORY, type InventoryRepository } from '../../application/ports/index.js';
import { buildMovementRecordedEvent } from '../../application/movement-recorded.event.js';

/**
 * InventoryMovementPortImpl — the Level 3 movement port (Phase 7.0).
 *
 * Consumed by Purchasing (GRN receiving, supplier returns, bill cost
 * variance) and Accounting (goods-invoice issuance): the caller mints a
 * `TransactionRef` inside ITS OWN `TransactionManager.run()` and passes it
 * in; this implementation resolves it back to the ambient tx and joins it —
 * it NEVER opens its own transaction. That is what makes a GRN, a bill cost
 * variance, or a goods invoice atomic with its stock effect (PUR-4, PUR-9,
 * ACC-14).
 *
 * Every movement created here emits `inventory.stock.movement_recorded.v1`
 * through the optional collector (the caller's UnitOfWork), so the GL
 * (accounting) can post the inventory-side journal entry idempotently, keyed
 * on the movement id (ACC-15).
 *
 * @see ARCHITECTURE.md §6 — Level 3: transactional command port
 * @see BUSINESS_RULES.md §8 — INV-1 (append-only), INV-5 (available), INV-12 (moving average)
 */
@Injectable()
export class InventoryMovementPortImpl implements InventoryMovementPort {
  constructor(
    @Inject(INVENTORY_REPOSITORY)
    private readonly repo: InventoryRepository,
    private readonly txManager: TransactionManager,
  ) {}

  async receive(
    input: ReceiveMovementInput,
    txRef: TransactionRef,
    movementEvents?: MovementEventCollector,
  ): Promise<void> {
    const tx = this.txManager.resolveRef(txRef);
    const organizationId = TenantContext.requireOrganizationId();
    const userId = TenantContext.getUserId() ?? null;
    const now = new Date();

    // INV-16: a retried receipt with the same idempotency key must not double-count.
    if (input.idempotencyKey && (await this.repo.findMovementByIdempotencyKey(input.idempotencyKey, tx))) {
      return;
    }

    const warehouse = await this.resolveWarehouse(input.warehouseId, tx);

    for (const line of input.lines) {
      const variant = await this.repo.findVariantById(line.variantId, tx);
      if (!variant) throw new NotFoundError('VARIANT_NOT_FOUND', { variantId: line.variantId });

      // INV-3 + INV-12: a `receipt` movement with a per-unit cost — the moving
      // average is recalculated below (never retroactively).
      const movement = StockMovement.create({
        id: crypto.randomUUID(),
        organizationId,
        variantId: line.variantId,
        warehouseId: warehouse.id,
        type: MOVEMENT_TYPE.RECEIPT,
        quantity: line.quantity,
        unitCostAmountMinor: line.unitCostAmountMinor,
        unitCostCurrency: line.unitCostCurrency,
        referenceType: input.referenceType,
        referenceId: input.referenceId,
        reasonCode: null,
        idempotencyKey: input.idempotencyKey ?? null,
        occurredAt: now,
        createdBy: userId,
      });
      const persisted = await this.repo.insertMovement(movement.toJSON(), tx);

      // INV-2: the projection follows the ledger.
      const level = await this.repo.getStockLevel(line.variantId, warehouse.id, tx);
      const oldOnHand = level?.quantityOnHand ?? '0';
      const newOnHand = addQuantity(oldOnHand, line.quantity);
      await this.repo.upsertStockLevel(
        line.variantId,
        warehouse.id,
        newOnHand,
        level?.quantityReserved ?? '0',
        persisted.id,
        tx,
      );

      // INV-12: moving-average cost, exact integer arithmetic (hard rule #3).
      if (compareQuantity(line.unitCostAmountMinor, '0') >= 0) {
        const newAvg = movingAverageCost(oldOnHand, variant.costAmountMinor, line.quantity, line.unitCostAmountMinor);
        await this.repo.updateVariantCost(line.variantId, newAvg, line.unitCostCurrency, tx);
      }

      this.emitMovementRecorded(movementEvents, persisted, organizationId, now);
    }
  }

  async issue(
    input: IssueMovementInput,
    txRef: TransactionRef,
    movementEvents?: MovementEventCollector,
  ): Promise<void> {
    const tx = this.txManager.resolveRef(txRef);
    const organizationId = TenantContext.requireOrganizationId();
    const userId = TenantContext.getUserId() ?? null;
    const now = new Date();

    if (input.idempotencyKey && (await this.repo.findMovementByIdempotencyKey(input.idempotencyKey, tx))) {
      return;
    }

    const warehouse = await this.resolveWarehouse(input.warehouseId, tx);

    for (const line of input.lines) {
      const variant = await this.repo.findVariantById(line.variantId, tx);
      if (!variant) throw new NotFoundError('VARIANT_NOT_FOUND', { variantId: line.variantId });

      // INV-5: goods-invoice issuance validates against AVAILABLE stock —
      // an over-issue fails the whole caller transaction (ACC-14).
      const level = await this.repo.getStockLevel(line.variantId, warehouse.id, tx);
      const stockLevel = StockLevel.of(
        line.variantId,
        warehouse.id,
        level?.quantityOnHand ?? '0',
        level?.quantityReserved ?? '0',
      );
      stockLevel.assertSufficient(line.quantity);

      // A `sale`-type movement with the CURRENT moving-average cost snapshotted
      // for the GL's COGS entry (the cost never changes on an outbound
      // movement — INV-12 only recalcs on receipts).
      const movement = StockMovement.create({
        id: crypto.randomUUID(),
        organizationId,
        variantId: line.variantId,
        warehouseId: warehouse.id,
        type: MOVEMENT_TYPE.SALE,
        quantity: `-${line.quantity}`,
        unitCostAmountMinor: variant.costAmountMinor,
        unitCostCurrency: variant.costCurrency,
        referenceType: input.referenceType,
        referenceId: input.referenceId,
        reasonCode: null,
        idempotencyKey: input.idempotencyKey ?? null,
        occurredAt: now,
        createdBy: userId,
      });
      const persisted = await this.repo.insertMovement(movement.toJSON(), tx);

      const newOnHand = subtractQuantity(level?.quantityOnHand ?? '0', line.quantity);
      await this.repo.upsertStockLevel(
        line.variantId,
        warehouse.id,
        newOnHand,
        level?.quantityReserved ?? '0',
        persisted.id,
        tx,
      );

      this.emitMovementRecorded(movementEvents, persisted, organizationId, now);
    }
  }

  async returnToSupplier(
    input: ReturnToSupplierMovementInput,
    txRef: TransactionRef,
    movementEvents?: MovementEventCollector,
  ): Promise<void> {
    const tx = this.txManager.resolveRef(txRef);
    const organizationId = TenantContext.requireOrganizationId();
    const userId = TenantContext.getUserId() ?? null;
    const now = new Date();

    if (input.idempotencyKey && (await this.repo.findMovementByIdempotencyKey(input.idempotencyKey, tx))) {
      return;
    }

    const warehouse = await this.resolveWarehouse(input.warehouseId, tx);

    for (const line of input.lines) {
      const variant = await this.repo.findVariantById(line.variantId, tx);
      if (!variant) throw new NotFoundError('VARIANT_NOT_FOUND', { variantId: line.variantId });

      // PUR-11: you can only return what you still have available to return.
      const level = await this.repo.getStockLevel(line.variantId, warehouse.id, tx);
      const stockLevel = StockLevel.of(
        line.variantId,
        warehouse.id,
        level?.quantityOnHand ?? '0',
        level?.quantityReserved ?? '0',
      );
      stockLevel.assertSufficient(line.quantity);

      const movement = StockMovement.create({
        id: crypto.randomUUID(),
        organizationId,
        variantId: line.variantId,
        warehouseId: warehouse.id,
        type: MOVEMENT_TYPE.SUPPLIER_RETURN,
        quantity: `-${line.quantity}`,
        unitCostAmountMinor: line.unitCostAmountMinor ?? variant.costAmountMinor,
        unitCostCurrency: line.unitCostCurrency ?? variant.costCurrency,
        referenceType: input.referenceType,
        referenceId: input.referenceId,
        reasonCode: input.reasonCode,
        idempotencyKey: input.idempotencyKey ?? null,
        occurredAt: now,
        createdBy: userId,
      });
      const persisted = await this.repo.insertMovement(movement.toJSON(), tx);

      const newOnHand = subtractQuantity(level?.quantityOnHand ?? '0', line.quantity);
      await this.repo.upsertStockLevel(
        line.variantId,
        warehouse.id,
        newOnHand,
        level?.quantityReserved ?? '0',
        persisted.id,
        tx,
      );

      this.emitMovementRecorded(movementEvents, persisted, organizationId, now);
    }
  }

  async adjustCost(
    input: AdjustCostMovementInput,
    txRef: TransactionRef,
    movementEvents?: MovementEventCollector,
  ): Promise<void> {
    const tx = this.txManager.resolveRef(txRef);
    const organizationId = TenantContext.requireOrganizationId();
    const userId = TenantContext.getUserId() ?? null;
    const now = new Date();

    if (input.idempotencyKey && (await this.repo.findMovementByIdempotencyKey(input.idempotencyKey, tx))) {
      return;
    }

    const variant = await this.repo.findVariantById(input.variantId, tx);
    if (!variant) throw new NotFoundError('VARIANT_NOT_FOUND', { variantId: input.variantId });

    const warehouse = await this.resolveWarehouse(input.warehouseId, tx);

    // PUR-9: a cost adjustment revalues what is physically on hand. With zero
    // on-hand there is nothing to revalue — reject rather than guess.
    const level = await this.repo.getStockLevel(input.variantId, warehouse.id, tx);
    const onHand = level?.quantityOnHand ?? '0';
    if (compareQuantity(onHand, '0') <= 0) {
      throw new InventoryError(
        INVENTORY_ERROR_CODE.COST_ADJUSTMENT_EMPTY_STOCK,
        'A cost adjustment requires positive on-hand stock (PUR-9).',
        { variantId: input.variantId, warehouseId: warehouse.id },
      );
    }

    // INV-3 exemption: `cost_adjustment` is a zero-quantity, value-only
    // movement. The unit-cost columns carry the SIGNED total value delta.
    const movement = StockMovement.create({
      id: crypto.randomUUID(),
      organizationId,
      variantId: input.variantId,
      warehouseId: warehouse.id,
      type: MOVEMENT_TYPE.COST_ADJUSTMENT,
      quantity: '0',
      unitCostAmountMinor: input.costDeltaAmountMinor,
      unitCostCurrency: input.currency,
      referenceType: input.referenceType,
      referenceId: input.referenceId,
      reasonCode: null,
      idempotencyKey: input.idempotencyKey ?? null,
      occurredAt: now,
      createdBy: userId,
    });
    const persisted = await this.repo.insertMovement(movement.toJSON(), tx);

    // The projection's quantity is unchanged; only the traceable last-movement
    // pointer and the moving average move (INV-2, INV-12).
    await this.repo.upsertStockLevel(
      input.variantId,
      warehouse.id,
      onHand,
      level?.quantityReserved ?? '0',
      persisted.id,
      tx,
    );
    const newAvg = adjustMovingAverageCost(onHand, variant.costAmountMinor, input.costDeltaAmountMinor);
    await this.repo.updateVariantCost(input.variantId, newAvg, input.currency, tx);

    this.emitMovementRecorded(movementEvents, persisted, organizationId, now);
  }

  // ─── internals ────────────────────────────────────────────────────────────

  /** Resolve the target warehouse: explicit id, or the org's default (lazy). */
  private async resolveWarehouse(
    warehouseId: string | undefined,
    tx: Parameters<InventoryRepository['findWarehouseById']>[1],
  ) {
    const warehouse = warehouseId
      ? await this.repo.findWarehouseById(warehouseId, tx)
      : await this.repo.ensureDefaultWarehouse(tx);
    if (!warehouse) throw new NotFoundError('WAREHOUSE_NOT_FOUND', { warehouseId });
    return warehouse;
  }

  /**
   * Emit `inventory.stock.movement_recorded.v1` on the caller's unit of work
   * (published after the caller's commit — OPS-3). Keyed on the movement id so
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
