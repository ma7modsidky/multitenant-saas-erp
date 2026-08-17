import { INVENTORY_EVENTS, type InventoryStockMovementRecordedV1 } from '@modubiz/contracts';

import type { StockMovementData } from '../domain/index.js';

/**
 * Build the `inventory.stock.movement_recorded.v1` domain event for a
 * persisted movement (Phase 7.0, ACC-15).
 *
 * Every movement source — the inventory use cases and both Level 3 port
 * implementations — emits this so the accounting module can post the
 * inventory-side GL entry idempotently, keyed on the movement id. The returned
 * shape is compatible with `UnitOfWork.addEvent` (use cases) AND
 * `MovementEventCollector.add` (port impls running inside a caller's
 * transaction).
 */
export function buildMovementRecordedEvent(
  movement: StockMovementData,
  organizationId: string,
  occurredAt: Date,
): { name: string; payload: InventoryStockMovementRecordedV1; aggregateId: string } {
  const payload: InventoryStockMovementRecordedV1 = {
    organizationId,
    movementId: movement.id,
    variantId: movement.variantId,
    warehouseId: movement.warehouseId,
    movementType: movement.type,
    quantity: movement.quantity,
    unitCostAmountMinor: movement.unitCostAmountMinor,
    unitCostCurrency: movement.unitCostCurrency,
    referenceType: movement.referenceType,
    referenceId: movement.referenceId,
    reasonCode: movement.reasonCode,
    occurredAt: occurredAt.toISOString(),
  };
  return {
    name: INVENTORY_EVENTS.MOVEMENT_RECORDED_V1,
    payload,
    aggregateId: movement.variantId,
  };
}
