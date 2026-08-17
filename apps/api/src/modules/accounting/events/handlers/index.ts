// Event handlers for the accounting module.
// Handlers validate the payload, delegate to a use case, and stay idempotent.

export { PosSaleCompletedHandler } from './pos-sale-completed.handler.js';
export { InventoryMovementRecordedHandler } from './inventory-movement-recorded.handler.js';
